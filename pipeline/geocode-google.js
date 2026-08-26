// דיוק סופי עם Google - גרסה 2, אחרי הפקת לקחים:
//   * כתובת קודמת לשם - Geocoding על "הבנאי 3, אריאל" מבדיל בין סניפים צמודים
//   * כל תוצאה חייבת ליפול עד 15 ק"מ מעוגן-העיר של הסניף (עוגנים דרך Google, נשמרים בגיט)
//   * חיפוש-שם כללי ("שופרסל אריאל") מותר רק כשיש לרשת סניף יחיד בעיר - אחרת נוצרות ערימות
//   * שם הרשת מוסר משם הסניף לפני חילוץ העיר (סופר ספיר ≠ היישוב ספיר)
// מפתח: pipeline/google-key.txt או GOOGLE_MAPS_KEY. בלי מפתח - מדלג בשקט.
const https = require('https');
const fs = require('fs');
const path = require('path');
const CHAIN_LIST = require('./chains-list');
const { knownCityIn, fromAddress, canonCity, normalizeCity, cityToDistrict } = require('./districts');

// תיבות מחוז - עוגן עיר וכל פגיעה חייבים ליפול בתוך מחוז העיר
// ("אריאל, ישראל" בגוגל עלול להחזיר את רחוב אריאל בירושלים)
const DISTRICT_BBOX = {
  north: [32.35, 33.45, 34.85, 35.95], haifa: [32.25, 33.05, 34.80, 35.40],
  center: [31.70, 32.55, 34.55, 35.15], telaviv: [31.95, 32.30, 34.68, 35.00],
  jerusalem: [31.50, 32.00, 34.80, 35.40], south: [29.40, 31.90, 34.15, 35.55],
  yosh: [31.25, 32.65, 34.88, 35.70],
};
const inDistrictBox = (d, h) => {
  const b = DISTRICT_BBOX[d];
  return !b || (h.lat >= b[0] && h.lat <= b[1] && h.lng >= b[2] && h.lng <= b[3]);
};

const CACHE = path.join(__dirname, 'cache');
const GEO_FILE = path.join(__dirname, 'geo.json');
const CITYG_FILE = path.join(__dirname, 'city-geo-google.json');
const KEY = process.env.GOOGLE_MAPS_KEY || (() => {
  try { return fs.readFileSync(path.join(__dirname, 'google-key.txt'), 'utf8').trim(); } catch { return ''; }
})();
if (!KEY) {
  console.log('אין מפתח Google (pipeline/google-key.txt או GOOGLE_MAPS_KEY) - מדלג על שלב הדיוק');
  process.exit(0);
}

