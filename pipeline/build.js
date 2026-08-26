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
const CHAIN_SET = new Set(CHAINS.map((c) => c.id));

// שעון ישראל תמיד - הראנר של GitHub רץ ב-UTC והמשתמשים קוראים את השעות כפשוטן
const ilNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
const p2 = (n) => String(n).padStart(2, '0');
const today = `${ilNow.getFullYear()}-${p2(ilNow.getMonth() + 1)}-${p2(ilNow.getDate())}`;
const stamp = today + 'T' + p2(ilNow.getHours()) + ':' + p2(ilNow.getMinutes());
const branches = JSON.parse(fs.readFileSync(BRANCHES_FILE, 'utf8'));

// ---------- מחיר ליחידה: נירמול Quantity+UnitQty לבסיס אחיד (גרם/מ"ל/יח'/מטר) ----------
// לא סומכים על UnitOfMeasurePrice של הרשתות - כל רשת מפרסמת בבסיס אחר (למטר/ל-100 גרם/לק"ג)
const UNIT_KINDS = [
  [/^(גרם|גרמים|גר|ג)$/, 'g', 1],
  [/^(קג|קילו|קילוגרם|קילוגרמים|קילו גרם|kg)$/, 'g', 1000],
  [/^(מל|מיליליטר|מיליליטרים|סמק|ml)$/, 'ml', 1],
  [/^(ליטר|ליטרים|ליטר בודד|l)$/, 'ml', 1000],
  [/^(יחידה|יחידות|יח|לא ידוע יחידות|unit|units)$/, 'unit', 1],
  [/^(מטר|מטרים)$/, 'm', 1],
];
function unitOf(uq, qty) {
  if (!isFinite(qty) || qty <= 0 || qty > 100000) return null;
  const u = String(uq || '').replace(/["'`׳״]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  for (const [re, kind, f] of UNIT_KINDS) {
    if (re.test(u)) return [Math.round(qty * f * 100) / 100, kind];
  }
  return null;
}
// ארץ ייצור: נירמול לקוד ISO דו-אותי (הרשתות כותבות עברית/קודים/זבל)
const COUNTRY_HE = { 'ישראל': 'IL', 'סין': 'CN', 'טורקיה': 'TR', 'תורכיה': 'TR', 'איטליה': 'IT', 'ספרד': 'ES', 'גרמניה': 'DE', 'פולין': 'PL', 'צרפת': 'FR', 'ארהב': 'US', 'ארצות הברית': 'US', 'הולנד': 'NL', 'בלגיה': 'BE', 'שוויץ': 'CH', 'יוון': 'GR', 'בריטניה': 'GB', 'אנגליה': 'GB', 'אוקראינה': 'UA', 'הודו': 'IN', 'תאילנד': 'TH', 'ברזיל': 'BR', 'ארגנטינה': 'AR', 'דנמרק': 'DK', 'שוודיה': 'SE', 'אוסטריה': 'AT', 'צכיה': 'CZ', 'רומניה': 'RO', 'בולגריה': 'BG', 'ליטא': 'LT', 'לטביה': 'LV', 'פורטוגל': 'PT', 'אירלנד': 'IE', 'קנדה': 'CA', 'מקסיקו': 'MX', 'וייטנאם': 'VN', 'סרי לנקה': 'LK', 'יפן': 'JP', 'קוריאה': 'KR', 'דרום קוריאה': 'KR', 'דרום אפריקה': 'ZA', 'אתיופיה': 'ET', 'קפריסין': 'CY', 'הונגריה': 'HU', 'סלובקיה': 'SK', 'סלובניה': 'SI', 'קרואטיה': 'HR', 'נורווגיה': 'NO', 'פינלנד': 'FI', 'אקוודור': 'EC', 'קולומביה': 'CO', 'פרו': 'PE', "צ'ילה": 'CL', 'אינדונזיה': 'ID', 'פיליפינים': 'PH', 'מלזיה': 'MY', 'איחוד האמירויות': 'AE', 'ירדן': 'JO', 'מצרים': 'EG' };
function countryOf(raw) {
  const s = String(raw || '').replace(/["'`׳״]/g, '').replace(/\s+/g, ' ').trim();
  if (!s || /לא ידוע|unknown/i.test(s)) return null;
  if (/^IL\d?$/i.test(s) || s.includes('ישראל')) return 'IL';
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  return COUNTRY_HE[s] || null;
}
const JUNK_BRAND = /לא ידוע|unknown|^כללי$|^-+$|^\.+$|^\d+$|^אין$|^ללא$/i;
function brandOf(raw) {
  const s = String(raw || '').replace(/\s+/g, ' ').trim();
  if (s.length < 2 || s.length > 40 || JUNK_BRAND.test(s)) return null;
  return s;
}
const dateOf = (s) => (/^\d{4}-\d{2}-\d{2}/.test(s || '') ? s.slice(0, 10) : null);

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
    const w = get('bIsWeighted') === '1';
    // שקיל בלי כמות תקינה: המחיר לפי חוק הוא לק"ג
    const unit = unitOf(get('UnitQty'), parseFloat(get('Quantity'))) || (w ? [1000, 'g'] : null);
    items.set(code, {
      name: get('ItemName').replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&'),
      price: Math.round(price * 100) / 100,
      w,
      unit,
      mc: countryOf(get('ManufactureCountry')),
      mf: brandOf(get('ManufactureName')),
      t: dateOf(get('PriceUpdateTime')),
      ls: dateOf(get('LastSaleDateTime')),
    });
  }
  return items;
}

// ---------- מבצעים (PromoFull): קוד → המבצע הזול ביותר שתקף היום ----------
// pp = מחיר אפקטיבי ליחידת מוצר: DiscountedPrice/MinQty ("2 ב-20" → 10); בלי מחיר - DiscountRate באחוזים
function parsePromos(file) {
  let buf;
  try { buf = fs.readFileSync(file); } catch { return null; }
  const s = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString('utf16le') : buf.toString('utf8');
  const out = new Map();
  const re = /<Promotion>([\s\S]*?)<\/Promotion>/gi;
  let m;
  while ((m = re.exec(s)) !== null) {
    const b = m[1];
    const get = (tag) => {
      const mm = b.match(new RegExp('<' + tag + '>([^<]*)</' + tag + '>', 'i'));
      return mm ? mm[1].trim() : '';
    };
    const end = (get('PromotionEndDateTime') || get('PromotionEndDate')).slice(0, 10);
    const start = (get('PromotionStartDateTime') || get('PromotionStartDate')).slice(0, 10);
    if (!/^\d{4}/.test(end) || end < today || (start && start > today)) continue;
    if (get('AdditionalIsCoupon') === '1') continue; // קופונים - לא מחיר מדף אמיתי
    const clubRaw = get('ClubID') || get('ClubId');
    const club = clubRaw && clubRaw !== '0' ? 1 : 0;
    const desc = get('PromotionDescription').replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').slice(0, 60);
    const itemRe = /<PromotionItem>([\s\S]*?)<\/PromotionItem>|<Item>([\s\S]*?)<\/Item>/gi;
    let im;
    while ((im = itemRe.exec(b)) !== null) {
      const ib = im[1] || im[2];
      const iget = (tag) => {
        const mm = ib.match(new RegExp('<' + tag + '>([^<]*)</' + tag + '>', 'i'));
        return mm ? mm[1].trim() : '';
      };
      const code = iget('ItemCode');
      if (!code) continue;
      const minQ = Math.max(1, Math.round(parseFloat(iget('MinQty')) || 1));
      const dp = parseFloat(iget('DiscountedPrice'));
      const rate = parseFloat(iget('DiscountRate'));
      let pp = null, rr = null;
      // MinQty>12 = כנראה תקרת מימוש ולא "N ב-X" - חלוקה בו תייצר מחיר שגוי
      if (isFinite(dp) && dp > 0) {
        if (minQ > 12) continue; // סמנטיקה דו-משמעית - עדיף בלי מבצע מאשר מבצע שגוי
        pp = Math.round((dp / minQ) * 100) / 100;
      } else if (isFinite(rate) && rate > 0 && rate < 100) rr = rate; // אחוז הנחה - מחושב מול מחיר המדף בעת השיוך
      if (pp == null && rr == null) continue;
      const rec = { pp, rr, e: end, m: minQ > 1 && minQ <= 12 ? minQ : 0, c: club, d: desc };
      const prev = out.get(code);
      // שומרים את הזול ביותר; מבצע לכולם עדיף על מבצע מועדון באותו מחיר
      if (!prev || (pp != null && (prev.pp == null || pp < prev.pp || (pp === prev.pp && prev.c && !club)))) out.set(code, rec);
    }
  }
  return out;
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
const globalBrand = new Map();
for (const id of NAME_PRIORITY) {
  for (const d of DISTRICTS) {
    const m = parsedByDistrict[d.id][id];
    if (!m) continue;
    for (const [code, it] of m) {
      if (it.name && !globalName.has(code)) globalName.set(code, it.name);
      if (it.mf && !globalBrand.has(code)) globalBrand.set(code, it.mf);
    }
  }
}

// הצבעת-רוב ארצית ליחידה ולארץ ייצור (רשתות סותרות זו את זו; הרוב מנצח),
// ו-LastSale מקסימלי (רק שופרסל ורמי לוי מפרסמים - מדד חיות של מוצר)
const unitVotes = new Map(); // code -> Map('kind:qty' -> count)
const countryVotes = new Map();
const globalLS = new Map();
for (const d of DISTRICTS) {
  for (const id of Object.keys(parsedByDistrict[d.id])) {
    for (const [code, it] of parsedByDistrict[d.id][id]) {
      if (it.unit) {
        const v = unitVotes.get(code) || unitVotes.set(code, new Map()).get(code);
        const k = it.unit[1] + ':' + it.unit[0];
        v.set(k, (v.get(k) || 0) + 1);
      }
      if (it.mc) {
        const v = countryVotes.get(code) || countryVotes.set(code, new Map()).get(code);
        v.set(it.mc, (v.get(it.mc) || 0) + 1);
      }
      if (it.ls && (!globalLS.has(code) || it.ls > globalLS.get(code))) globalLS.set(code, it.ls);
    }
  }
}
const majority = (votes) => {
  let best = null, bestN = 0, total = 0;
  for (const [k, n] of votes) { total += n; if (n > bestN) { bestN = n; best = k; } }
  return { best, n: bestN, total };
};
const globalUnit = new Map(); // code -> {u:[qty,kind], n, total}
for (const [code, v] of unitVotes) {
  const { best, n, total } = majority(v);
  const [kind, qty] = [best.slice(0, best.indexOf(':')), parseFloat(best.slice(best.indexOf(':') + 1))];
  globalUnit.set(code, { u: [qty, kind], n, total });
}
const globalCountry = new Map();
for (const [code, v] of countryVotes) globalCountry.set(code, majority(v).best);

const districtMeta = [];
const changedKeys = new Set(); // רשת+ברקוד - שינוי ארצי של רשת אחידה נספר פעם אחת
let grandProducts = 0;

// שרינקפלציה: אריזה שהתכווצה (אותו ברקוד, כמות ירדה) - נצבר לאורך זמן ב-shrink.json
const SHRINK_FILE = path.join(DATA, 'shrink.json');
let shrinkEvents = [];
try { shrinkEvents = JSON.parse(fs.readFileSync(SHRINK_FILE, 'utf8')); } catch {}
const shrinkSeen = new Set(shrinkEvents.map((e) => e.c + ':' + e.d));
// עדכון היחידה ברשומה קיימת + זיהוי כיווץ. שינוי דורש רוב אמין (2+ רשתות מסכימות,
// אלא אם המוצר קיים ברשת אחת בלבד) - כדי שרשת בודדת עם כמות שגויה לא תייצר התרעות שווא
function applyUnit(rec, code) {
  const gv = globalUnit.get(code);
  if (!gv) return;
  if (!rec.u) { rec.u = gv.u; rec.ud = today; return; }
  const [oldQ, oldK] = rec.u, [newQ, newK] = gv.u;
  if (oldK === newK && oldQ === newQ) return;
  if (gv.n < Math.min(2, gv.total)) return; // רוב לא אמין - לא נוגעים
  if (oldK === newK && newQ < oldQ * 0.97 && rec.ud && rec.ud < today) {
    const key = code + ':' + today;
    if (!shrinkSeen.has(key)) {
      shrinkSeen.add(key);
      shrinkEvents.push({ c: code, n: rec.name, k: oldK, q0: oldQ, q1: newQ, d: today });
    }
    (rec.qh = rec.qh || [[rec.ud, oldQ]]).push([today, newQ]);
  }
  rec.u = gv.u;
  rec.ud = today;
}
const STALE_CUTOFF = new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10);

// ריצות מקבילות בעבר הכניסו רשומות היסטוריה שלא לפי סדר זמן - ממיינים ומאחדים מחיר זהה עוקב;
// רשתות שהוסרו (דור אלון) לא נגררות
function tidyHistory(rec) {
  for (const k of Object.keys(rec.history)) {
    if (!CHAIN_SET.has(k)) { delete rec.history[k]; continue; }
    const h = rec.history[k];
    h.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    for (let i = h.length - 1; i > 0; i--) if (h[i][1] === h[i - 1][1]) h.splice(i, 1);
  }
}

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

  const promos = {};
  let promoAttached = 0;
  for (const id of chainIds) {
    const pm = parsePromos(path.join(CACHE, `promo-${id}-${d.id}.xml`));
    if (pm && pm.size) promos[id] = pm;
  }

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
    tidyHistory(rec);
    applyUnit(rec, code);
    const mc = globalCountry.get(code); if (mc) rec.mc = mc;
    const mf = globalBrand.get(code); if (mf) rec.mf = mf;
    const ls = globalLS.get(code); if (ls) rec.ls = ls;
    for (const id of chainIds) {
      const it = parsed[id].get(code);
      if (!it) continue;
      rec.prices[id] = { p: it.price, d: today };
      if (it.t) rec.prices[id].t = it.t; // PriceUpdateTime של הרשת עצמה - "בתוקף מאז" מדויק
      const pm = promos[id] && promos[id].get(code);
      if (pm) {
        const pp = pm.pp != null ? pm.pp : Math.round(it.price * (1 - pm.rr / 100) * 100) / 100;
        if (pp > 0 && pp < it.price) { // מבצע אמיתי בלבד - זול ממחיר המדף
          const pr = { p: pp, e: pm.e };
          if (pm.m) pr.m = pm.m;
          if (pm.c) pr.c = 1;
          if (pm.d) pr.d = pm.d;
          rec.prices[id].pr = pr;
          promoAttached++;
        }
      }
      const h = (rec.history[id] = rec.history[id] || []);
      const last = h[h.length - 1];
      if (!last || last[1] !== it.price) {
        h.push([stamp, it.price]);
        if (last) { changed++; changedKeys.add(id + ':' + code); }
      }
    }
    shard[code] = rec;
    const entry = { c: code, n: rec.name, ch: chainIds.filter((id) => rec.prices[id]) };
    if (rec.u) entry.u = rec.u;
    if (rec.mc === 'IL') entry.il = 1;
    if (rec.mf) entry.b = rec.mf;
    if (rec.ls && rec.ls < STALE_CUTOFF) entry.z = 1; // לא נמכר 120+ יום - מדורג נמוך בחיפוש
    index.push(entry);
  }
  // פירות וירקות - הצלבה לפי שם (קודים פנימיים שונים בין רשתות)
  const produce = matchProduce(parsed, chainIds);
  for (const [key, pr] of produce) {
    const shard = loadShard(shardOf(key));
    const rec = shard[key] || { name: pr.label, prices: {}, history: {} };
    rec.name = pr.label;
    rec.prices = {};
    rec.u = /\(יח'\)/.test(pr.label) ? [1, 'unit'] : [1000, 'g']; // תוצרת שקילה - מחיר לק"ג
    tidyHistory(rec);
    for (const [id, price] of Object.entries(pr.prices)) {
      rec.prices[id] = { p: price, d: today };
      const h = (rec.history[id] = rec.history[id] || []);
      const last = h[h.length - 1];
      if (!last || last[1] !== price) { h.push([stamp, price]); if (last) { changed++; changedKeys.add(id + ':' + key); } }
    }
    shard[key] = rec;
    index.push({ c: key, n: pr.label, ch: Object.keys(pr.prices), v: 1, u: rec.u });
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
      // מטא-שדות שחסרים ברשומה שנשארת נשאבים מהכפילות
      for (const f of ['u', 'mc', 'mf', 'ls']) if (!keptRec[f] && oRec[f]) keptRec[f] = oRec[f];
      if (!kept.u && keptRec.u) kept.u = keptRec.u;
      if (!kept.il && keptRec.mc === 'IL') kept.il = 1;
      if (!kept.b && keptRec.mf) kept.b = keptRec.mf;
    }
    deduped.push(kept);
  }
  for (const [sh, obj] of shards) fs.writeFileSync(path.join(SDIR, sh + '.json'), JSON.stringify(obj));
  fs.writeFileSync(path.join(DATA, 'd', d.id, 'index.json'), JSON.stringify(deduped));

  // פיד שינויי מחירים: כל שינוי מהשבוע האחרון במחוז, חדש→ישן - הדרך למצוא מה התייקר/הוזל
  const feedCutoff = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const feed = [];
  for (const obj of shards.values()) {
    for (const [code, rec] of Object.entries(obj)) {
      for (const [ch, h] of Object.entries(rec.history || {})) {
        if (h.length < 2 || !rec.prices || !rec.prices[ch]) continue;
        const last = h[h.length - 1];
        if (last[0].slice(0, 10) >= feedCutoff) feed.push({ c: code, n: rec.name, ch, f: h[h.length - 2][1], t: last[1], d: last[0] });
      }
    }
  }
  feed.sort((a, b) => (a.d < b.d ? 1 : -1));
  fs.writeFileSync(path.join(DATA, 'd', d.id, 'changes.json'), JSON.stringify(feed.slice(0, 200)));
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
  console.log(`${d.he}: ${chainIds.length} רשתות, ${index.length} מוצרים, ${changed} שינויי מחיר, ${promoAttached} מבצעים (${Object.keys(promos).length} רשתות)`);
}

shrinkEvents.sort((a, b) => (a.d < b.d ? 1 : -1));
fs.writeFileSync(SHRINK_FILE, JSON.stringify(shrinkEvents.slice(0, 500)));
if (shrinkEvents.length) console.log(`שרינקפלציה: ${shrinkEvents.length} אירועים מצטברים`);

fs.writeFileSync(path.join(DATA, 'meta.json'), JSON.stringify({
  updated: today, updatedAt: new Date().toISOString(), districts: districtMeta, stores: totalStores, priceChanges: changedKeys.size,
}));
console.log(`\nסה"כ: ${districtMeta.length} מחוזות, ${grandProducts} רשומות מוצר-מחוז, ${totalStores} סניפים, ${changedKeys.size} שינויי מחיר ייחודיים`);
