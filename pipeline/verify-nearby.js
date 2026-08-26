// אימות סניף-אחר-סניף מול Google Places: לכל סיכה שואלים "האם באמת יש סניף של הרשת
// הזו כאן?" (NearbySearch ממוין-מרחק). POI של המותג עד 300מ' = מאומת ומוצמד לנקודת ה-POI.
// אין = איתור מחדש ב-TextSearch (רק תוצאה ששמה תואם את מותג הרשת). נמצא מותג בעיר אבל
// רחוק מהסיכה = הסיכה זזה אליו. גוגל לא מכיר את הרשת בכלל = לא נוגעים (בורות ≠ טעות).
// כל POI מוקצה לסניף אחד (place_id) - שני סניפים באותה עיר מקבלים POI שונים.
// שימוש: node pipeline/verify-nearby.js   (VERIFY_LIMIT=N לבדיקה חלקית)
const https = require('https');
const fs = require('fs');
const path = require('path');
const CHAIN_LIST = require('./chains-list');
const { knownCityIn, fromAddress, canonCity, normalizeCity, cityToDistrict } = require('./districts');

const CACHE = path.join(__dirname, 'cache');
const GEO_FILE = path.join(__dirname, 'geo.json');
const KEY = process.env.GOOGLE_MAPS_KEY || (() => {
  try { return fs.readFileSync(path.join(__dirname, 'google-key.txt'), 'utf8').trim(); } catch { return ''; }
})();
if (!KEY) { console.log('אין מפתח Google - מדלג'); process.exit(0); }
const LIMIT = parseInt(process.env.VERIFY_LIMIT || '0', 10);

