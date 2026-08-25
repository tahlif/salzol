// באקפיל היסטוריה: החוק מחייב שמירת קבצים 3 חודשים אחורה - מושכים snapshot שבועי
// מהעבר ל-200 המוצרים המובילים, מהרשתות שהפורטל שלהן חושף תאריכים:
//   בינה (WDate), חצי חינם (d=), קרפור (?date=). ההיסטוריה מוזרקת לאזור המרכז.
// שימוש: node pipeline/backfill.js   (חד-פעמי; רץ אחרי build)
const https = require('https');
const http = require('http');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const CHAIN_LIST = require('./chains-list');

const DATA = path.join(__dirname, '..', 'site', 'data');
const TOP_FILE = path.join(__dirname, 'top200.json');
const WEEKS_BACK = 10;
const DISTRICTS_APPLY = ['center', 'telaviv'];

function get(url, insecure) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { rejectUnauthorized: !insecure }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(get(new URL(res.headers.location, url).href, insecure));
      }
      const ch = [];
      res.on('data', (c) => ch.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(ch), text: () => Buffer.concat(ch).toString('utf8') }));
    });
    req.on('error', reject);
    req.setTimeout(120000, () => req.destroy(new Error('timeout')));
  });
}
const unzip = (buf) => {
  if (buf[0] === 0x1f && buf[1] === 0x8b) return zlib.gunzipSync(buf);
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    const nameLen = buf.readUInt16LE(26), extraLen = buf.readUInt16LE(28), method = buf.readUInt16LE(8);
    const data = buf.slice(30 + nameLen + extraLen);
    return method === 0 ? data : zlib.inflateRawSync(data);
  }
  return buf;
};

// 200 המוצרים המובילים: הכי הרבה רשתות מוכרות אותם (ברקודים בלבד, יציב בין ריצות)
function topCodes() {
  if (fs.existsSync(TOP_FILE)) return new Set(JSON.parse(fs.readFileSync(TOP_FILE, 'utf8')));
  const idx = JSON.parse(fs.readFileSync(path.join(DATA, 'd', 'center', 'index.json'), 'utf8'));
  const top = idx.filter((e) => /^\d{8,13}$/.test(e.c)).sort((a, b) => b.ch.length - a.ch.length).slice(0, 200).map((e) => e.c);
  fs.writeFileSync(TOP_FILE, JSON.stringify(top));
  return new Set(top);
}

function pricesFromXml(buf, wanted) {
  const s = (buf[0] === 0xff && buf[1] === 0xfe ? buf.toString('utf16le') : buf.toString('utf8'));
  const out = {};
  const re = /<Item>([\s\S]*?)<\/Item>/gi;
  let m;
  while ((m = re.exec(s)) !== null) {
    const code = (m[1].match(/<ItemCode>([^<]*)<\/ItemCode>/i) || [])[1];
    if (!code || !wanted.has(code.trim())) continue;
    const p = parseFloat((m[1].match(/<ItemPrice>([^<]*)<\/ItemPrice>/i) || [])[1]);
    if (isFinite(p) && p > 0) out[code.trim()] = Math.round(p * 100) / 100;
  }
  return out;
}

const branches = JSON.parse(fs.readFileSync(path.join(__dirname, 'branches.json'), 'utf8'));
const repStore = (chainId) => branches[chainId] && (branches[chainId].center || branches[chainId].telaviv || Object.values(branches[chainId])[0]);

