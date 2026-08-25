// גיאוקוד חד-פעמי של סניפים דרך Nominatim (OSM). מכבד את מדיניות השימוש: בקשה אחת לשנייה.
// resumable: תוצאות נשמרות ב-pipeline/geo.json ולא נשאלות שוב. ריצות לילה מגאקדות רק סניפים חדשים.
// שימוש: node pipeline/geocode.js
const https = require('https');
const fs = require('fs');
const path = require('path');
const { knownCityIn, fromAddress, canonCity } = require('./districts');

const CACHE = path.join(__dirname, 'cache');
const GEO_FILE = path.join(__dirname, 'geo.json');
const CHAIN_LIST = require('./chains-list');
const CHAIN_IDS = CHAIN_LIST.map((c) => c.id);

let geo = {};
try { geo = JSON.parse(fs.readFileSync(GEO_FILE, 'utf8')); } catch {}

function nominatim(q) {
  // il,ps: יישובי יהודה ושומרון רשומים ב-OSM תחת קוד המדינה ps - בלעדיו כל יו"ש נופל
  const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=il,ps&q=' + encodeURIComponent(q);
  return new Promise((resolve) => {
    https.get(url, { headers: { 'User-Agent': 'zulik-price-compare/1.0 (personal project)' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const arr = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          resolve(arr[0] ? { lat: +(+arr[0].lat).toFixed(5), lng: +(+arr[0].lon).toFixed(5) } : null);
        } catch { resolve(null); }
      });
    }).on('error', () => resolve(null)).setTimeout(20000, function () { this.destroy(); resolve(null); });
  });
}

