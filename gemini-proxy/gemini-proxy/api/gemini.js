// api/gemini.js
// پروکسی سمت سرور برای Gemini API روی Vercel
// 🔧 نسخه اصلاح‌شده: maxDuration + تایم‌اوت کنترل‌شده + rate-limit بالا

// ⬇⬇⬇ فیکس اصلی ۵۰۴ — تایم‌اوت از ۱۰ ثانیه به ۶۰ ثانیه ⬇⬇⬇
export const maxDuration = 60;

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
// ⬆ بالاتر از قبل: چون همه کاربران سایت ما از «یک IP» (سرور آموزیار) می‌آیند،
// محدودیت قبلی ۲۰/دقیقه عملاً روی کل سایت اعمال می‌شد! خود سرور ما per-user محدود می‌کند.
const RATE_LIMIT_MAX = 120;

// تایم‌اوت داخلی فراخوانی Gemini — کمتر از maxDuration تا خطای «تمیز» برگردد نه کرش
const GEMINI_TIMEOUT_MS = 55000;

const rateLimitMap = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip) || { count: 0, start: now };

  if (now - entry.start > RATE_LIMIT_WINDOW_MS) {
    entry.count = 0;
    entry.start = now;
  }

  entry.count += 1;
  rateLimitMap.set(ip, entry);

  // پاکسازی حافظه: کلیدهای قدیمی را حذف کن (جلوی نشت حافظه در instance گرم)
  if (rateLimitMap.size > 5000) {
    for (const [key, val] of rateLimitMap) {
      if (now - val.start > RATE_LIMIT_WINDOW_MS) rateLimitMap.delete(key);
    }
  }

  return entry.count > RATE_LIMIT_MAX;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'فقط متد POST مجاز است' });
  }

  // --- محافظت با توکن (Authorization: Bearer <ACCESS_TOKEN>) ---
  const accessToken = process.env.ACCESS_TOKEN;
  if (accessToken) {
    const authHeader = req.headers.authorization || '';
    const provided = authHeader.replace('Bearer ', '').trim();
    if (provided !== accessToken) {
      return res.status(401).json({ error: 'دسترسی غیرمجاز - توکن نامعتبر است' });
    }
  }

  // --- محدودیت نرخ بر اساس IP ---
  const ip =
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown';

  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'تعداد درخواست‌ها زیاد است، کمی صبر کنید' });
  }

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'کلید API روی سرور تنظیم نشده است (GEMINI_API_KEY)' });
  }

  try {
    const {
      prompt,
      messages,
      model = 'gemini-3.5-flash',
      generationConfig,
    } = req.body || {};

    if (!prompt && !messages) {
      return res.status(400).json({ error: 'باید prompt یا messages بفرستید' });
    }

    const contents = messages
      ? messages.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        }))
      : [{ role: 'user', parts: [{ text: prompt }] }];

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

    // ⬇ فیکس: تایم‌اوت واقعی روی فراخوانی Gemini
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), GEMINI_TIMEOUT_MS);

    const geminiRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        ...(generationConfig ? { generationConfig } : {}),
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    const data = await geminiRes.json();

    if (!geminiRes.ok) {
      return res.status(geminiRes.status).json({ error: data });
    }

    const text =
      data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';

    return res.status(200).json({ text, raw: data });
  } catch (err) {
    // ⬇ فیکس: خطای تایم‌اوت را تمیز برگردان (نه کرش مبهم)
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'زمان پاسخ Gemini بیش از ۵۵ ثانیه طول کشید — دوباره تلاش کنید' });
    }
    console.error(err);
    return res.status(500).json({ error: 'خطای داخلی سرور', detail: String(err) });
  }
}
