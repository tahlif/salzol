// מיקומים רשמיים מאתרי הרשתות עצמן - הסמכות העליונה (prec: 'site').
// כרגע: רמי לוי - /api/stores באתר הרשמי מחזיר רחוב+מספר+עיר לכל סניף,
// והכתובת עוברת גיאוקוד מדויק בגוגל. מורחב רשת-רשת כשנמצא API.
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

async function geocodeGoogle(q) {
  if (!KEY) return null;
  await sleep(120);
  // Geocoding API אם מופעל; אחרת Places textsearch (כתובת מלאה בשאילתה נותנת תוצאה אמינה)
  const j = await getJson(`https://maps.googleapis.com/maps/api/geocode/json?region=il&language=he&address=${encodeURIComponent(q)}&key=${KEY}`);
  if (j && j.status === 'OK' && j.results[0]) {
    const r = j.results[0];
    return { lat: +r.geometry.location.lat.toFixed(6), lng: +r.geometry.location.lng.toFixed(6) };
  }
  await sleep(120);
  const p = await getJson(`https://maps.googleapis.com/maps/api/place/textsearch/json?region=il&language=he&query=${encodeURIComponent('רמי לוי, ' + q)}&key=${KEY}`);
  const r = p && p.results && p.results[0];
  return r ? { lat: +r.geometry.location.lat.toFixed(6), lng: +r.geometry.location.lng.toFixed(6) } : null;
}

(async () => {
  const geo = JSON.parse(fs.readFileSync(GEO_FILE, 'utf8'));
  let cityGeo = {};
  try { cityGeo = JSON.parse(fs.readFileSync(path.join(__dirname, 'city-geo.json'), 'utf8')); } catch {}

  // --- רמי לוי: API רשמי ---
  const api = await getJson('https://www.rami-levy.co.il/api/stores');
  const list = api && api.stores && (api.stores.data || api.stores);
  if (!Array.isArray(list)) { console.log('רמי לוי: ה-API לא זמין'); return; }
  console.log(`רמי לוי: ${list.length} סניפים רשמיים מהאתר`);

  // גיאוקוד הכתובות הרשמיות
  const official = [];
  for (const s of list) {
    const city = canonCity(normalizeCity(s.city));
    const q = `${(s.street || '').trim()} ${s.home_number || ''}, ${city}, ישראל`;
    const g = await geocodeGoogle(q);
    const anchor = cityGeo[city];
    if (g && (!anchor || kmDist(g, anchor) <= 15)) {
      official.push({ name: (s.name || '').trim(), city, lat: g.lat, lng: g.lng });
    }
  }
  console.log(`גואקדו בהצלחה: ${official.length}/${list.length}`);

  // נקודות רשמיות שקרסו לאותה קואורדינטה (נפילת Places) - נשארת רק הראשונה
  const seenPt = new Set();
  const officialClean = official.filter((o) => {
    const k = o.lat + ',' + o.lng;
    if (seenPt.has(k)) return false;
    seenPt.add(k);
    return true;
  });
  console.log(`אחרי ניקוי כפילויות-נקודה: ${officialClean.length}`);

  // התאמה לסניפי קבצי השקיפות: העיר חייבת להיות זהה, ואז חפיפת מילים בשם.
  // עיר עם סניף רשמי יחיד וסניף-שקיפות יחיד - מותאמים גם בלי חפיפת שם.
  const stores = JSON.parse(fs.readFileSync(path.join(CACHE, 'stores-ramilevy.json'), 'utf8'));
  const cityOfficialCount = {};
  for (const o of officialClean) cityOfficialCount[o.city] = (cityOfficialCount[o.city] || 0) + 1;
  const cityBranchCount = {};
  const bCityOf = (st) => canonCity(knownCityIn(st.name) || normalizeCity(st.city) || knownCityIn(st.address));
  for (const st of stores) { const c = bCityOf(st); if (c) cityBranchCount[c] = (cityBranchCount[c] || 0) + 1; }

  let applied = 0;
  const usedOfficial = new Set();
  for (const st of stores) {
    const bCity = bCityOf(st);
    if (!bCity) continue;
    const bToks = new Set(tokens(st.name));
    let best = null, bestScore = 0;
    for (let i = 0; i < officialClean.length; i++) {
      if (usedOfficial.has(i)) continue;
      const o = officialClean[i];
      if (o.city !== bCity) continue; // עיר שונה = פסול, בלי יוצאים מן הכלל
      const shared = tokens(o.name).filter((t) => bToks.has(t)).length;
      const unique = cityOfficialCount[bCity] === 1 && cityBranchCount[bCity] === 1;
      const score = shared * 3 + (unique ? 3 : 0);
      if (score > bestScore) { bestScore = score; best = i; }
    }
    if (best !== null && bestScore >= 3) {
      usedOfficial.add(best);
      geo['ramilevy:' + st.store] = { lat: officialClean[best].lat, lng: officialClean[best].lng, prec: 'site' };
      applied++;
    } else if (geo['ramilevy:' + st.store] && geo['ramilevy:' + st.store].prec === 'site') {
      delete geo['ramilevy:' + st.store]; // שיוך ישן שלא שרד את הכללים החדשים - לגיאוקוד רגיל
    }
  }
  fs.writeFileSync(GEO_FILE, JSON.stringify(geo));
  console.log(`הוחלו מיקומים רשמיים: ${applied}/${stores.length} סניפי רמי לוי (prec=site)`);
})();