// תיבות גבול גסות לכל מחוז [latMin, latMax, lonMin, lonMax] - פוסלות פגיעות שגויות
// (למשל "שופרסל, אריאל" שמחזיר רחוב אריאל שרון בתל אביב)
const DISTRICT_BBOX = {
  north: [32.35, 33.45, 34.85, 35.95],
  haifa: [32.25, 33.05, 34.80, 35.40],
  center: [31.70, 32.55, 34.55, 35.15],
  telaviv: [31.95, 32.30, 34.68, 35.00],
  jerusalem: [31.50, 32.00, 34.80, 35.40],
  south: [29.40, 31.90, 34.15, 35.55],
  yosh: [31.25, 32.65, 34.88, 35.70],
};
function inDistrictBox(district, lat, lng) {
  const b = DISTRICT_BBOX[district];
  if (!b) return true; // אין מחוז ידוע - אין ולידציה
  return lat >= b[0] && lat <= b[1] && lng >= b[2] && lng <= b[3];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const junk = (s) => !s || s === 'unknown' || /^https?:/.test(s);
const kmDist = (a, b) => {
  const dLat = (a.lat - b.lat) * 111, dLng = (a.lng - b.lng) * 94;
  return Math.sqrt(dLat * dLat + dLng * dLng);
};
// נקודות עוגן לערים (נשמר בגיט) - כל פגיעת גיאוקוד חייבת ליפול עד 25 ק"מ מעיר הסניף
const CITY_GEO_FILE = path.join(__dirname, 'city-geo.json');
let cityGeo = {};
try { cityGeo = JSON.parse(fs.readFileSync(CITY_GEO_FILE, 'utf8')); } catch {}
const CHAIN_HE = Object.fromEntries(CHAIN_LIST.map((c) => [c.id, c.name]));
// ניקוי כתובת: הסרת סוגריים, מילות רעש וכפילויות רווח - משפר את אחוז הפגיעה של Nominatim
const cleanAddr = (a) => String(a)
  .replace(/\(.*?\)/g, ' ')
  .replace(/(קניון|מרכז מסחרי|מתחם|צומת|אזור תעשיה|א\.ת\.|בית|קומה|חנות)\s*/g, ' ')
  .replace(/,?\s*ישראל\s*$/, '')
  .replace(/\s+/g, ' ').trim();

(async () => {
  let asked = 0, found = 0;
  for (const chain of CHAIN_IDS) {
    let stores;
    try { stores = JSON.parse(fs.readFileSync(path.join(CACHE, `stores-${chain}.json`), 'utf8')); } catch { continue; }
    // כמה סניפים של אותה רשת על אותה נקודה מדויקת = תוצאה חשודה (שאילתת POI עירונית
    // שתויגה כ-addr) - כולם חוזרים לגיאוקוד עם הכתובת האמיתית
    const coordCount = new Map();
    for (const s of stores) {
      const e = geo[chain + ':' + s.store];
      if (e && e.lat && e.prec === 'addr') {
        const ck = e.lat + ',' + e.lng;
        coordCount.set(ck, (coordCount.get(ck) || 0) + 1);
      }
    }
    for (const s of stores) {
      const key = chain + ':' + s.store;
      // חילוץ העיר: שם הרשת מוסר קודם (סופר ספיר ≠ יישוב ספיר), אחר-כך שם סניף/עיר/כתובת
      const noChain = (t) => String(t || '').split(CHAIN_HE[chain]).join(' ');
      const rawCity = s.city || fromAddress(noChain(s.address)).city || '';
      const city = canonCity(knownCityIn(noChain(s.name)) || knownCityIn(noChain(rawCity)) || knownCityIn(noChain(s.address)) || rawCity);
      // עוגן עיר: פעם אחת לכל עיר, נשמר לתמיד
      if (city && !(city in cityGeo)) {
        await sleep(1100);
        asked++;
        cityGeo[city] = await nominatim(`${city}, ישראל`);
        fs.writeFileSync(CITY_GEO_FILE, JSON.stringify(cityGeo));
      }
      const cityPt = city && cityGeo[city];
      // ולידציה על רשומות קיימות: מחוץ למחוז / רחוק מהעיר / כפילות - נמחקות ומגואקדות מחדש
      if (geo[key] && geo[key].lat && !geo[key].ovr) {
        if (!inDistrictBox(s.district, geo[key].lat, geo[key].lng)) delete geo[key];
        else if (cityPt && kmDist(geo[key], cityPt) > 25) delete geo[key];
        else if (geo[key].prec === 'addr' && !geo[key].k && coordCount.get(geo[key].lat + ',' + geo[key].lng) > 1) delete geo[key];
      }
      // מדלגים על מה שכבר מדויק (כתובת/נקודת-חנות/גוגל/ידני); poi/עיר/פספוסים מקבלים סבב נוסף
      if (geo[key] && (geo[key].prec === 'addr' || geo[key].prec === 'osm' || geo[key].prec === 'g' || geo[key].prec === 'site' || geo[key].ovr)) continue;
      const retry = geo[key] && (geo[key].prec === 'city' || geo[key].prec === 'poi' || geo[key].miss);
      const queries = []; // מסודר מהמדויק לפחות מדויק
      if (!junk(s.address)) {
        const a = cleanAddr(s.address);
        if (city && !a.includes(city)) queries.push({ q: `${a}, ${city}`, prec: 'addr' });
        else if (a) queries.push({ q: a, prec: 'addr' });
      }
      if (city) queries.push({ q: `${CHAIN_HE[chain]}, ${city}`, prec: 'poi' }); // חנות הרשת בעיר לפי Nominatim
      if (city) queries.push({ q: `${city}, ישראל`, prec: 'city' });
      let hit = null, prec = null;
      const existing = retry ? geo[key].prec : null;
      for (const { q, prec: p } of queries) {
        // בסבב-דיוק לא שואלים שוב שאלות ברמת הדיוק שכבר יש לנו או גרועה ממנה
        if (existing === 'city' && p === 'city') break;
        if (existing === 'poi' && p !== 'addr') break;
        await sleep(1100);
        asked++;
        const h = await nominatim(q);
        if (h && !inDistrictBox(s.district, h.lat, h.lng)) continue; // פגיעה מחוץ למחוז - פסולה
        if (h && cityPt && p !== 'city' && kmDist(h, cityPt) > 25) continue; // רחוק מדי מעיר הסניף - פסולה
        if (h) { hit = h; prec = p; break; }
      }
      if (hit) { geo[key] = { ...hit, prec }; found++; }
      else if (!geo[key]) geo[key] = { miss: true };
      if (asked % 20 === 0) {
        fs.writeFileSync(GEO_FILE, JSON.stringify(geo));
        console.log(`${asked} שאילתות, ${found} נמצאו...`);
      }
    }
  }
  fs.writeFileSync(GEO_FILE, JSON.stringify(geo));
  // סימון כפילויות שנשארו זהות גם אחרי ניסיון חוזר (רחוב בלי מספרי בתים) - לא ננסה שוב
  const seenCoord = new Map();
  for (const [key, e] of Object.entries(geo)) {
    if (!e.lat || e.prec !== 'addr') continue;
    const ck = key.split(':')[0] + '|' + e.lat + ',' + e.lng;
    if (seenCoord.has(ck)) { e.k = 1; geo[seenCoord.get(ck)].k = 1; }
    else seenCoord.set(ck, key);
  }
  fs.writeFileSync(GEO_FILE, JSON.stringify(geo));

  const total = Object.keys(geo).length;
  const ok = Object.values(geo).filter((g) => !g.miss).length;
  console.log(`סיום: ${ok}/${total} סניפים עם קואורדינטות (${asked} שאילתות חדשות)`);
})();