const getJson = (url) => new Promise((resolve) => {
  https.get(url, (res) => {
    let s = '';
    res.on('data', (d) => (s += d));
    res.on('end', () => { try { resolve(JSON.parse(s)); } catch { resolve(null); } });
  }).on('error', () => resolve(null));
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const junk = (s) => !s || s === 'unknown' || /^https?:/.test(s);
const kmDist = (a, b) => {
  const dLat = (a.lat - b.lat) * 111, dLng = (a.lng - b.lng) * 94;
  return Math.sqrt(dLat * dLat + dLng * dLng);
};
const pt = (loc) => ({ lat: +loc.lat.toFixed(6), lng: +loc.lng.toFixed(6) });

let asked = 0;
async function places(query) {
  await sleep(110); asked++;
  const j = await getJson(`https://maps.googleapis.com/maps/api/place/textsearch/json?region=il&language=he&query=${encodeURIComponent(query)}&key=${KEY}`);
  const r = j && j.results && j.results[0];
  return r ? pt(r.geometry.location) : null;
}
// תוצאות ברמת מדינה/עיר/מחוז אסורות גם במצב "רגוע" - "אבי זהר, , ישראל" שנכשל
// החזיר את מרכז ישראל (בנגב!) ותשעה סניפים מערים שונות נערמו שם
const BAD_RESULT_TYPES = new Set(['country', 'administrative_area_level_1', 'administrative_area_level_2', 'locality', 'postal_town']);
async function geocodeAddr(query, relaxed) {
  await sleep(110); asked++;
  const j = await getJson(`https://maps.googleapis.com/maps/api/geocode/json?region=il&language=he&address=${encodeURIComponent(query)}&key=${KEY}`);
  const r = j && j.results && j.results[0];
  if (!r) return null;
  if ((r.types || []).some((t) => BAD_RESULT_TYPES.has(t))) return null;
  if (!relaxed && !['ROOFTOP', 'RANGE_INTERPOLATED', 'GEOMETRIC_CENTER'].includes(r.geometry.location_type)) return null;
  return pt(r.geometry.location);
}

// שכונות מוכרות → העיר שלהן: סניפים בלי שדה עיר ששמם/כתובתם מזכירים שכונה
// מקבלים עוגן-עיר לאימות (בלעדיו כל תוצאה שגויה מתקבלת)
const NEIGHBORHOODS = [
  [/גילה|בית הכרם|פסגת זאב|נווה יעקב|הר חומה|תלפיות|קטמון|גבעת שאול|רמת שלמה|מלחה|ארנונה|רוממה|קרית יובל|קרית מנחם|בקעה|גבעת מרדכי|שכונת פת|רמות אשכול|סנהדריה|הגבעה הצרפתית|עיר גנים|י[-_ ]?ם\b/, 'ירושלים'],
  [/יד אליהו|רמת אביב|נווה צדק|פלורנטין|התקווה|צהלה|רמת החייל|נאות אפקה|עזריאלי|שרונה|ת"א|ת'א/, 'תל אביב - יפו'],
  [/נווה שאנן|קרית חיים|קרית שמואל|רמת ויז'ניץ|הדר הכרמל/, 'חיפה'],
  [/רובע [א-ט]'?\b|שכונה [א-ט]'?\b|רמות ב"ש|נאות לון|ב"ש|ב'ש/, 'באר שבע'],
  [/קיראון/, 'קרית אונו'],
  [/קרית ספר/, 'מודיעין עילית'],
];
const neighborhoodCity = (text) => {
  for (const [re, city] of NEIGHBORHOODS) if (re.test(text || '')) return city;
  return null;
};

// עיר-מועמדת חייבת להיות יישוב אמיתי (cityToDistrict) - אחרת "שדרות משה דיין" הופך לעיר;
// כשאין - שכונה מוכרת מהשם/כתובת קובעת את העיר
function resolveCity(noChain, s) {
  const cand = canonCity(
    knownCityIn(noChain(s.name)) || knownCityIn(noChain(s.city)) ||
    fromAddress(noChain(s.address)).city || normalizeCity(noChain(s.city))
  );
  if (cand && cityToDistrict(cand)) return cand;
  return neighborhoodCity(noChain(s.name) + ' ' + noChain(s.address)) || null;
}

(async () => {
  const geo = JSON.parse(fs.readFileSync(GEO_FILE, 'utf8'));
  let cityG = {};
  try { cityG = JSON.parse(fs.readFileSync(CITYG_FILE, 'utf8')); } catch {}
  let nomiCity = {};
  try { nomiCity = JSON.parse(fs.readFileSync(path.join(__dirname, 'city-geo.json'), 'utf8')); } catch {}
  // עוגן עיר: city-geo.json בלבד (נבנה בשאילתות מובנות ע"י city-anchors.js) - הסמכות היחידה
  const anchorFor = (city) => (city && nomiCity[city]) || null;

  // טיהור עוגנים מורעלים: מחוץ למחוז העיר, או סותר את Nominatim ביותר מ-20 ק"מ
  let purgedAnchors = 0;
  for (const [city, a] of Object.entries(cityG)) {
    if (!a) continue;
    const d = cityToDistrict(city);
    const n = nomiCity[city];
    if ((d && !inDistrictBox(d, a)) || (n && kmDist(a, n) > 20)) { delete cityG[city]; purgedAnchors++; }
  }
  if (purgedAnchors) { console.log(`טוהרו ${purgedAnchors} עוגני-עיר מורעלים`); fs.writeFileSync(CITYG_FILE, JSON.stringify(cityG)); }

  // Nominatim - ספק גיבוי לכתובות שגוגל עיוור אליהן (יו"ש)
  const nominatimAddr = (q) => new Promise((resolve) => {
    https.get('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=il,ps&q=' + encodeURIComponent(q),
      { headers: { 'User-Agent': 'salzol-price-compare/1.0' } }, (res) => {
        let s = '';
        res.on('data', (d) => (s += d));
        res.on('end', () => { try { const a = JSON.parse(s); resolve(a[0] ? { lat: +(+a[0].lat).toFixed(6), lng: +(+a[0].lon).toFixed(6) } : null); } catch { resolve(null); } });
      }).on('error', () => resolve(null));
  });

  // טיהור רשומות: נקודה רחוקה מעוגן תקין, או חברה-בערימה עם כתובת ייחודית - לגיאוקוד מחדש
  {
    const groups = new Map();      // ערימות בתוך אותה רשת
    const crossGroups = new Map(); // ערימות חוצות-רשתות - 9 סניפים מערים שונות על נקודה אחת
    for (const c of CHAIN_LIST) {
      let stores; try { stores = JSON.parse(fs.readFileSync(path.join(CACHE, `stores-${c.id}.json`), 'utf8')); } catch { continue; }
      const noChain = (t) => String(t || '').split(c.name).join(' ');
      for (const s of stores) {
        const key = c.id + ':' + s.store;
        const e = geo[key];
        if (!e || !e.lat || e.prec === 'osm' || e.prec === 'city' || e.ovr) continue; // עוגן-עיר משותף במתכוון
        const city = resolveCity(noChain, s);
        const a = anchorFor(city);
        if (a && kmDist(e, a) > 15) { delete geo[key]; continue; }
        const rec = { key, chain: c.id, addrOk: !junk(s.address), city, street: fromAddress(noChain(s.address)).street || String(s.address || '').trim() };
        const gk = c.id + '|' + e.lat + ',' + e.lng;
        (groups.get(gk) || groups.set(gk, []).get(gk)).push(rec);
        const xk = e.lat + ',' + e.lng;
        (crossGroups.get(xk) || crossGroups.set(xk, []).get(xk)).push(rec);
      }
    }
    let purged = 0;
    const purge = (m) => { if (geo[m.key]) { delete geo[m.key]; purged++; } };
    // חוצה-רשתות: נקודה זהה עם רשתות שונות וכתובות שונות = ערימה שגויה (קניון אמיתי = osm/site שמוחרגים)
    for (const group of crossGroups.values()) {
      if (group.length < 2 || new Set(group.map((m) => m.chain)).size < 2) continue;
      const cities = new Set(group.map((m) => m.city).filter(Boolean));
      const addrs = new Set(group.map((m) => (m.street || '').replace(/\s+/g, ' ').trim()).filter(Boolean));
      if (cities.size > 1 || addrs.size > 1) group.forEach(purge);
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      // נקודה אחת שמשויכת לערים שונות = שגויה בהכרח - כל החברות מגואקדות מחדש
      const cities = new Set(group.map((m) => m.city).filter(Boolean));
      if (cities.size > 1) {
        group.forEach(purge);
        continue;
      }
      for (const m of group.slice(1)) if (m.addrOk) purge(m);
    }
    console.log(`טיהור רשומות: ${purged} חברות-ערימה נשלחו לגיאוקוד מחדש`);
  }

  let found = 0, rejected = 0, unresolved = 0;
  // נקודות תפוסות: תוצאת חיפוש-שם שנוחתת על נקודה של סניף אחר = ערימה חדשה - נפסלת
  const occupied = new Map(); // 'lat,lng' -> key
  for (const [k, v] of Object.entries(geo)) if (v && v.lat && v.prec !== 'city') occupied.set(v.lat + ',' + v.lng, k);
  const takenByOther = (h, key) => { const o = occupied.get(h.lat + ',' + h.lng); return o && o !== key; };
  for (const c of CHAIN_LIST) {
    let stores;
    try { stores = JSON.parse(fs.readFileSync(path.join(CACHE, `stores-${c.id}.json`), 'utf8')); } catch { continue; }
    const noChain = (t) => String(t || '').split(c.name).join(' ');
    const cityOf = (s) => resolveCity(noChain, s);
    // כמה סניפים יש לרשת בכל עיר - חיפוש-שם כללי מותר רק לעיר עם סניף יחיד
    const cityCount = new Map();
    for (const s of stores) { const ci = cityOf(s); if (ci) cityCount.set(ci, (cityCount.get(ci) || 0) + 1); }

    for (const s of stores) {
      const key = c.id + ':' + s.store;
      const e = geo[key];
      if (e && (e.prec === 'osm' || e.prec === 'site' || e.ovr || (e.prec === 'g' && e.v === 4))) continue; // מדויק/כבר-אומת בגרסה הנוכחית
      const city = cityOf(s);
      const cityDist = city ? cityToDistrict(city) : null;
      const anchor = anchorFor(city);
      const valid = (h) => h && (!anchor || kmDist(h, anchor) <= 15) && (!cityDist || inDistrictBox(cityDist, h));

      let hit = null;
      const addrOk = !junk(s.address);
      if (addrOk) {
        hit = await geocodeAddr(`${noChain(s.address)}, ${city || ''}, ישראל`);
        if (hit && !valid(hit)) { rejected++; hit = null; }
      }
      if (!hit && addrOk) {
        // גם דיוק-רחוב מספיק - מבדיל בין שני סניפים באותו רחוב, ועדיף על תוצאת-חיפוש שנערמת
        hit = await geocodeAddr(`${noChain(s.address)}, ${city || ''}, ישראל`, true);
        if (hit && !valid(hit)) { rejected++; hit = null; }
      }
      if (!hit && addrOk) {
        hit = await places(`${c.name}, ${noChain(s.address)}, ${city || ''}`);
        if (hit && !valid(hit)) { rejected++; hit = null; }
      }
      let anchored = false;
      if (!hit && city && cityCount.get(city) === 1) {
        hit = await places(`${c.name}, ${city}`);
        if (hit && (!valid(hit) || takenByOther(hit, key))) { rejected++; hit = null; }
      }
      if (!hit && city) {
        // שם הסניף בלי שם הרשת ובלי סימנים - עדיין מחייב נפילה ליד העיר, ולא על נקודה תפוסה
        const cleanName = noChain(s.name).replace(/[*"'.]+/g, ' ').replace(/\s+/g, ' ').trim();
        hit = await places(`${c.name} ${cleanName} ${city}`);
        if (hit && (!valid(hit) || takenByOther(hit, key))) { rejected++; hit = null; }
        if (!hit && anchor) { hit = anchor; anchored = true; } // לפחות בעיר הנכונה - מסומן כדיוק-עיר
      }
      if (hit) {
        geo[key] = anchored
          ? { ...hit, prec: 'city' } // עוגן-עיר משותף במתכוון - לא מתחזה לנקודת-חנות
          : { ...hit, prec: 'g', v: 4, ...(junk(s.address) ? {} : { a: 1 }) };
        if (!anchored) occupied.set(hit.lat + ',' + hit.lng, key);
        found++;
      }
      else { if (e && e.prec === 'g' && e.v !== 3) delete geo[key]; unresolved++; }
      if (asked % 100 < 2) fs.writeFileSync(GEO_FILE, JSON.stringify(geo));
    }
  }

  // פירוד ערימות: כמה סניפים של אותה רשת על נקודה זהה - מי שיש לו כתובת ייחודית
  // מקבל geocode כתובת "רגוע" (גם דיוק-רחוב מספיק כדי להפריד בין הבנאי 3 להבנאי 6)
  let separated = 0;
  const groups = new Map();
  for (const c of CHAIN_LIST) {
    let stores;
    try { stores = JSON.parse(fs.readFileSync(path.join(CACHE, `stores-${c.id}.json`), 'utf8')); } catch { continue; }
    for (const s of stores) {
      const e = geo[c.id + ':' + s.store];
      if (!e || !e.lat || e.ovr) continue;
      const k = c.id + '|' + e.lat + ',' + e.lng;
      (groups.get(k) || groups.set(k, []).get(k)).push({ chain: c, s });
    }
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const { chain, s } of group.slice(1)) {
      if (junk(s.address)) continue;
      const noChain = (t) => String(t || '').split(chain.name).join(' ');
      const city = canonCity(knownCityIn(noChain(s.name)) || knownCityIn(noChain(s.city)) || fromAddress(noChain(s.address)).city || normalizeCity(noChain(s.city)));
      const cityDist = city ? cityToDistrict(city) : null;
      const anchor = anchorFor(city);
      const ok = (h) => h && (!anchor || kmDist(h, anchor) <= 15) && (!cityDist || inDistrictBox(cityDist, h));
      let h = await geocodeAddr(`${noChain(s.address)}, ${city || ''}, ישראל`, true);
      if (!ok(h)) {
        // גוגל עיוור לכתובת (קורה ביו"ש) - Nominatim דווקא מכיר את הרחובות שם
        await sleep(1100);
        h = await nominatimAddr(`${noChain(s.address)}, ${city || ''}`);
        if (!ok(h)) h = null;
      }
      if (h) {
        const base = geo[chain.id + ':' + s.store];
        if (h.lat !== base.lat || h.lng !== base.lng) { geo[chain.id + ':' + s.store] = { ...h, prec: 'g', v: 4, a: 1 }; separated++; }
      }
    }
  }
  fs.writeFileSync(GEO_FILE, JSON.stringify(geo));
  console.log(`Google v2.1: ${found} מוקמו ואומתו, ${rejected} נפסלו, ${separated} ערימות פורדו לפי כתובת, ${unresolved} ללא פתרון (${asked} שאילתות)`);
})();
