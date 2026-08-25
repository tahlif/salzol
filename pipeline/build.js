// זול-לי: בנייה - פירסור cache, הצלבה לפי ברקוד בכל מחוז, שמירת שינויים בלבד.
// שימוש: node pipeline/build.js
const fs = require('fs');
const path = require('path');
const { DISTRICTS, knownCityIn, canonCity, fromAddress, normalizeCity } = require('./districts');

const CACHE = path.join(__dirname, 'cache');
const DATA = path.join(__dirname, '..', 'site', 'data');
const BRANCHES_FILE = path.join(__dirname, 'branches.json');
fs.mkdirSync(DATA, { recursive: true });

const CHAINS = require('./chains-list').map(({ id, name }) => ({ id, name }));

const today = new Date().toISOString().slice(0, 10);
const now=new Date(); const stamp = today + 'T' + String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0');
const branches = JSON.parse(fs.readFileSync(BRANCHES_FILE, 'utf8'));

function parseItems(file) {
  let buf;
  try { buf = fs.readFileSync(file); } catch { return null; }
  const s = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString('utf16le') : buf.toString('utf8');
  const items = new Map();
  const re = /<Item>([\s\S]*?)<\/Item>/gi;
  let m;
  while ((m = re.exec(s)) !== null) {
    const b = m[1];
    const get = (tag) => {
      const mm = b.match(new RegExp('<' + tag + '>([^<]*)</' + tag + '>', 'i'));
      return mm ? mm[1].trim() : '';
    };
    const code = get('ItemCode');
    const price = parseFloat(get('ItemPrice'));
    if (!code || !isFinite(price) || price <= 0) continue;
    items.set(code, {
      name: get('ItemName').replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&'),
      price: Math.round(price * 100) / 100,
      w: get('bIsWeighted') === '1',
    });
  }
  return items;
}

// ---------- רשימת סניפים מלאה לאתר (כולל קואורדינטות מ-geocode.js אם קיימות) ----------
let geo = {};
try { geo = JSON.parse(fs.readFileSync(path.join(__dirname, 'geo.json'), 'utf8')); } catch {}
const storesAll = {};
let totalStores = 0, geoCount = 0;
for (const c of CHAINS) {
  try {
    const stores = JSON.parse(fs.readFileSync(path.join(CACHE, `stores-${c.id}.json`), 'utf8'));
    const chosen = branches[c.id] || {};
    const chosenIds = new Set(Object.values(chosen).map((s) => s.store));
    const noChain = (t) => String(t || '').split(c.name).join(' ');
    for (const s of stores) {
      const d = s.district || 'other';
      storesAll[d] = storesAll[d] || {};
      storesAll[d][c.id] = storesAll[d][c.id] || [];
      // עיר קנונית מחולצת - הרבה סניפים מגיעים עם שדה עיר ריק/זבל, וזה שובר סינון לפי עיר
      const cCity = canonCity(knownCityIn(noChain(s.name)) || knownCityIn(noChain(s.city)) || fromAddress(noChain(s.address)).city || normalizeCity(noChain(s.city)));
      const rec = { store: s.store, name: s.name, city: cCity || s.city, used: chosenIds.has(s.store) && chosen[d] && chosen[d].store === s.store };
      const g = geo[c.id + ':' + s.store];
      if (g && !g.miss) { rec.lat = g.lat; rec.lng = g.lng; if (g.prec === 'city') rec.approx = 1; geoCount++; }
      storesAll[d][c.id].push(rec);
      totalStores++;
    }
  } catch { console.warn(`אין stores-${c.id}.json`); }
}
console.log(`קואורדינטות: ${geoCount}/${totalStores} סניפים`);
fs.writeFileSync(path.join(DATA, 'stores-all.json'), JSON.stringify(storesAll));
fs.writeFileSync(path.join(DATA, 'chains.json'), JSON.stringify(CHAINS));
try {
  const cbs = JSON.parse(fs.readFileSync(path.join(__dirname, 'cities-il.json'), 'utf8'));
  fs.writeFileSync(path.join(DATA, 'cities.json'), JSON.stringify(cbs.filter((c) => c.d)));
} catch { console.warn('אין cities-il.json - הרץ node pipeline/fetch-cities.js'); }

