// =============================================================
// handle-consent Edge Function
// Form gönderimi → Dekont yükleme → DB kayıt → Onay e-postası
// =============================================================

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'
import { decode as base64Decode } from 'https://deno.land/std@0.177.0/encoding/base64.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { full_name, email, phone, participant_name, birth_date, tc_kimlik_no, passport_no, file_name, file_type, file_data } = await req.json()

    // Validasyon
    if (!full_name || !email || !phone || !participant_name || !birth_date || !tc_kimlik_no) {
      return new Response(
        JSON.stringify({ error: 'Tüm alanlar zorunludur.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Dekont dosyası kontrolü
    if (!file_name || !file_data) {
      return new Response(
        JSON.stringify({ error: 'Ödeme dekontu zorunludur.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // E-posta format kontrolü
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return new Response(
        JSON.stringify({ error: 'Geçersiz e-posta adresi.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Telefon format kontrolü
    const phoneDigits = phone.replace(/[^\d]/g, '')
    if (!/^90[5]\d{9}$/.test(phoneDigits)) {
      return new Response(
        JSON.stringify({ error: 'Geçersiz telefon numarası.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Supabase client (service role)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Aynı TC Kimlik No ile zaten onaylanmış kayıt var mı kontrol et
    const { data: existing } = await supabase
      .from('consent_submissions')
      .select('id, is_confirmed')
      .eq('tc_kimlik_no', tc_kimlik_no.trim())
      .eq('is_confirmed', true)
      .maybeSingle()

    if (existing) {
      return new Response(
        JSON.stringify({ error: 'Bu TC Kimlik No ile zaten bir kayıt bulunmaktadır.' }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Aynı TC Kimlik No ile eski bekleyen kayıtları temizle
    await supabase
      .from('consent_submissions')
      .delete()
      .eq('tc_kimlik_no', tc_kimlik_no.trim())
      .eq('is_confirmed', false)

    // Dekont dosyasını Supabase Storage'a yükle
    const fileBytes = base64Decode(file_data)
    const timestamp = Date.now()
    const safeEmail = email.toLowerCase().replace(/[^a-z0-9]/g, '_')
    const fileExt = file_name.split('.').pop()?.toLowerCase() || 'pdf'
    const storagePath = `${safeEmail}/${timestamp}_dekont.${fileExt}`

    const { error: uploadError } = await supabase
      .storage
      .from('dekontlar')
      .upload(storagePath, fileBytes, {
        contentType: file_type || 'application/pdf',
        upsert: false,
      })

    if (uploadError) {
      console.error('Storage upload error:', uploadError)
      return new Response(
        JSON.stringify({ error: 'Dekont yüklenirken bir hata oluştu.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Yeni kayıt oluştur
    const { data: submission, error: insertError } = await supabase
      .from('consent_submissions')
      .insert({
        full_name: full_name.trim(),
        email: email.toLowerCase().trim(),
        phone: phone.trim(),
        participant_name: participant_name.trim(),
        birth_date: birth_date,
        tc_kimlik_no: tc_kimlik_no.trim(),
        passport_no: passport_no ? passport_no.trim() : null,
        dekont_path: storagePath,
        ip_address: req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || 'unknown',
        user_agent: req.headers.get('user-agent') || 'unknown',
      })
      .select('id, confirmation_token')
      .single()

    if (insertError) {
      console.error('DB insert error:', insertError)
      return new Response(
        JSON.stringify({ error: 'Kayıt oluşturulurken bir hata oluştu.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Onay bağlantısını oluştur
    const FRONTEND_URL = Deno.env.get('FRONTEND_URL') || 'https://your-site.com'
    const confirmUrl = `${FRONTEND_URL}/confirm.html?token=${submission.confirmation_token}`

    // Gmail SMTP ile onay e-postası gönder
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

    await client.send({
      from: `${Deno.env.get('SENDER_NAME') || 'Okare'} <${Deno.env.get('GMAIL_USER')}>`,
      to: email,
      subject: 'Önkayıt - E-posta Onayı',
      html: `
        <!DOCTYPE html>
        <html>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f9fafb; padding: 32px;">
          <div style="max-width: 520px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.06);">
            <div style="background: #1a56db; color: white; padding: 28px 32px; text-align: center;">
              <h1 style="margin: 0; font-size: 20px;">E-posta Adresinizi Onaylayın</h1>
            </div>
            <div style="padding: 32px;">
              <p style="font-size: 15px; color: #374151; line-height: 1.6;">
                Sayın <strong>${full_name}</strong>,
              </p>
              <p style="font-size: 14px; color: #6b7280; line-height: 1.6; margin-top: 12px;">
                Önkayıt sürecinizi tamamlamak için lütfen aşağıdaki butona tıklayarak
                e-posta adresinizi onaylayın.
              </p>
              <div style="text-align: center; margin: 28px 0;">
                <a href="${confirmUrl}"
                   style="display: inline-block; background: #1a56db; color: white; padding: 14px 32px;
                          border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px;">
                  E-postamı Onayla
                </a>
              </div>
              <p style="font-size: 12px; color: #9ca3af; line-height: 1.6;">
                Bu bağlantı 7 gün süreyle geçerlidir. Eğer bu kaydı siz oluşturmadıysanız,
                bu e-postayı görmezden gelebilirsiniz.
              </p>
              <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
              <p style="font-size: 11px; color: #d1d5db;">
                Buton çalışmıyorsa bu bağlantıyı tarayıcınıza yapıştırın:<br>
                <a href="${confirmUrl}" style="color: #6b7280; word-break: break-all;">${confirmUrl}</a>
              </p>
            </div>
          </div>
        </body>
        </html>
      `,
    })

    await client.close()

    // E-posta log kaydı
    await supabase.from('email_logs').insert({
      consent_id: submission.id,
      email_type: 'confirmation',
      sent_to: email,
    })

    return new Response(
      JSON.stringify({ success: true, message: 'Onay e-postası gönderildi.' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('Unexpected error:', err)
    return new Response(
      JSON.stringify({ error: 'Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
