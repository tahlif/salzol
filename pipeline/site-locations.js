// מיקומים רשמיים מאתרי הרשתות עצמן - הסמכות העליונה (prec: 'site').
// שני מקורות: (1) רמי לוי - /api/stores באתר הרשמי (רחוב+מספר+עיר לכל סניף);
// (2) pipeline/official-locators.json - כתובות שנאספו ידנית מדפי הסניפים של
// רשתות נוספות (נבנה בדפדפן, רשת-רשת). הכתובות עוברות גיאוקוד גוגל ומוצמדות
// לסניפי קבצי השקיפות לפי עיר-זהה + חפיפת מילים בשם.
// שימוש: node pipeline/site-locations.js   (אחרי fetch, לפני build)
const https = require('https');
const fs = require('fs');
const path = require('path');
const { normalizeCity, canonCity, knownCityIn } = require('./districts');

const CACHE = path.join(__dirname, 'cache');
const GEO_FILE = path.join(__dirname, 'geo.json');
const KEY = process.env.GOOGLE_MAPS_KEY || (() => {
  try { return fs.readFileSync(path.join(__dirname, 'google-key.txt'), 'utf8').trim(); } catch { return ''; }
})();

const getJson = (url, headers = {}) => new Promise((resolve) => {
  https.get(url, { headers: { 'User-Agent': 'salzol/1.0', accept: 'application/json', ...headers } }, (res) => {
    let s = '';
    res.on('data', (d) => (s += d));
    res.on('end', () => { try { resolve(JSON.parse(s)); } catch { resolve(null); } });
  }).on('error', () => resolve(null));
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kmDist = (a, b) => Math.sqrt(((a.lat - b.lat) * 111) ** 2 + ((a.lng - b.lng) * 94) ** 2);
const tokens = (s) => normalizeCity(s).split(' ').filter((t) => t.length >= 2);

async function geocodeGoogle(q, brand) {
  if (!KEY) return null;
  await sleep(120);
  // Geocoding API אם מופעל; אחרת Places textsearch (כתובת מלאה בשאילתה נותנת תוצאה אמינה)
  const j = await getJson(`https://maps.googleapis.com/maps/api/geocode/json?region=il&language=he&address=${encodeURIComponent(q)}&key=${KEY}`);
  if (j && j.status === 'OK' && j.results[0]) {
    const r = j.results[0];
    return { lat: +r.geometry.location.lat.toFixed(6), lng: +r.geometry.location.lng.toFixed(6) };
  }
  await sleep(120);
  const p = await getJson(`https://maps.googleapis.com/maps/api/place/textsearch/json?region=il&language=he&query=${encodeURIComponent(brand + ', ' + q)}&key=${KEY}`);
  const r = p && p.results && p.results[0];
  return r ? { lat: +r.geometry.location.lat.toFixed(6), lng: +r.geometry.location.lng.toFixed(6) } : null;
}

// מצמיד רשימת סניפים רשמיים (name/city/lat/lng) לסניפי קבצי השקיפות של הרשת
// ומעדכן geo (prec 'site'). אותם כללים לכל הרשתות: עיר זהה חובה, ואז חפיפת שם.
function applyOfficial(geo, chainId, stores, officialClean, cityOfficialCount) {
  const cityBranchCount = {};
  const bCityOf = (st) => canonCity(knownCityIn(st.name) || normalizeCity(st.city) || knownCityIn(st.address));
  for (const st of stores) { const c = bCityOf(st); if (c) cityBranchCount[c] = (cityBranchCount[c] || 0) + 1; }

  let applied = 0;
  const usedOfficial = new Set();
  for (const st of stores) {
    const bCity = bCityOf(st);
    if (!bCity) continue;
    const bToks = new Set(tokens(st.name + ' ' + st.address));
    let best = null, bestScore = 0;
    for (let i = 0; i < officialClean.length; i++) {
      if (usedOfficial.has(i)) continue;
      const o = officialClean[i];
      if (o.city !== bCity) continue; // עיר שונה = פסול, בלי יוצאים מן הכלל
      const shared = tokens(o.name + ' ' + (o.addr || '')).filter((t) => bToks.has(t)).length;
      const unique = cityOfficialCount[bCity] === 1 && cityBranchCount[bCity] === 1;
      const score = shared * 3 + (unique ? 3 : 0);
      if (score > bestScore) { bestScore = score; best = i; }
    }
    if (best !== null && bestScore >= 3) {
      usedOfficial.add(best);
      geo[chainId + ':' + st.store] = { lat: officialClean[best].lat, lng: officialClean[best].lng, prec: 'site' };
      applied++;
    } else if (geo[chainId + ':' + st.store] && geo[chainId + ':' + st.store].prec === 'site') {
      delete geo[chainId + ':' + st.store]; // שיוך ישן שלא שרד את הכללים - לגיאוקוד רגיל
    }
  }
  return applied;
}

// גיאוקוד + ולידציה מול עוגן העיר + ניקוי נקודות שקרסו לאותה קואורדינטה
async function geocodeOfficialList(rawList, brand, cityGeo) {
  const official = [];
  for (const s of rawList) {
    const city = canonCity(normalizeCity(s.city || knownCityIn(s.addr || '') || knownCityIn(s.name) || ''));
    if (!city) continue;
    const g = (s.lat && s.lng) ? { lat: s.lat, lng: s.lng } : await geocodeGoogle(`${s.addr}, ${city}, ישראל`, brand);
    const anchor = cityGeo[city];
    if (g && (!anchor || kmDist(g, anchor) <= 15)) {
      official.push({ name: (s.name || '').trim(), addr: s.addr || '', city, lat: g.lat, lng: g.lng });
    }
  }
  const seenPt = new Set();
  return official.filter((o) => {
    const k = o.lat + ',' + o.lng;
    if (seenPt.has(k)) return false;
    seenPt.add(k);
    return true;
  });
}

const CHAIN_BRAND = { yohananof: 'יוחננוף', supersapir: 'סופר ספיר', carrefour: 'קרפור', shufersal: 'שופרסל', salachd: 'סאלח דבאח', shukhayir: 'שוק העיר', tivtaam: 'טיב טעם' };

(async () => {
  const geo = JSON.parse(fs.readFileSync(GEO_FILE, 'utf8'));
  let cityGeo = {};
  try { cityGeo = JSON.parse(fs.readFileSync(path.join(__dirname, 'city-geo.json'), 'utf8')); } catch {}

  // --- רמי לוי: API רשמי ---
  const api = await getJson('https://www.rami-levy.co.il/api/stores');
  const list = api && api.stores && (api.stores.data || api.stores);
  if (Array.isArray(list)) {
    console.log(`רמי לוי: ${list.length} סניפים רשמיים מהאתר`);
    const raw = list.map((s) => ({ name: s.name, addr: `${(s.street || '').trim()} ${s.home_number || ''}`, city: s.city }));
    const officialClean = await geocodeOfficialList(raw, 'רמי לוי', cityGeo);
    console.log(`  גואקדו ונוקו: ${officialClean.length}/${list.length}`);
    const cityCount = {};
    for (const o of officialClean) cityCount[o.city] = (cityCount[o.city] || 0) + 1;
    try {
      const stores = JSON.parse(fs.readFileSync(path.join(CACHE, 'stores-ramilevy.json'), 'utf8'));
      const applied = applyOfficial(geo, 'ramilevy', stores, officialClean, cityCount);
      console.log(`  הוחלו: ${applied}/${stores.length} (prec=site)`);
    } catch (e) { console.log('  אין stores-ramilevy.json - מדלגים'); }
  } else console.log('רמי לוי: ה-API לא זמין');

  // --- רשתות מקובץ הכתובות הרשמיות (נאסף בדפדפן מאתרי הרשתות) ---
  let locators = {};
  try { locators = JSON.parse(fs.readFileSync(path.join(__dirname, 'official-locators.json'), 'utf8')); } catch {}
  for (const [chainId, rawList] of Object.entries(locators)) {
    if (chainId.startsWith('_') || !Array.isArray(rawList)) continue;
    const brand = CHAIN_BRAND[chainId] || '';
    console.log(`${chainId}: ${rawList.length} סניפים רשמיים מהקובץ`);
    const officialClean = await geocodeOfficialList(rawList, brand, cityGeo);
    console.log(`  גואקדו ונוקו: ${officialClean.length}/${rawList.length}`);
    const cityCount = {};
    for (const o of officialClean) cityCount[o.city] = (cityCount[o.city] || 0) + 1;
    try {
      const stores = JSON.parse(fs.readFileSync(path.join(CACHE, `stores-${chainId}.json`), 'utf8'));
      const applied = applyOfficial(geo, chainId, stores, officialClean, cityCount);
      console.log(`  הוחלו: ${applied}/${stores.length} (prec=site)`);
    } catch { console.log(`  אין stores-${chainId}.json - מדלגים`); }
  }

  fs.writeFileSync(GEO_FILE, JSON.stringify(geo));
  console.log('geo.json עודכן');
})();
