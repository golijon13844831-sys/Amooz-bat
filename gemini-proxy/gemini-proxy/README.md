# Gemini Proxy (Vercel)

یک پروکسی ساده روی Vercel برای Gemini API — فقط یک endpoint، بدون هیچ صفحه‌ی وب. کلید API فقط سمت سرور نگه داشته می‌شه، پس هرکسی می‌تونه از این آدرس API استفاده کنه بدون اینکه به کلید شما دسترسی داشته باشه یا خودش مستقیم به سرورهای گوگل وصل بشه.

## ساختار پروژه

```
gemini-proxy/
├── api/
│   └── gemini.js     ← تابع سرورلس (پروکسی)
├── vercel.json
├── package.json
└── .env.example
```

## مراحل دیپلوی

### ۱. گرفتن کلید API جمنای
از https://aistudio.google.com/apikey یک کلید API بگیرید.

### ۲. نصب Vercel CLI (اختیاری، برای تست لوکال)
```bash
npm install -g vercel
```

### ۳. دیپلوی روی Vercel

**روش الف — از طریق داشبورد Vercel:**
1. این پوشه رو به یک ریپوی گیت‌هاب push کنید.
2. توی vercel.com پروژه رو از روی اون ریپو import کنید.
3. توی تنظیمات پروژه → Environment Variables این‌ها رو اضافه کنید:
   - `GEMINI_API_KEY` = کلید API شما
   - `ACCESS_TOKEN` = (اختیاری) یک رشته‌ی رندوم دلخواه برای محافظت از endpoint
4. Deploy بزنید.

**روش ب — از طریق CLI:**
```bash
cd gemini-proxy
vercel
vercel env add GEMINI_API_KEY
vercel env add ACCESS_TOKEN   # اختیاری
vercel --prod
```

بعد از دیپلوی، یک آدرس مثل `https://your-project.vercel.app` می‌گیرید. همین آدرس رو به هرکسی که می‌خواید بدید.

## نحوه‌ی استفاده

فقط یک درخواست POST به `https://your-project.vercel.app/api/gemini` می‌فرستید:

```bash
curl -X POST https://your-project.vercel.app/api/gemini \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -d '{"prompt": "سلام، حالت چطوره؟"}'
```

یا با تاریخچه‌ی چند پیامی:
```json
{
  "messages": [
    {"role": "user", "content": "سلام"},
    {"role": "assistant", "content": "سلام! چطور می‌تونم کمکتون کنم؟"},
    {"role": "user", "content": "یک شعر کوتاه بگو"}
  ]
}
```

می‌تونید مدل رو هم مشخص کنید (پیش‌فرض `gemini-2.0-flash`):
```json
{ "prompt": "...", "model": "gemini-1.5-pro" }
```

## نکات امنیتی مهم

- **کلید API رو هیچ‌وقت توی کد یا فرانت‌اند نذارید** — فقط در Environment Variables روی Vercel.
- چون این endpoint قراره عمومی باشه، حتماً یک `ACCESS_TOKEN` ست کنید تا هرکسی نتونه بی‌حساب از سهمیه‌ی API شما استفاده کنه. اگر می‌خواید کاملاً عمومی و بدون محدودیت باشه، `ACCESS_TOKEN` رو ست نکنید — ولی مراقب مصرف کلیدتون باشید.
- `rate limit` فعلی (۲۰ درخواست در دقیقه به ازای هر IP) خیلی ساده و memory-based هست و بین instance های مختلف Vercel یکسان نیست. برای استفاده‌ی جدی‌تر و با ترافیک بالا، بهتره از یک سرویس مثل Upstash Redis برای rate limiting واقعی استفاده کنید.
- توجه داشته باشید استفاده از این روش ممکنه با شرایط استفاده (Terms of Service) گوگل برای Gemini API در تضاد باشه، مخصوصاً اگر قصد اشتراک‌گذاری عمومی یا تجاری دارید؛ مسئولیتش با خودتونه.
