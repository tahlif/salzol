// מפת תמונות מצטברת לפי ברקוד: 'r' = CDN רמי לוי, URL מלא = Open Facts, 0 = אין בשום מאגר.
// רץ בלילה אחרי build; כל ריצה מקדמת עוד נתח (לפי פופולריות) עד שהמפה מכסה את כל הקטלוג.
// הלקוח קורא את site/data/img/<NN>.json לפני שהוא מנסה לגשש בעצמו - חוסך בקשות ועוקף rate-limit.
// שימוש: node pipeline/images.js   (מעטפות: IMG_OFF_BATCHES, IMG_RAMI_PROBES לבדיקות)
const fs = require('fs');
const path = require('path');
const https = require('https');

const DATA = path.join(__dirname, '..', 'site', 'data');
const IMG_DIR = path.join(DATA, 'img');
fs.mkdirSync(IMG_DIR, { recursive: true });

const OFF_BATCHES = parseInt(process.env.IMG_OFF_BATCHES || '600', 10); // 50 ברקודים לבאץ'
const RAMI_PROBES = parseInt(process.env.IMG_RAMI_PROBES || '1200', 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'SalZol-price-compare/1.0 (contact@salzol.com)', ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('timeout')));
  });
}

// ---------- איסוף ברקודים מכל המחוזות, ממוינים לפי פופולריות (כמות רשתות) ----------
const popularity = new Map();
for (const d of fs.readdirSync(path.join(DATA, 'd'))) {
  let idx;
  try { idx = JSON.parse(fs.readFileSync(path.join(DATA, 'd', d, 'index.json'), 'utf8')); } catch { continue; }
  for (const e of idx) {
    if (!/^\d{8,13}$/.test(e.c)) continue;
    const cur = popularity.get(e.c) || 0;
    if (e.ch.length > cur) popularity.set(e.c, e.ch.length);
  }
}
const allCodes = [...popularity.keys()].sort((a, b) => popularity.get(b) - popularity.get(a));

// ---------- טעינת המפה הקיימת (השארדים עצמם הם המאגר) ----------
const shardOf = (code) => code.slice(-2).padStart(2, '0');
const shards = new Map();
for (let i = 0; i < 100; i++) {
  const sh = String(i).padStart(2, '0');
  try { shards.set(sh, JSON.parse(fs.readFileSync(path.join(IMG_DIR, sh + '.json'), 'utf8'))); }
  catch { shards.set(sh, {}); }
}
const known = (code) => code in shards.get(shardOf(code));
const setImg = (code, val) => { shards.get(shardOf(code))[code] = val; };

const todo = allCodes.filter((c) => !known(c));
console.log(`ברקודים: ${allCodes.length} סה"כ, ${allCodes.length - todo.length} כבר במפה, ${todo.length} ממתינים`);

(async () => {
  // ---------- שלב 1: Open Facts בבאצ'ים של 50 (מזון + מוצרי צריכה + טואלטיקה) ----------
  let offHits = 0, offDone = 0;
  const offResolved = new Map(); // code -> url|undefined בשלב הזה
  const batchCodes = todo.slice(0, OFF_BATCHES * 50);
  for (let i = 0; i < batchCodes.length; i += 50) {
    const batch = batchCodes.slice(i, i + 50);
    for (const host of ['world.openfoodfacts.org', 'world.openproductsfacts.org', 'world.openbeautyfacts.org']) {
      const pending = batch.filter((c) => !offResolved.has(c));
      if (!pending.length) break;
      try {
        const r = await get(`https://${host}/api/v2/search?code=${pending.join(',')}&fields=code,image_small_url&page_size=50`);
        if (r.status !== 200) continue;
        for (const p of (JSON.parse(r.text).products || [])) {
          if (p.image_small_url) { offResolved.set(p.code, p.image_small_url); offHits++; }
        }
      } catch {}
      await sleep(350);
    }
    for (const c of batch) if (offResolved.has(c)) setImg(c, offResolved.get(c));
    offDone += batch.length;
    if ((i / 50) % 50 === 0) console.log(`  OFF: ${offDone}/${batchCodes.length} נבדקו, ${offHits} תמונות`);
  }
  console.log(`OFF: ${offHits} תמונות מתוך ${offDone} ברקודים`);

  // ---------- שלב 2: גישוש CDN רמי לוי למי שעדיין בלי (מדורג, עמיד ל-429) ----------
  let ramiHits = 0, ramiMiss = 0, backoffs = 0;
  const probeList = batchCodes.filter((c) => !offResolved.has(c)).slice(0, RAMI_PROBES);
  for (const code of probeList) {
    try {
      const r = await get(`https://img.rami-levy.co.il/product/${code}/small.jpg`, { 'User-Agent': 'Mozilla/5.0' });
      if (r.status === 200) { setImg(code, 'r'); ramiHits++; }
      else if (r.status === 429) {
        backoffs++;
        if (backoffs > 5) { console.log('  רמי לוי: יותר מדי 429 - עוצרים את השלב'); break; }
        await sleep(20000);
        continue; // לא מסמנים כלום - ננסה שוב בלילה הבא
      } else { setImg(code, 0); ramiMiss++; }
    } catch { /* שגיאת רשת - לא מסמנים */ }
    await sleep(300);
  }
  console.log(`רמי לוי: ${ramiHits} תמונות, ${ramiMiss} אין, ${backoffs} האטות`);

  // ---------- כתיבה ----------
  let total = 0, misses = 0;
  for (const [sh, obj] of shards) {
    total += Object.keys(obj).length;
    for (const v of Object.values(obj)) if (v === 0) misses++;
    // כותבים את כל 100 השארדים גם כשריקים - שהלקוח לא יחטוף 404
    fs.writeFileSync(path.join(IMG_DIR, sh + '.json'), JSON.stringify(obj));
  }
  console.log(`מפת תמונות: ${total} ברקודים (${total - misses} עם תמונה, ${misses} מסומנים כחסרים)`);
})();
