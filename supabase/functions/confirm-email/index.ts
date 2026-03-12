import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'
import { encode as base64Encode } from 'https://deno.land/std@0.177.0/encoding/base64.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }
  try {
    const { token } = await req.json()

    if (!token) {
      return new Response(
        JSON.stringify({ error: 'Token gereklidir.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: submission } = await supabase
      .from('consent_submissions')
      .select('*')
      .eq('confirmation_token', token)
      .maybeSingle()

    if (!submission) {
      return new Response(
        JSON.stringify({ error: 'Gecersiz veya suresi dolmus onay baglantisi.' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (submission.is_confirmed) {
      return new Response(
        JSON.stringify({ error: 'Bu sozlesme zaten onaylanmis.', code: 'ALREADY_CONFIRMED' }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const submittedAt = new Date(submission.submitted_at)
    const daysDiff = (Date.now() - submittedAt.getTime()) / (1000 * 60 * 60 * 24)

    if (daysDiff > 7) {
      await supabase.from('consent_submissions').update({ status: 'expired' }).eq('id', submission.id)
      return new Response(
        JSON.stringify({ error: 'Bu onay baglantisinin suresi dolmustur.' }),
        { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    await supabase
      .from('consent_submissions')
      .update({ is_confirmed: true, confirmed_at: new Date().toISOString(), status: 'confirmed' })
      .eq('id', submission.id)

    // PDF indir
    const { data: pdfData, error: storageError } = await supabase.storage.from('contracts').download('sozlesme.pdf')
    let attachments: any[] = []
    if (pdfData && !storageError) {
      const arrayBuffer = await pdfData.arrayBuffer()
      attachments = [{
        filename: 'Satis_Sozlesmesi.pdf',
        content: base64Encode(new Uint8Array(arrayBuffer)),
        encoding: 'base64',
        contentType: 'application/pdf',
      }]
    }

    const client = new SMTPClient({
      connection: {
        hostname: 'smtp.gmail.com',
        port: 465,
        tls: true,
        auth: {
          username: Deno.env.get('GMAIL_USER')!,
          password: Deno.env.get('GMAIL_APP_PASSWORD')!,
        },
      },
    })

    const confirmDate = new Date().toLocaleDateString('tr-TR', {
      year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })

    const contractHtml = `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#f9fafb;padding:32px">
<div style="max-width:520px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.06)">
<div style="background:#059669;color:white;padding:28px 32px;text-align:center">
<h1 style="margin:0;font-size:20px">Sozlesmeniz Onaylandi</h1></div>
<div style="padding:32px">
<p style="font-size:15px;color:#374151">Sayin <strong>${submission.full_name}</strong>,</p>
<p style="font-size:14px;color:#6b7280;margin-top:12px">Satis sozlesmeniz basariyla onaylanmistir.</p>
<div style="background:#f9fafb;border-radius:8px;padding:16px;margin:20px 0">
<p style="font-size:14px;color:#374151;margin:4px 0">Veli Ad Soyad: <strong>${submission.full_name}</strong></p>
<p style="font-size:14px;color:#374151;margin:4px 0">E-posta: <strong>${submission.email}</strong></p>
<p style="font-size:14px;color:#374151;margin:4px 0">Telefon: <strong>${submission.phone}</strong></p>
<p style="font-size:14px;color:#374151;margin:4px 0">Katilimci: <strong>${submission.participant_name || '-'}</strong></p>
<p style="font-size:14px;color:#374151;margin:4px 0">Dogum Tarihi: <strong>${submission.birth_date || '-'}</strong></p>
<p style="font-size:14px;color:#374151;margin:4px 0">TC Kimlik No: <strong>${submission.tc_kimlik_no || '-'}</strong></p>
${submission.passport_no ? `<p style="font-size:14px;color:#374151;margin:4px 0">Pasaport No: <strong>${submission.passport_no}</strong></p>` : ''}
<p style="font-size:14px;color:#374151;margin:4px 0">Onay Tarihi: <strong>${confirmDate}</strong></p>
</div>
${attachments.length > 0 ? '<p style="font-size:14px;color:#6b7280">Sozlesmenizin bir kopyasini bu e-postanin ekinde bulabilirsiniz.</p>' : ''}
</div></div></body></html>`

    await client.send({
      from: `${Deno.env.get('SENDER_NAME') || 'Sirket'} <${Deno.env.get('GMAIL_USER')}>`,
      to: submission.email,
      subject: 'Satis Sozlesmeniz Onaylandi',
      html: contractHtml,
      attachments: attachments.length > 0 ? attachments : undefined,
    })

    // Admin bildirim e-postası
    const ADMIN_EMAIL = Deno.env.get('ADMIN_EMAIL')
    if (ADMIN_EMAIL) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!
      const dekontInfo = submission.dekont_path
        ? `<p style="font-size:14px;color:#374151;margin:4px 0">Dekont: <a href="${supabaseUrl}/storage/v1/object/dekontlar/${submission.dekont_path}" style="color:#1a56db;text-decoration:underline" target="_blank">Dekontu Goruntule</a></p>`
        : ''

      const adminHtml = `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#f9fafb;padding:32px">
<div style="max-width:520px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.06)">
<div style="background:#1a56db;color:white;padding:28px 32px;text-align:center">
<h1 style="margin:0;font-size:20px">Yeni Onkayit Onayi</h1></div>
<div style="padding:32px">
<p style="font-size:15px;color:#374151">Yeni bir onkayit onaylandi:</p>
<div style="background:#f9fafb;border-radius:8px;padding:16px;margin:20px 0">
<p style="font-size:14px;color:#374151;margin:4px 0">Veli Ad Soyad: <strong>${submission.full_name}</strong></p>
<p style="font-size:14px;color:#374151;margin:4px 0">E-posta: <strong>${submission.email}</strong></p>
<p style="font-size:14px;color:#374151;margin:4px 0">Telefon: <strong>${submission.phone}</strong></p>
<p style="font-size:14px;color:#374151;margin:4px 0">Katilimci: <strong>${submission.participant_name || '-'}</strong></p>
<p style="font-size:14px;color:#374151;margin:4px 0">Dogum Tarihi: <strong>${submission.birth_date || '-'}</strong></p>
<p style="font-size:14px;color:#374151;margin:4px 0">TC Kimlik No: <strong>${submission.tc_kimlik_no || '-'}</strong></p>
${submission.passport_no ? `<p style="font-size:14px;color:#374151;margin:4px 0">Pasaport No: <strong>${submission.passport_no}</strong></p>` : ''}
<p style="font-size:14px;color:#374151;margin:4px 0">Onay Tarihi: <strong>${confirmDate}</strong></p>
${dekontInfo}
</div>
</div></div></body></html>`

      try {
        await client.send({
          from: `${Deno.env.get('SENDER_NAME') || 'Sirket'} <${Deno.env.get('GMAIL_USER')}>`,
          to: ADMIN_EMAIL,
          subject: `Yeni Onkayit: ${submission.full_name}`,
          html: adminHtml,
        })
      } catch (adminErr) {
        console.warn('Admin email error:', adminErr)
      }
    }

    await client.close()

    await supabase.from('email_logs').insert({
      consent_id: submission.id,
      email_type: 'contract',
      sent_to: submission.email,
    })

    await supabase
      .from('consent_submissions')
      .update({ status: 'contract_sent', contract_sent_at: new Date().toISOString() })
      .eq('id', submission.id)

    // Google Sheets
    try {
      const sheetsWebhookUrl = Deno.env.get('GOOGLE_SHEETS_WEBHOOK_URL')
      if (sheetsWebhookUrl) {
        await fetch(sheetsWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            full_name: submission.full_name,
            email: submission.email,
            phone: submission.phone,
            participant_name: submission.participant_name || '',
            birth_date: submission.birth_date || '',
            tc_kimlik_no: submission.tc_kimlik_no || '',
            passport_no: submission.passport_no || '',
            confirmed_at: confirmDate,
            status: 'contract_sent',
          }),
        })
      }
    } catch (e) { console.warn('Sheets error:', e) }

    return new Response(
      JSON.stringify({ success: true, message: 'Sozlesme onaylandi ve e-posta gonderildi.' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('Error:', err)
    return new Response(
      JSON.stringify({ error: 'Beklenmeyen bir hata olustu.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