// שליפת PriceFull היסטורי לרשת בתאריך נתון (לפי סוג הפורטל)
async function fetchHistoric(chain, dObj) {
  const dd = String(dObj.getDate()).padStart(2, '0'), mm = String(dObj.getMonth() + 1).padStart(2, '0'), yyyy = dObj.getFullYear();
  const store = chain.uniform ? chain.priceStore : (repStore(chain.id) || {}).store;
  if (!store) return null;
  if (chain.type === 'bina') {
    const res = await get(`http://${chain.sub}.binaprojects.com/MainIO_Hok.aspx?WDate=${dd}/${mm}/${yyyy}&WFileType=4`);
    const list = JSON.parse(res.text()).map((f) => f.FileNm.trim()).filter((n) => new RegExp('-' + store + '-').test(n)).sort().reverse();
    if (!list.length) return null;
    return unzip((await get(`http://${chain.sub}.binaprojects.com/Download/${encodeURIComponent(list[0])}`)).body);
  }
  if (chain.type === 'hazihinam') {
    const page = await get(`https://shop.hazi-hinam.co.il/Prices?t=1&d=${yyyy}-${mm}-${dd}`, true);
    const links = [...page.text().matchAll(new RegExp('https://[^"]*PriceFull' + chain.chainId + '-000-' + store + '-[^"]*\\.gz', 'g'))].map((x) => x[0]).sort().reverse();
    if (!links.length) return null;
    return unzip((await get(links[0], true)).body);
  }
  if (chain.type === 'carrefour') {
    const page = await get(`https://prices.carrefour.co.il/?date=${yyyy}${mm}${dd}`);
    const files = JSON.parse((page.text().match(/const files = (\[[\s\S]*?\]);/) || [, '[]'])[1]);
    const pf = files.filter((f) => f.name.startsWith(`PriceFull${chain.chainId}-001-${store}-`)).map((f) => f.name).sort().reverse();
    if (!pf.length) return null;
    return unzip((await get(`https://prices.carrefour.co.il/${yyyy}${mm}${dd}/${pf[0]}`)).body);
  }
  return null; // שופרסל/Cerberus לא חושפים תאריכים אחורה
}

(async () => {
  const wanted = topCodes();
  console.log(`באקפיל: ${wanted.size} מוצרים מובילים, ${WEEKS_BACK} שבועות אחורה`);
  const dates = [];
  for (let w = WEEKS_BACK; w >= 1; w--) dates.push(new Date(Date.now() - w * 7 * 24 * 3600 * 1000));

  // timeline[chain][code] = [[iso, price], ...] בסדר עולה
  const timeline = {};
  for (const chain of CHAIN_LIST) {
    if (!['bina', 'hazihinam', 'carrefour'].includes(chain.type)) continue;
    timeline[chain.id] = {};
    for (const dObj of dates) {
      const iso = dObj.toISOString().slice(0, 10);
      try {
        const xml = await fetchHistoric(chain, dObj);
        if (!xml) { console.log(`  ${chain.name} ${iso}: אין קובץ`); continue; }
        const prices = pricesFromXml(xml, wanted);
        for (const [code, p] of Object.entries(prices)) {
          (timeline[chain.id][code] = timeline[chain.id][code] || []).push([iso, p]);
        }
        console.log(`  ${chain.name} ${iso}: ${Object.keys(prices).length} מחירים`);
      } catch (e) {
        console.log(`  ${chain.name} ${iso}: שגיאה - ${e.message}`);
      }
    }
  }

  // מיזוג ל-shards: ההיסטוריה השבועית נכנסת לפני הנקודות הקיימות, בדחיסת שינויים-בלבד
  let touched = 0;
  for (const dist of DISTRICTS_APPLY) {
    const SDIR = path.join(DATA, 'd', dist, 's');
    if (!fs.existsSync(SDIR)) continue;
    const shardOf = (code) => code.slice(-2).padStart(2, '0');
    const byShard = new Map();
    for (const code of wanted) {
      const sh = shardOf(code);
      if (!byShard.has(sh)) {
        try { byShard.set(sh, JSON.parse(fs.readFileSync(path.join(SDIR, sh + '.json'), 'utf8'))); } catch { byShard.set(sh, null); }
      }
      const shard = byShard.get(sh);
      const rec = shard && shard[code];
      if (!rec) continue;
      for (const [chainId, codes] of Object.entries(timeline)) {
        const past = codes[code];
        if (!past || !past.length) continue;
        const existing = rec.history[chainId] || [];
        const all = [...past, ...existing].sort((a, b) => a[0].localeCompare(b[0]));
        const compressed = [];
        for (const pt of all) {
          const last = compressed[compressed.length - 1];
          if (!last || last[1] !== pt[1]) compressed.push(pt);
        }
        if (compressed.length !== existing.length) { rec.history[chainId] = compressed; touched++; }
      }
    }
    for (const [sh, shard] of byShard) {
      if (shard) fs.writeFileSync(path.join(SDIR, sh + '.json'), JSON.stringify(shard));
    }
    console.log(`${dist}: עודכן`);
  }
  console.log(`באקפיל הושלם: ${touched} צירי מוצר-רשת קיבלו היסטוריה`);
})();
