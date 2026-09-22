// api/gemini.js
// پروکسی سمت سرور برای Gemini API روی Vercel
// کلید API فقط اینجا (سمت سرور) استفاده می‌شه و هرگز به کلاینت فرستاده نمی‌شه.

const RATE_LIMIT_WINDOW_MS = 60 * 1000; // یک دقیقه
const RATE_LIMIT_MAX = 20; // حداکثر ۲۰ ریکوئست در دقیقه برای هر IP

// حافظه‌ی موقت برای rate limit (ساده، در حد یک instance؛ برای پروژه‌ی جدی از Redis/Upstash استفاده کنید)
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

  return entry.count > RATE_LIMIT_MAX;
}

export default async function handler(req, res) {
  // CORS برای اینکه از هر سایتی هم بشه صداش زد (در صورت نیاز محدودش کنید)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'فقط متد POST مجاز است' });
  }

  // --- محافظت اختیاری با توکن دسترسی ---
  // اگر ACCESS_TOKEN رو در Environment Variables ست کنید، کاربر باید همون توکن رو
  // در هدر Authorization بفرسته: Authorization: Bearer <token>
  const accessToken = process.env.ACCESS_TOKEN;
  if (accessToken) {
    const authHeader = req.headers.authorization || '';
    const provided = authHeader.replace('Bearer ', '').trim();
    if (provided !== accessToken) {
      return res.status(401).json({ error: 'دسترسی غیرمجاز - توکن نامعتبر است' });
    }
  }

  // --- محدودیت نرخ درخواست ساده بر اساس IP ---
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
      model = 'gemini-2.0-flash',
      generationConfig,
    } = req.body || {};

    if (!prompt && !messages) {
      return res.status(400).json({ error: 'باید prompt یا messages بفرستید' });
    }

    // اگر messages بدن (فرمت چند پیامی)، همون رو به contents تبدیل می‌کنیم
    // اگر فقط prompt بدن، یک پیام ساده می‌سازیم
    const contents = messages
      ? messages.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        }))
      : [{ role: 'user', parts: [{ text: prompt }] }];

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

    const geminiRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        ...(generationConfig ? { generationConfig } : {}),
      }),
    });

    const data = await geminiRes.json();

    if (!geminiRes.ok) {
      return res.status(geminiRes.status).json({ error: data });
    }

    const text =
      data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';

    return res.status(200).json({ text, raw: data });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'خطای داخلی سرور', detail: String(err) });
  }
}