const getJson = (url) => new Promise((resolve) => {
  https.get(url, (res) => {
    let s = '';
    res.on('data', (d) => (s += d));
    res.on('end', () => { try { resolve(JSON.parse(s)); } catch { resolve(null); } });
  }).on('error', () => resolve(null));
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kmDist = (a, b) => {
  const dLat = (a.lat - b.lat) * 111, dLng = (a.lng - b.lng) * 94;
  return Math.sqrt(dLat * dLat + dLng * dLng);
};
const junk = (s) => !s || s === 'unknown' || /^https?:/.test(s);
const pt = (loc) => ({ lat: +loc.lat.toFixed(6), lng: +loc.lng.toFixed(6) });

const NEIGHBORHOODS = [
  [/גילה|בית הכרם|פסגת זאב|נווה יעקב|הר חומה|תלפיות|קטמון|גבעת שאול|רמת שלמה|מלחה|ארנונה|רוממה|קרית יובל|קרית מנחם|בקעה|גבעת מרדכי|שכונת פת|רמות אשכול|סנהדריה|הגבעה הצרפתית|עיר גנים|י[-_ ]?ם\b/, 'ירושלים'],
  [/יד אליהו|רמת אביב|נווה צדק|פלורנטין|התקווה|צהלה|רמת החייל|נאות אפקה|עזריאלי|שרונה|ת"א|ת'א/, 'תל אביב - יפו'],
  [/נווה שאנן|קרית חיים|קרית שמואל|הדר הכרמל/, 'חיפה'],
  [/רובע [א-ט]'?\b|שכונה [א-ט]'?\b|רמות ב"ש|נאות לון|ב"ש|ב'ש/, 'באר שבע'],
  [/קיראון/, 'קרית אונו'], [/קרית ספר/, 'מודיעין עילית'],
];
function resolveCity(noChain, s) {
  const cand = canonCity(
    knownCityIn(noChain(s.name)) || knownCityIn(noChain(s.city)) ||
    fromAddress(noChain(s.address)).city || normalizeCity(noChain(s.city))
  );
  if (cand && cityToDistrict(cand)) return cand;
  const t = noChain(s.name) + ' ' + noChain(s.address);
  for (const [re, city] of NEIGHBORHOODS) if (re.test(t)) return city;
  return null;
}

let asked = 0;
async function nearby(loc, keyword) {
  await sleep(120); asked++;
  const j = await getJson(`https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${loc.lat},${loc.lng}&rankby=distance&keyword=${encodeURIComponent(keyword)}&language=he&key=${KEY}`);
  return (j && j.results) || [];
}
async function textsearch(q) {
  await sleep(120); asked++;
  const j = await getJson(`https://maps.googleapis.com/maps/api/place/textsearch/json?region=il&language=he&query=${encodeURIComponent(q)}&key=${KEY}`);
  return (j && j.results) || [];
}

(async () => {
  const geo = JSON.parse(fs.readFileSync(GEO_FILE, 'utf8'));
  let anchors = {};
  try { anchors = JSON.parse(fs.readFileSync(path.join(__dirname, 'city-geo.json'), 'utf8')); } catch {}

  const usedPoi = new Set(); // place_id שכבר משויך לסניף (גלובלי - סניף אחד לכל POI)
  let verified = 0, snapped = 0, moved = 0, unknownChain = 0, downgraded = 0, kept = 0, checked = 0;
  const report = [];

  for (const c of CHAIN_LIST) {
    let stores;
    try { stores = JSON.parse(fs.readFileSync(path.join(CACHE, `stores-${c.id}.json`), 'utf8')); } catch { continue; }
    const noChain = (t) => String(t || '').split(c.name).join(' ');
    for (const s of stores) {
      if (LIMIT && checked >= LIMIT) break;
      const key = c.id + ':' + s.store;
      const e = geo[key];
      if (!e || !e.lat || e.miss || e.ovr || e.prec === 'city' || e.nb) continue; // עיר=משוער מוצהר; nb=כבר אומת
      if (/online|אונליין|www\./i.test(s.name + ' ' + (s.address || ''))) continue; // סניפי אונליין - אין חנות פיזית
      checked++;

      // שלב 1: יש POI של המותג ליד הסיכה?
      const near = await nearby(e, c.name);
      const brandNear = near.filter((r) => c.brand.test(r.name || ''));
      const best = brandNear.find((r) => !usedPoi.has(r.place_id) && kmDist(e, pt(r.geometry.location)) <= 0.3)
        || brandNear.find((r) => kmDist(e, pt(r.geometry.location)) <= 0.3);
      if (best) {
        const p = pt(best.geometry.location);
        if (!usedPoi.has(best.place_id) && (p.lat !== e.lat || p.lng !== e.lng)) {
          geo[key] = { ...p, prec: 'g', v: 5, nb: 1 };
          snapped++;
        } else { e.nb = 1; e.v = 5; }
        usedPoi.add(best.place_id);
        verified++;
        continue;
      }

      // שלב 2: אין מותג ליד הסיכה - מחפשים אותו בעיר
      const city = resolveCity(noChain, s);
      const anchor = city && anchors[city];
      const cityDist = city ? cityToDistrict(city) : null;
      const okLoc = (p) => (!anchor || kmDist(p, anchor) <= 15);
      let candidates = [];
      if (!junk(s.address)) candidates = await textsearch(`${c.name} ${noChain(s.address)} ${city || ''}`);
      let hit = candidates.find((r) => c.brand.test(r.name || '') && !usedPoi.has(r.place_id) && okLoc(pt(r.geometry.location)));
      if (!hit && city) {
        candidates = await textsearch(`${c.name} ${city}`);
        hit = candidates.find((r) => c.brand.test(r.name || '') && !usedPoi.has(r.place_id) && okLoc(pt(r.geometry.location)));
      }
      if (hit) {
        const p = pt(hit.geometry.location);
        usedPoi.add(hit.place_id);
        const dist = kmDist(e, p).toFixed(1);
        geo[key] = { ...p, prec: 'g', v: 5, nb: 1 };
        moved++;
        report.push(`MOVED ${key} ${s.name} (${city || '?'}) ${dist}km`);
        continue;
      }
      // גוגל לא מצא את המותג בעיר בכלל: אם גם ליד הסיכה אין כלום מהמותג בשום מקום -
      // כנראה רשת שגוגל לא מכיר (פוליצר/שפע ברכת השם) - לא נוגעים
      const brandAnywhere = near.some((r) => c.brand.test(r.name || '')) || candidates.some((r) => c.brand.test(r.name || ''));
      if (!brandAnywhere) { unknownChain++; kept++; continue; }
      // המותג קיים אבל לא הצלחנו לאמת - אם יש עוגן-עיר והסיכה רחוקה ממנו, יורדים לדיוק-עיר מוצהר
      if (anchor && kmDist(e, anchor) > 15) {
        geo[key] = { lat: anchors[city].lat, lng: anchors[city].lng, prec: 'city' };
        downgraded++;
        report.push(`DOWNGRADED ${key} ${s.name} → עוגן ${city}`);
      } else { kept++; report.push(`UNVERIFIED ${key} ${s.name} (${city || '?'})`); }
      if (checked % 100 === 0) fs.writeFileSync(GEO_FILE, JSON.stringify(geo));
    }
    fs.writeFileSync(GEO_FILE, JSON.stringify(geo));
    console.log(`${c.name}: עד כה ${verified} אומתו (${snapped} הוצמדו), ${moved} הוזזו, ${downgraded} הורדו לעיר, ${kept} ללא שינוי`);
  }
  fs.writeFileSync(GEO_FILE, JSON.stringify(geo));
  fs.writeFileSync(path.join(__dirname, 'verify-nearby-report.txt'), report.join('\n'));
  console.log(`\nסה"כ: ${checked} נבדקו אחד-אחד | ${verified} אומתו מול POI אמיתי (${snapped} הוצמדו לנקודת החנות) | ${moved} הוזזו לחנות האמיתית | ${downgraded} הורדו לדיוק-עיר מוצהר | ${unknownChain} רשתות שגוגל לא מכיר | ${asked} שאילתות`);
})();
