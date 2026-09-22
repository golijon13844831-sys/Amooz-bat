// api/gemini.js — نسخه ۳ (فیکس کامل تایم‌اوت)
// بودجه کلی ۵۰ ثانیه بین همه مدل‌ها تقسیم می‌شود — هرگز از سقف Vercel رد نمی‌شود

export const maxDuration = 60;

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 120;          // بالاتر: همه کاربران آموزیار از یک IP می‌آیند
const TOTAL_BUDGET_MS = 50000;       // ⏱ بودجه کل برای «همه» تلاش‌ها با هم
const PER_TRY_MS = 15000;            // ⏱ هر مدل حداکثر ۱۵ ثانیه

const rateLimitMap = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip) || { count: 0, start: now };
  if (now - entry.start > RATE_LIMIT_WINDOW_MS) { entry.count = 0; entry.start = now; }
  entry.count += 1;
  rateLimitMap.set(ip, entry);
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
  res.setHeader('x-amooz-ver', '3');   // ← نشان نسخه — برای چک دیپلوی!

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'فقط متد POST مجاز است' });

  const accessToken = process.env.ACCESS_TOKEN;
  if (accessToken) {
    const provided = (req.headers.authorization || '').replace('Bearer ', '').trim();
    if (provided !== accessToken) {
      return res.status(401).json({ error: 'دسترسی غیرمجاز - توکن نامعتبر است' });
    }
  }

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
    const { prompt, messages, model, generationConfig } = req.body || {};
    if (!prompt && !messages) {
      return res.status(400).json({ error: 'باید prompt یا messages بفرستید' });
    }

    const contents = messages
      ? messages.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        }))
      : [{ role: 'user', parts: [{ text: prompt }] }];

    /* ⬇ مدل پایدار اول (نه ۳.۵ شلوغ!) — اگر body مدل خاصی خواست، همان اول */
    const MODELS = [
      model || 'gemini-3.5-flash',
      'gemini-3.4-flash',
      'gemini-3.5-flash-lite',
    ].filter((m, i, arr) => m && arr.indexOf(m) === i);

    /* سقف خروجی = سقف زمان تولید — جلوی پاسخ‌های بی‌نهایت را می‌گیرد */
    const genCfg = { maxOutputTokens: 4096, ...(generationConfig || {}) };

    const deadline = Date.now() + TOTAL_BUDGET_MS;
    let lastErr = 'مدل‌ها پاسخ ندادند';

    for (const m of MODELS) {
      const remaining = deadline - Date.now();
      if (remaining < 3000) break;                    // دیگر وقت نیست

      const thisTry = Math.min(PER_TRY_MS, remaining);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), thisTry);

      try {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${GEMINI_API_KEY}`;
        const r = await fetch(geminiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents, generationConfig: genCfg }),
          signal: ctrl.signal,
        });
        clearTimeout(timer);

        const data = await r.json();

        if (r.ok) {
          const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
          if (text.trim()) {
            return res.status(200).json({ text, raw: data, usedModel: m });
          }
          lastErr = m + ' → پاسخ خالی';
          continue;                                    // پاسخ خالی → مدل بعدی
        }

        lastErr = m + ' → ' + r.status;                // 503/429 → مدل بعدی
        console.error('[Gemini]', lastErr);
      } catch (e) {
        clearTimeout(timer);
        lastErr = m + ' → ' + (e.name === 'AbortError'
          ? 'تایم‌اوت ' + Math.round(thisTry / 1000) + 'ث'
          : e.message);
        console.error('[Gemini]', lastErr);
        // تایم‌اوت/شبکه → مدل بعدی
      }
    }

    return res.status(503).json({ error: 'مدل‌های Gemini پاسخ ندادند', detail: String(lastErr) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'خطای داخلی سرور', detail: String(err) });
  }
}
