// פרסום אוטומטי יומי לעמוד הפייסבוק של סלזול - רץ בסוף ה-nightly, אפס מגע יד.
// מייצר פוסט מנתוני היום (שינויי מחירים אמיתיים) ומפרסם דרך Graph API.
// דורש (GitHub secrets → env): FB_PAGE_ID, FB_PAGE_TOKEN. בלעדיהם - מדלג בשקט.
// מפרסם רק אם יש שינויים טריים מהיום, ולא יותר מפוסט אחד ביום (נשמר ב-pipeline/social-state.json).
const fs = require('fs');
const path = require('path');
const https = require('https');

const PAGE_ID = process.env.FB_PAGE_ID;
const TOKEN = process.env.FB_PAGE_TOKEN;
if (!PAGE_ID || !TOKEN) { console.log('אין FB_PAGE_ID/FB_PAGE_TOKEN - מדלג על פרסום'); process.exit(0); }

const DATA = path.join(__dirname, '..', 'site', 'data');
const STATE = path.join(__dirname, 'social-state.json');
const SITE = 'https://salzol1.osherd402.workers.dev';
const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
const p2 = (n) => String(n).padStart(2, '0');
const todayStr = `${today.getFullYear()}-${p2(today.getMonth() + 1)}-${p2(today.getDate())}`;

let state = {};
try { state = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch {}
if (state.lastPost === todayStr) { console.log('כבר פורסם היום - מדלג'); process.exit(0); }

// ---------- איסוף שינויי היום מכל המחוזות ----------
const CHAIN_NAMES = Object.fromEntries(require('./chains-list').map((c) => [c.id, c.name]));
const seen = new Set();
const changes = [];
for (const d of fs.readdirSync(path.join(DATA, 'd'))) {
  let arr;
  try { arr = JSON.parse(fs.readFileSync(path.join(DATA, 'd', d, 'changes.json'), 'utf8')); } catch { continue; }
  for (const e of arr) {
    if (e.d.slice(0, 10) !== todayStr) continue;
    const k = e.n + '|' + e.ch + '|' + e.f + '|' + e.t;
    if (seen.has(k)) continue;
    seen.add(k);
    changes.push({ ...e, pct: e.f ? Math.round((Math.abs(e.t - e.f) / e.f) * 100) : 0 });
  }
}
if (!changes.length) { console.log('אין שינויים טריים מהיום - מדלג'); process.exit(0); }

const ups = changes.filter((e) => e.t > e.f).sort((a, b) => b.pct - a.pct);
const downs = changes.filter((e) => e.t < e.f).sort((a, b) => b.pct - a.pct);
const fmt = (v) => '₪' + v.toFixed(2);
const line = (e, arrow) => `${arrow} ${e.n} — ${fmt(e.f)} ← ${fmt(e.t)} (${e.pct}%) ב${CHAIN_NAMES[e.ch] || e.ch}`;

const parts = [
  `🛒 עדכון המחירים היומי של סַלְזוֹל · ${p2(today.getDate())}.${p2(today.getMonth() + 1)}`,
  '',
  `היום נרשמו ${changes.length} שינויי מחירים ברשתות: ${ups.length} התייקרויות ו-${downs.length} הוזלות.`,
];
if (ups.length) { parts.push('', '📈 ההתייקרויות הבולטות:'); for (const e of ups.slice(0, 3)) parts.push(line(e, '▲')); }
if (downs.length) { parts.push('', '📉 ההוזלות הבולטות:'); for (const e of downs.slice(0, 3)) parts.push(line(e, '▼')); }
parts.push('', `💰 בדקו כמה עולה הסל שלכם בכל רשת באזורכם — בחינם:`, SITE);
const message = parts.join('\n');

// ---------- פרסום ----------
const body = new URLSearchParams({ message, link: SITE, access_token: TOKEN }).toString();
const req = https.request(`https://graph.facebook.com/v21.0/${PAGE_ID}/feed`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(body) },
}, (res) => {
  let s = '';
  res.on('data', (d) => (s += d));
  res.on('end', () => {
    if (res.statusCode === 200) {
      console.log('פורסם לפייסבוק:', s);
      fs.writeFileSync(STATE, JSON.stringify({ lastPost: todayStr, id: JSON.parse(s).id }));
    } else {
      console.log('פרסום נכשל', res.statusCode, s.slice(0, 300));
      process.exitCode = 0; // כישלון פרסום לא מפיל את ה-nightly
    }
  });
});
req.on('error', (e) => console.log('שגיאת רשת:', e.message));
req.write(body);
req.end();
