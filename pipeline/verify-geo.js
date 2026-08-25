// אימות מיקומים אחד-אחד: מצליב כל סניף מול נקודות ה-POI של הרשת ב-OSM,
// מדרג ודאות, מחיל עקיפות ידניות (geo-overrides.json), וכותב דו"ח מלא.
// שימוש: node pipeline/verify-geo.js   (רץ אחרי osm-pois.js, לפני build.js)
const fs = require('fs');
const path = require('path');
const CHAIN_LIST = require('./chains-list');

const GEO_FILE = path.join(__dirname, 'geo.json');
const POI_FILE = path.join(__dirname, 'osm-pois.json');
const OVERRIDES_FILE = path.join(__dirname, 'geo-overrides.json');
const REPORT_FILE = path.join(__dirname, 'geo-report.txt');
const CACHE = path.join(__dirname, 'cache');

const geo = JSON.parse(fs.readFileSync(GEO_FILE, 'utf8'));
let pois = [];
try { pois = JSON.parse(fs.readFileSync(POI_FILE, 'utf8')); } catch {}
let overrides = {};
try { overrides = JSON.parse(fs.readFileSync(OVERRIDES_FILE, 'utf8')); } catch {
  fs.writeFileSync(OVERRIDES_FILE, '{}');
}

const kmDist = (a, b) => {
  const dLat = (a.lat - b.lat) * 111, dLng = (a.lng - b.lng) * 94;
  return Math.sqrt(dLat * dLat + dLng * dLng);
};

const byChain = {};
for (const p of pois) (byChain[p.chain] = byChain[p.chain] || []).push(p);

let cityG = {};
try { cityG = JSON.parse(fs.readFileSync(path.join(__dirname, 'city-geo-google.json'), 'utf8')); } catch {}
const { knownCityIn, canonCity, normalizeCity, fromAddress } = require('./districts');

const rows = [];
const coordGroups = new Map(); // רשת|נקודה → שמות סניפים (איתור ערימות)
const farFromCity = [];
const stats = { override: 0, osm: 0, verified: 0, addr: 0, poi: 0, city: 0, none: 0 };
for (const c of CHAIN_LIST) {
  let stores;
  try { stores = JSON.parse(fs.readFileSync(path.join(CACHE, `stores-${c.id}.json`), 'utf8')); } catch { continue; }
  for (const s of stores) {
    const key = c.id + ':' + s.store;
    // עקיפה ידנית גוברת על הכול
    if (overrides[key] && overrides[key].lat) {
      geo[key] = { lat: overrides[key].lat, lng: overrides[key].lng, prec: 'osm', ovr: 1 };
      stats.override++;
      rows.push(`✔ ידני   | ${c.name} | ${s.name}`);
      continue;
    }
    const e = geo[key];
    if (!e || !e.lat) { stats.none++; rows.push(`✖ חסר   | ${c.name} | ${s.name} | city:"${s.city || ''}" addr:"${(s.address || '').slice(0, 30)}"`); continue; }
    // ביקורות רוחב על כל רשומה עם קואורדינטה:
    const ck = c.id + '|' + e.lat + ',' + e.lng;
    (coordGroups.get(ck) || coordGroups.set(ck, []).get(ck)).push(`${c.name} ${s.name}`.slice(0, 45));
    const noChain = (t) => String(t || '').split(c.name).join(' ');
    const city = canonCity(knownCityIn(noChain(s.name)) || knownCityIn(noChain(s.city)) || fromAddress(noChain(s.address)).city || normalizeCity(noChain(s.city)));
    if (city && cityG[city] && kmDist(e, cityG[city]) > 15) {
      farFromCity.push(`⚠ ${c.name} | ${s.name} | עיר ${city} אבל הנקודה ${Math.round(kmDist(e, cityG[city]))} ק"מ ממנה`);
    }
    if (e.prec === 'osm' || e.prec === 'g') { stats.osm++; continue; }
    // אימות צולב: פגיעת כתובת שנתמכת ב-POI של הרשת בקרבת מקום = מאומתת
    const near = (byChain[c.id] || []).map((p) => kmDist(e, p)).sort((a, b) => a - b)[0];
    if (e.prec === 'addr' && near !== undefined && near <= 0.35) {
      stats.verified++;
      continue;
    }
    stats[e.prec === 'addr' ? 'addr' : e.prec === 'poi' ? 'poi' : 'city']++;
    if (e.prec === 'city') rows.push(`≈ עיר   | ${c.name} | ${s.name} | ${s.city || ''}`);
  }
}
fs.writeFileSync(GEO_FILE, JSON.stringify(geo));

const total = Object.values(stats).reduce((a, b) => a + b, 0);
const exact = stats.override + stats.osm + stats.verified;
const summary = [
  `דו"ח אימות מיקומים - ${new Date().toISOString().slice(0, 16)}`,
  `סה"כ סניפים: ${total}`,
  `  ✔ מדויק (נקודת חנות OSM / מאומת צולב / ידני): ${exact} (${Math.round((exact / total) * 100)}%)`,
  `    - נקודת חנות מ-OSM: ${stats.osm}, כתובת+POI תואמים: ${stats.verified}, ידני: ${stats.override}`,
  `  ~ דיוק כתובת (ללא POI לאימות): ${stats.addr}`,
  `  ~ חנות-הרשת-בעיר (Nominatim): ${stats.poi}`,
  `  ≈ מרכז עיר בלבד: ${stats.city}`,
  `  ✖ ללא מיקום: ${stats.none}`,
  '',
  'עקיפה ידנית: הוסיפו ל-pipeline/geo-overrides.json שורה כמו',
  '  "shufersal:076": {"lat": 32.1051, "lng": 35.1857}',
  'והריצו node pipeline/verify-geo.js && node pipeline/build.js',
  '',
  `⚠ סניפים רחוקים מהעיר שלהם (>15 ק"מ): ${farFromCity.length}`,
  ...farFromCity.slice(0, 40),
  '',
  `⚠ ערימות - כמה סניפים על נקודה אחת (אותה רשת): ${[...coordGroups.values()].filter((g) => g.length > 1).length}`,
  ...[...coordGroups.values()].filter((g) => g.length > 1).slice(0, 25).map((g) => '  ' + g.join('  ||  ')),
  '',
  'פירוט הסניפים הדורשים טיפול:',
  ...rows,
].join('\n');
fs.writeFileSync(REPORT_FILE, summary);
console.log(summary.split('\n').slice(0, 9).join('\n'));
console.log(`דו"ח מלא: pipeline/geo-report.txt (${rows.length} שורות טיפול)`);