// ---------- דאטת מחירים לכל מחוז ----------
// שלב 1: פירסור הכול + שם קנוני אחד לכל ברקוד בכל הארץ
// (אחרת אותו מוצר מקבל שם שונה באזורים שונים - לפי הרשתות שבמקרה נמצאות שם)
const parsedByDistrict = {};
for (const d of DISTRICTS) {
  parsedByDistrict[d.id] = {};
  for (const c of CHAINS) {
    const items = parseItems(path.join(CACHE, `${c.id}-${d.id}.xml`));
    if (items && items.size) parsedByDistrict[d.id][c.id] = items;
  }
}
const NAME_PRIORITY = ['shufersal', 'carrefour', 'hazihinam', 'yohananof', 'osherad', 'tivtaam', 'keshet', 'freshmarket', 'salachd', 'stopmarket', 'politzer', 'supersapir', 'kingstore', 'maayan2000', 'zolvebegadol', 'superbareket', 'shefabirkathashem', 'shukhayir', 'ramilevy'];
const globalName = new Map();
for (const id of NAME_PRIORITY) {
  for (const d of DISTRICTS) {
    const m = parsedByDistrict[d.id][id];
    if (!m) continue;
    for (const [code, it] of m) {
      if (it.name && !globalName.has(code)) globalName.set(code, it.name);
    }
  }
}

const districtMeta = [];
const changedKeys = new Set(); // רשת+ברקוד - שינוי ארצי של רשת אחידה נספר פעם אחת
let grandProducts = 0;

const SAMPLE_RES = [
  [/קוטג/], [/במבה/], [/קוקה.?קולה/], [/מילקי/], [/חלב.*3%|3%.*חלב|מועשר.?3%/],
  [/ביסלי/], [/שוקולד.*פרה|פרה.*במילו|ממולדה/], [/טחינה/], [/טונה/], [/פתי.?בר|פתיבר/],
];
let sampleWritten = false;

