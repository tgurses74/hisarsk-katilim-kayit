# Hisar Okulları SK - Önkayıt Formu

Hisar Okulları Spor Kulübü için geliştirilmiş, double opt-in (çift aşamalı onay) mekanizmasına sahip online önkayıt ve sözleşme onay sistemi.

**Canlı URL:** https://hisarsk-katilim-kayit.vercel.app

## Özellikler

- **Çift aşamalı onay (Double Opt-In):** Form gönderimi sonrası e-posta doğrulaması ile kayıt teyidi
- **Ödeme dekontu yükleme:** PDF, JPEG veya PNG formatında (maks. 5MB) dekont yükleme
- **Otomatik e-posta bildirimleri:** Kullanıcıya onay e-postası, sözleşme PDF'i ve admin'e bildirim e-postası
- **Google Sheets entegrasyonu:** Onaylanan kayıtlar otomatik olarak Google Sheets'e yazılır
- **KVKK uyumlu:** Kişisel verilerin korunması aydınlatma metni ve sözleşme onay mekanizması
- **Mükerrer kayıt kontrolü:** TC Kimlik No bazlı tekrar kayıt engelleme
- **Responsive tasarım:** Mobil ve masaüstü cihazlara uyumlu arayüz

## Teknoloji Altyapısı

| Bileşen | Teknoloji |
|---|---|
| Frontend | HTML, CSS, JavaScript (Vanilla) |
| Hosting | Vercel |
| Backend | Supabase Edge Functions (Deno/TypeScript) |
| Veritabanı | Supabase PostgreSQL |
| Dosya Depolama | Supabase Storage |
| E-posta | Gmail SMTP (denomailer) |
| Veri Kayıt | Google Sheets (Apps Script Webhook) |

## Proje Yapısı

```
sozlesme-onay/
├── frontend/
│   ├── index.html          # Ana form sayfası
│   ├── confirm.html         # E-posta onay sayfası
│   └── logo.svg             # Hisar Okulları SK logosu
├── supabase/
│   └── functions/
│       ├── handle-consent/
│       │   └── index.ts     # Form gönderim işleyici
│       └── confirm-email/
│           └── index.ts     # E-posta onay işleyici
└── README.md
```

## Uygulama Akışı

1. Kullanıcı formu doldurur (veli bilgileri, katılımcı bilgileri, ödeme dekontu)
2. `handle-consent` Edge Function formu işler, dekontu Storage'a yükler, veritabanına kaydeder
3. Kullanıcıya onay e-postası gönderilir
4. Kullanıcı e-postadaki bağlantıya tıklar
5. `confirm-email` Edge Function kaydı onaylar
6. Kullanıcıya sözleşme PDF'i e-posta ile gönderilir
7. Admin'e bildirim e-postası gönderilir (tıklanabilir dekont linki ile)
8. Kayıt bilgileri Google Sheets'e yazılır

## Supabase Yapılandırması

### Veritabanı Tabloları

- **consent_submissions** — Kayıt verileri (ad, e-posta, telefon, katılımcı bilgileri, onay durumu, dekont yolu)
- **email_logs** — Gönderilen e-posta kayıtları

### Storage Bucket'ları

- **contracts** (public) — Sözleşme PDF dosyası (`sozlesme.pdf`)
- **dekontlar** (private) — Yüklenen ödeme dekontları

### Gerekli Environment Variables (Secrets)

```
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
GMAIL_USER
GMAIL_APP_PASSWORD
SENDER_NAME
FRONTEND_URL
ADMIN_EMAIL
GOOGLE_SHEETS_WEBHOOK_URL
```

## Deploy

### Frontend (Vercel)

```bash
cd frontend && vercel --prod --yes
```

### Edge Functions (Supabase)

```bash
supabase functions deploy handle-consent --no-verify-jwt
supabase functions deploy confirm-email --no-verify-jwt
```

## Form Alanları

| Alan | Zorunlu | Açıklama |
|---|---|---|
| Veli Ad Soyad | Evet | Kayıt yapan velinin adı soyadı |
| E-posta Adresi | Evet | Onay e-postasının gönderileceği adres |
| Telefon Numarası | Evet | +90 5XX XXX XX XX formatında |
| Katılımcı Ad Soyad | Evet | Spor programına katılacak kişi |
| Katılımcı Doğum Tarihi | Evet | Katılımcının doğum tarihi |
| Katılımcı TC Kimlik No | Evet | 11 haneli TC Kimlik numarası |
| Katılımcı Pasaport No | Hayır | Yabancı uyruklu katılımcılar için |
| Ödeme Dekontu | Evet | PDF, JPEG veya PNG (maks. 5MB) |

## Lisans

© 2026 GUES Reklam Turizm Tanıtım Ticaret Ltd. Şti. Tüm hakları saklıdır.
