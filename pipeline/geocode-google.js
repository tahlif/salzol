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
async function geocodeAddr(query, relaxed) {
  await sleep(110); asked++;
  const j = await getJson(`https://maps.googleapis.com/maps/api/geocode/json?region=il&language=he&address=${encodeURIComponent(query)}&key=${KEY}`);
  const r = j && j.results && j.results[0];
  if (!r) return null;
  if (!relaxed && !['ROOFTOP', 'RANGE_INTERPOLATED', 'GEOMETRIC_CENTER'].includes(r.geometry.location_type)) return null;
  return pt(r.geometry.location);
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
    const groups = new Map();
    for (const c of CHAIN_LIST) {
      let stores; try { stores = JSON.parse(fs.readFileSync(path.join(CACHE, `stores-${c.id}.json`), 'utf8')); } catch { continue; }
      const noChain = (t) => String(t || '').split(c.name).join(' ');
      for (const s of stores) {
        const key = c.id + ':' + s.store;
        const e = geo[key];
        if (!e || !e.lat || e.prec === 'osm' || e.ovr) continue; // גם site נבדק מול כלל חוצה-הערים
        const city = canonCity(knownCityIn(noChain(s.name)) || knownCityIn(noChain(s.city)) || fromAddress(noChain(s.address)).city || normalizeCity(noChain(s.city)));
        const a = anchorFor(city);
        if (a && kmDist(e, a) > 15) { delete geo[key]; continue; }
        const gk = c.id + '|' + e.lat + ',' + e.lng;
        (groups.get(gk) || groups.set(gk, []).get(gk)).push({ key, addrOk: !junk(s.address), city });
      }
    }
    let purged = 0;
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      // נקודה אחת שמשויכת לערים שונות = שגויה בהכרח - כל החברות מגואקדות מחדש
      const cities = new Set(group.map((m) => m.city).filter(Boolean));
      if (cities.size > 1) {
        for (const m of group) { delete geo[m.key]; purged++; }
        continue;
      }
      for (const m of group.slice(1)) if (m.addrOk) { delete geo[m.key]; purged++; }
    }
    console.log(`טיהור רשומות: ${purged} חברות-ערימה נשלחו לגיאוקוד מחדש`);
  }

  let found = 0, rejected = 0, unresolved = 0;
  for (const c of CHAIN_LIST) {
    let stores;
    try { stores = JSON.parse(fs.readFileSync(path.join(CACHE, `stores-${c.id}.json`), 'utf8')); } catch { continue; }
    const noChain = (t) => String(t || '').split(c.name).join(' ');
    const cityOf = (s) => canonCity(
      knownCityIn(noChain(s.name)) || knownCityIn(noChain(s.city)) ||
      fromAddress(noChain(s.address)).city || normalizeCity(noChain(s.city))
    );
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
      if (!hit && city && cityCount.get(city) === 1) {
        hit = await places(`${c.name}, ${city}`);
        if (hit && !valid(hit)) { rejected++; hit = null; }
      }
      if (!hit && city) {
        // שם הסניף בלי שם הרשת ובלי סימנים - עדיין מחייב נפילה ליד העיר
        const cleanName = noChain(s.name).replace(/[*"'.]+/g, ' ').replace(/\s+/g, ' ').trim();
        hit = await places(`${c.name} ${cleanName} ${city}`);
        if (hit && !valid(hit)) { rejected++; hit = null; }
        if (!hit && anchor) hit = anchor; // לפחות בעיר הנכונה - עדיף על כלום או על עיר שגויה
      }
      if (hit) { geo[key] = { ...hit, prec: 'g', v: 4, ...(junk(s.address) ? {} : { a: 1 }) }; found++; }
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