// פירות וירקות: לכל רשת קוד פנימי משלה (אין ברקוד אוניברסלי) - לכן ההצלבה לפי שם,
// רק פריטים שקילים (bIsWeighted), מהמופע הבסיסי ביותר (השם הקצר ביותר שמתאים).
const PRODUCE = [
  ['v-tomato', 'עגבניות (ק"ג)', /עגבני/, /שרי|מיובש|רסק|משומר|תרד|צלוי/],
  ['v-cherrytomato', 'עגבניות שרי (ק"ג)', /עגבני.*שרי|שרי/, /רסק|מיובש|תירס|צנצנת/],
  ['v-cucumber', 'מלפפונים (ק"ג)', /מלפפון/, /חמוץ|מוחמץ|בייבי|צנצנת|מלוח/],
  ['v-onion', 'בצל יבש (ק"ג)', /בצל/, /ירוק|סגול|מטוגן|טבעות|קפוא|שמיר/],
  ['v-potato', 'תפוחי אדמה (ק"ג)', /תפו.?אדמה|תפוח אדמה|תפוחי אדמה/, /קפוא|צ'יפס|מיני|אדום/],
  ['v-sweetpotato', 'בטטה (ק"ג)', /בטטה/, /קפוא|צ'יפס/],
  ['v-carrot', 'גזר (ק"ג)', /גזר/, /גמדי|קפוא|מגורד|אפוי|מיץ/],
  ['v-pepper-red', 'פלפל אדום (ק"ג)', /פלפל אדום/, /חריף|קפוא|גריל/],
  ['v-pepper-yellow', 'פלפל צהוב (ק"ג)', /פלפל צהוב/, /חריף/],
  ['v-eggplant', 'חצילים (ק"ג)', /חציל/, /קפוא|מטוגן|סלט|במיונז/],
  ['v-zucchini', 'קישואים (ק"ג)', /קישוא/, /קפוא/],
  ['v-cabbage', 'כרוב לבן (ק"ג)', /כרוב לבן|כרוב(?! אדום| סגול| ניצנים| מוחמץ| כבוש| סיני)/, /אדום|סגול|ניצנים|מוחמץ|כבוש|סיני|כרובית/],
  ['v-cauliflower', 'כרובית (ק"ג)', /כרובית/, /קפוא/],
  ['v-lettuce', 'חסה (יח\')', /חסה/, /שטופה|מארז|לבבות/],
  ['v-garlic', 'שום (ק"ג)', /שום(?! גבישי)/, /אבקת|כתוש|קפוא|שומשום|קונפי|שן/],
  ['v-banana', 'בננות (ק"ג)', /בננה|בננות/, /צ'יפס|מיובש|יבש/],
  ['v-apple', 'תפוח עץ (ק"ג)', /תפוח.*(פינק|גאלה|זהוב|גרנד|סמיט|עץ)|תפוחים/, /אדמה|מיץ|רסק|מיובש/],
  ['v-pear', 'אגסים (ק"ג)', /אגס/, /משומר|מיובש/],
  ['v-lemon', 'לימון (ק"ג)', /לימון/, /מיץ|ליים|חריף|סחוט|לימונדה|מלח/],
  ['v-orange', 'תפוזים (ק"ג)', /תפוז/, /מיץ|סחוט|קליפ/],
  ['v-clementine', 'קלמנטינות (ק"ג)', /קלמנטינ/, null],
  ['v-avocado', 'אבוקדו (ק"ג)', /אבוקדו/, /ממרח|שמן/],
  ['v-watermelon', 'אבטיח (ק"ג)', /אבטיח/, /מלון|גרעיני|חצי|רבע/],
  ['v-melon', 'מלון (ק"ג)', /מלון(?! אישי)/, /אבטיח|חצי/],
  ['v-grapes', 'ענבים (ק"ג)', /ענבים/, /מיץ|צימוק|עלי/],
  ['v-peach', 'אפרסק (ק"ג)', /אפרסק/, /משומר|יין/],
  ['v-nectarine', 'נקטרינה (ק"ג)', /נקטרינ/, null],
  ['v-mango', 'מנגו (ק"ג)', /מנגו/, /קפוא|מיובש|מיץ|רוטב/],
  ['v-strawberry', 'תות שדה (ק"ג)', /תות/, /קפוא|ריבת|יוגורט|גלידת|בטעם/],
  ['v-pomegranate', 'רימון (ק"ג)', /רימון/, /גרעיני|מיץ|קפוא/],
  ['v-date', 'תמרים מג\'הול (ק"ג)', /תמר.*מג'הול|מגהול|מג'הול/, /ממרח|סילאן/],
];

function matchProduce(parsed, chainIds) {
  const out = new Map(); // key -> {label, prices: {chain: price}}
  for (const [key, label, inc, exc] of PRODUCE) {
    const prices = {};
    for (const id of chainIds) {
      const cands = [];
      for (const it of parsed[id].values()) {
        if (!it.w) continue;
        if (!inc.test(it.name)) continue;
        if (exc && exc.source && exc.test(it.name)) continue;
        cands.push(it);
      }
      if (!cands.length) continue;
      cands.sort((a, b) => a.name.length - b.name.length);
      prices[id] = cands[0].price;
    }
    if (Object.keys(prices).length >= 2) out.set(key, { label, prices });
  }
  return out;
}

for (const d of DISTRICTS) {
  const parsed = parsedByDistrict[d.id];
  const chainIds = Object.keys(parsed);
  if (chainIds.length < 2) { console.log(`${d.he}: רק ${chainIds.length} רשתות - מדלג`); continue; }

  // כל המוצרים נכנסים לאינדקס - גם כאלה שרק ברשת אחת (מוצרי חשמל, מותגים פרטיים);
  // ההשוואה והסה"כ ממילא נבנים רק ממה שקיים בכמה רשתות.
  const counts = new Map();
  for (const id of chainIds) for (const code of parsed[id].keys()) counts.set(code, (counts.get(code) || 0) + 1);
  const codes = [...counts.keys()];

  // shards: קובץ אחד לכל 2 ספרות אחרונות של הברקוד (מגבלת קבצים של Cloudflare Pages)
  const SDIR = path.join(DATA, 'd', d.id, 's');
  fs.mkdirSync(SDIR, { recursive: true });
  const shardOf = (code) => code.slice(-2).padStart(2, '0');
  const shards = new Map();
  const loadShard = (sh) => {
    if (!shards.has(sh)) {
      let obj = {};
      try { obj = JSON.parse(fs.readFileSync(path.join(SDIR, sh + '.json'), 'utf8')); } catch {}
      shards.set(sh, obj);
    }
    return shards.get(sh);
  };

  const index = [];
  let changed = 0;
  for (const code of codes) {
    const shard = loadShard(shardOf(code));
    const rec = shard[code] || { prices: {}, history: {} };
    rec.name = globalName.get(code) || rec.name || code; // שם קנוני אחיד בכל הארץ
    rec.prices = {};
    for (const id of chainIds) {
      const it = parsed[id].get(code);
      if (!it) continue;
      rec.prices[id] = { p: it.price, d: today };
      const h = (rec.history[id] = rec.history[id] || []);
      const last = h[h.length - 1];
      if (!last || last[1] !== it.price) {
        h.push([stamp, it.price]);
        if (last) { changed++; changedKeys.add(id + ':' + code); }
      }
    }
    shard[code] = rec;
    index.push({ c: code, n: rec.name, ch: chainIds.filter((id) => rec.prices[id]) });
  }
  // פירות וירקות - הצלבה לפי שם (קודים פנימיים שונים בין רשתות)
  const produce = matchProduce(parsed, chainIds);
  for (const [key, pr] of produce) {
    const shard = loadShard(shardOf(key));
    const rec = shard[key] || { name: pr.label, prices: {}, history: {} };
    rec.name = pr.label;
    rec.prices = {};
    for (const [id, price] of Object.entries(pr.prices)) {
      rec.prices[id] = { p: price, d: today };
      const h = (rec.history[id] = rec.history[id] || []);
      const last = h[h.length - 1];
      if (!last || last[1] !== price) { h.push([stamp, price]); if (last) { changed++; changedKeys.add(id + ':' + key); } }
    }
    shard[key] = rec;
    index.push({ c: key, n: pr.label, ch: Object.keys(pr.prices), v: 1 });
  }

  // איחוד כפילויות: אותו שם בדיוק = רשומה אחת - אבל ממזגים, לא זורקים:
  // מחירים והיסטוריה של רשתות שחסרות ברשומה שנשארת עוברים אליה מהכפילויות.
  // עדיפות: שכבת פירות/ירקות, אחר-כך כיסוי רשתות, אחר-כך ברקוד אמיתי.
  const score = (e) => (e.c.startsWith('v-') ? 1000 : 0) + e.ch.length * 10 + (/^\d{8,13}$/.test(e.c) ? 5 : 0);
  const groups = new Map();
  for (const e of index) {
    const k = e.n.replace(/\s+/g, ' ').trim();
    (groups.get(k) || groups.set(k, []).get(k)).push(e);
  }
  const deduped = [];
  let dropped = 0;
  for (const group of groups.values()) {
    group.sort((a, b) => score(b) - score(a));
    const kept = group[0];
    const keptRec = loadShard(shardOf(kept.c))[kept.c];
    for (const other of group.slice(1)) {
      dropped++;
      const oRec = loadShard(shardOf(other.c))[other.c];
      if (!oRec) continue;
      for (const chain of other.ch) {
        if (!keptRec.prices[chain] && oRec.prices[chain]) {
          keptRec.prices[chain] = oRec.prices[chain];
          keptRec.history[chain] = oRec.history[chain] || [];
          kept.ch.push(chain);
        }
      }
    }
    deduped.push(kept);
  }
  for (const [sh, obj] of shards) fs.writeFileSync(path.join(SDIR, sh + '.json'), JSON.stringify(obj));
  fs.writeFileSync(path.join(DATA, 'd', d.id, 'index.json'), JSON.stringify(deduped));
  index.length = 0; index.push(...deduped);
  if (dropped) console.log(`  ${d.he}: מוזגו ${dropped} כפילויות שם`);

  const inAll = index.filter((e) => e.ch.length === chainIds.length);
  if (!sampleWritten && chainIds.length >= 3) {
    const used = new Set(); const sample = [];
    for (const [re] of SAMPLE_RES) {
      const cands = inAll.filter((e) => !used.has(e.c) && re.test(e.n)).sort((a, b) => a.n.length - b.n.length);
      if (cands.length) { used.add(cands[0].c); sample.push(cands[0].c); }
    }
    fs.writeFileSync(path.join(DATA, 'sample.json'), JSON.stringify(sample));
    sampleWritten = true;
  }

  districtMeta.push({
    id: d.id, he: d.he, chains: chainIds, products: index.length,
    branches: Object.fromEntries(chainIds.map((id) => [id, branches[id][d.id] ? { name: branches[id][d.id].name, city: branches[id][d.id].city } : null])),
  });
  grandProducts += index.length;
  console.log(`${d.he}: ${chainIds.length} רשתות, ${index.length} מוצרים, ${changed} שינויי מחיר`);
}

fs.writeFileSync(path.join(DATA, 'meta.json'), JSON.stringify({
  updated: today, updatedAt: new Date().toISOString(), districts: districtMeta, stores: totalStores, priceChanges: changedKeys.size,
}));
console.log(`\nסה"כ: ${districtMeta.length} מחוזות, ${grandProducts} רשומות מוצר-מחוז, ${totalStores} סניפים, ${changedKeys.size} שינויי מחיר ייחודיים`);
