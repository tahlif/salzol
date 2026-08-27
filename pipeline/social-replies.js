// מענה אוטומטי לתגובות על פוסטים בעמוד הפייסבוק של סלזול - רץ בכל nightly.
// כל תגובה חדשה מקבלת לייק; תגובה עם כוונת-מחיר ("כמה עולה X"/"מחיר X") מקבלת
// תשובה אמיתית מהדאטה: המחיר הזול ביותר היום והרשת + קישור להשוואה מלאה.
// דורש FB_PAGE_ID + FB_PAGE_TOKEN; בלעדיהם מדלג. תגובות שטופלו נרשמות ב-social-replied.json.
const fs = require('fs');
const path = require('path');
const https = require('https');

const PAGE_ID = process.env.FB_PAGE_ID;
const TOKEN = process.env.FB_PAGE_TOKEN;
if (!PAGE_ID || !TOKEN) { console.log('אין FB_PAGE_ID/FB_PAGE_TOKEN - מדלג על תגובות'); process.exit(0); }

const DATA = path.join(__dirname, '..', 'site', 'data');
const STATE = path.join(__dirname, 'social-replied.json');
const SITE = 'https://salzol1.osherd402.workers.dev';
const CHAIN_NAMES = Object.fromEntries(require('./chains-list').map((c) => [c.id, c.name]));

let done = {};
try { done = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch {}

const api = (pathname, method = 'GET', form = null) => new Promise((resolve) => {
  const qs = method === 'GET' ? (pathname.includes('?') ? '&' : '?') + 'access_token=' + TOKEN : '';
  const body = form ? new URLSearchParams({ ...form, access_token: TOKEN }).toString() : null;
  const req = https.request(`https://graph.facebook.com/v21.0/${pathname}${qs}`, {
    method,
    headers: body ? { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(body) } : {},
  }, (res) => {
    let s = '';
    res.on('data', (d) => (s += d));
    res.on('end', () => { try { resolve({ ok: res.statusCode === 200, j: JSON.parse(s) }); } catch { resolve({ ok: false, j: {} }); } });
  });
  req.on('error', () => resolve({ ok: false, j: {} }));
  if (body) req.write(body);
  req.end();
});

// חיפוש מוצר בדאטה: שם → המחיר הזול ביותר היום ובאיזו רשת (מחוז ת"א כמייצג)
let index = null, shardsDir = null;
function findProduct(text) {
  if (!index) {
    try {
      index = JSON.parse(fs.readFileSync(path.join(DATA, 'd', 'telaviv', 'index.json'), 'utf8'));
      shardsDir = path.join(DATA, 'd', 'telaviv', 's');
    } catch { return null; }
  }
  const norm = (s) => String(s).toLowerCase().replace(/["'`׳״?!.,]/g, '').replace(/\s+/g, ' ').trim();
  const q = norm(text).replace(/^(כמה עולה|כמה עולים|מה המחיר של|מחיר|כמה)\s*/, '');
  if (q.length < 2) return null;
  const toks = q.split(' ').filter((t) => t.length >= 2).slice(0, 4);
  if (!toks.length) return null;
  const cands = index
    .filter((e) => { const n = norm(e.n); return toks.every((t) => n.includes(t)); })
    .sort((a, b) => (b.ch.length - a.ch.length) || (a.n.length - b.n.length));
  const hit = cands[0];
  if (!hit) return null;
  try {
    const shard = JSON.parse(fs.readFileSync(path.join(shardsDir, hit.c.slice(-2).padStart(2, '0') + '.json'), 'utf8'));
    const rec = shard[hit.c];
    let best = null;
    for (const [ch, pr] of Object.entries(rec.prices || {})) {
      if (!best || pr.p < best.p) best = { p: pr.p, ch };
    }
    return best ? { name: rec.name, price: best.p, chain: CHAIN_NAMES[best.ch] || best.ch, chains: Object.keys(rec.prices).length } : null;
  } catch { return null; }
}

(async () => {
  const posts = await api(`${PAGE_ID}/posts?fields=id,created_time&limit=10`);
  if (!posts.ok) { console.log('קריאת פוסטים נכשלה'); process.exit(0); }
  let liked = 0, replied = 0;
  for (const post of posts.j.data || []) {
    const com = await api(`${post.id}/comments?fields=id,message,from&filter=toplevel&limit=50`);
    for (const c of (com.ok && com.j.data) || []) {
      if (done[c.id]) continue;
      if (c.from && String(c.from.id) === String(PAGE_ID)) { done[c.id] = 1; continue; } // התגובות של עצמנו
      await api(`${c.id}/likes`, 'POST', {});
      liked++;
      const wantsPrice = /כמה|מחיר|עולה|\?/.test(c.message || '');
      if (wantsPrice) {
        const p = findProduct(c.message);
        const msg = p
          ? `היי! 👋 ${p.name} נמכר היום ב-${p.chains} רשתות — הזול ביותר: ₪${p.price.toFixed(2)} ב${p.chain}. השוואה מלאה לפי האזור שלך: ${SITE}`
          : `היי! 👋 אפשר לבדוק את המחיר של כל מוצר בכל הרשתות, לפי האזור שלך ובחינם: ${SITE}`;
        const r = await api(`${c.id}/comments`, 'POST', { message: msg });
        if (r.ok) replied++;
      }
      done[c.id] = 1;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  fs.writeFileSync(STATE, JSON.stringify(done));
  console.log(`תגובות: ${liked} לייקים, ${replied} תשובות`);
})();
