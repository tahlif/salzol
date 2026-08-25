// דיוק מיקומים מ-OSM עצמה: כל הסופרמרקטים בישראל מסומנים במפה כ-POI עם שם הרשת.
// שולפים את כולם ב-Overpass API ומצמידים כל סניף לנקודת ה-POI האמיתית שלו.
// שימוש: node pipeline/osm-pois.js   (רץ אחרי geocode.js, לפני build.js)
const https = require('https');
const fs = require('fs');
const path = require('path');

const CACHE = path.join(__dirname, 'cache');
const GEO_FILE = path.join(__dirname, 'geo.json');
const POI_FILE = path.join(__dirname, 'osm-pois.json');

const CHAIN_LIST = require('./chains-list');
const CHAIN_BRAND = Object.fromEntries(CHAIN_LIST.map((c) => [c.id, c.brand]));
const CHAINS = Object.keys(CHAIN_BRAND);

const DISTRICT_BBOX = {
  north: [32.35, 33.45, 34.85, 35.95], haifa: [32.25, 33.05, 34.80, 35.40],
  center: [31.70, 32.55, 34.55, 35.15], telaviv: [31.95, 32.30, 34.68, 35.00],
  jerusalem: [31.50, 32.00, 34.80, 35.40], south: [29.40, 31.90, 34.15, 35.55],
  yosh: [31.25, 32.65, 34.88, 35.70],
};
const inBox = (d, lat, lng) => {
  const b = DISTRICT_BBOX[d];
  return !b || (lat >= b[0] && lat <= b[1] && lng >= b[2] && lng <= b[3]);
};

function overpass(query) {
  return new Promise((resolve, reject) => {
    const data = 'data=' + encodeURIComponent(query);
    const req = https.request({
      hostname: 'overpass-api.de', path: '/api/interpreter', method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(data),
        'User-Agent': 'salzol-price-compare/1.0 (personal project)',
        'Accept': 'application/json',
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { reject(new Error('overpass parse: ' + Buffer.concat(chunks).toString('utf8').slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(180000, () => req.destroy(new Error('overpass timeout')));
    req.write(data);
    req.end();
  });
}

const dist2 = (a, b) => { const dx = (a.lat - b.lat), dy = (a.lng - b.lng) * 0.85; return dx * dx + dy * dy; };
const KM = 0.009; // ~מעלה אחת של קו-רוחב = 111 ק"מ

(async () => {
  // 1. שליפת כל הסופרמרקטים מ-OSM (עם cache - הרשימה משתנה לאט)
  let pois;
  const fresh = fs.existsSync(POI_FILE) && (Date.now() - fs.statSync(POI_FILE).mtimeMs) < 6 * 24 * 3600 * 1000;
  if (fresh) {
    pois = JSON.parse(fs.readFileSync(POI_FILE, 'utf8'));
    console.log(`POIs מה-cache: ${pois.length}`);
  } else {
    // רשת רחבה: כל אלמנט ששמו/מותגו תואם רשת - לא רק shop=supermarket
    // (הרבה סניפים מתויגים אחרת או רק בשם); מסוננים אחר-כך לאלמנטים מסחריים בלבד
    const brandRe = CHAIN_LIST.map((c) => c.brand.source).join('|');
    const bbox = '(29.4,34.15,33.45,35.95)';
    const q = `[out:json][timeout:180];(node["shop"]${bbox};way["shop"]${bbox};node["brand"~"${brandRe}",i]${bbox};way["brand"~"${brandRe}",i]${bbox};node["name"~"${brandRe}",i]${bbox};way["name"~"${brandRe}",i]${bbox};);out center tags;`;
    const res = await overpass(q);
    pois = [];
    for (const el of res.elements || []) {
      const t = el.tags || {};
      if (!t.shop && !t.brand && !(t.amenity === 'marketplace') && !(t.building === 'retail' || t.building === 'supermarket')) continue; // מסנן רחובות/שכונות עם שם דומה
      const label = [t.name, t['name:he'], t.brand, t['brand:he'], t.operator].filter(Boolean).join(' | ');
      if (!label) continue;
      const lat = el.lat != null ? el.lat : el.center && el.center.lat;
      const lng = el.lon != null ? el.lon : el.center && el.center.lon;
      if (lat == null) continue;
      let chain = null;
      for (const c of CHAINS) if (CHAIN_BRAND[c].test(label)) { chain = c; break; }
      if (!chain) continue;
      pois.push({ chain, lat: +lat.toFixed(6), lng: +lng.toFixed(6), label: label.slice(0, 60), city: (t['addr:city'] || '').trim() });
    }
    fs.writeFileSync(POI_FILE, JSON.stringify(pois));
    console.log(`POIs חדשים מ-Overpass: ${pois.length}`);
  }
  const byChain = {};
  for (const p of pois) (byChain[p.chain] = byChain[p.chain] || []).push(p);
  for (const c of CHAINS) console.log(`  ${c}: ${(byChain[c] || []).length} POIs במפה`);

  // 2. עוגני עיר: ממוצע הקואורדינטות המדויקות הקיימות לכל עיר
  let geo = JSON.parse(fs.readFileSync(GEO_FILE, 'utf8'));
  const { fromAddress, knownCityIn, normalizeCity } = require('./districts');
  const cityAnchor = {};
  const branches = [];
  for (const c of CHAINS) {
    let stores; try { stores = JSON.parse(fs.readFileSync(path.join(CACHE, `stores-${c}.json`), 'utf8')); } catch { continue; }
    for (const s of stores) {
      const city = normalizeCity(s.city) || fromAddress(s.address).city || knownCityIn(s.name);
      branches.push({ chain: c, key: c + ':' + s.store, city, district: s.district });
      const e = geo[c + ':' + s.store];
      if (city && e && e.prec === 'addr') {
        (cityAnchor[city] = cityAnchor[city] || []).push([e.lat, e.lng]);
      }
    }
  }
  for (const [city, pts] of Object.entries(cityAnchor)) {
    cityAnchor[city] = { lat: pts.reduce((a, p) => a + p[0], 0) / pts.length, lng: pts.reduce((a, p) => a + p[1], 0) / pts.length };
  }

  // 3. הצמדה: כל סניף → ה-POI הקרוב ביותר של הרשת שלו (כל POI משמש פעם אחת)
  const used = new Set();
  let snapped = 0, refined = 0, rescued = 0, cityFallback = 0;
  const order = branches.slice().sort((a, b) => {
    const pr = (x) => { const e = geo[x.key]; return e && e.prec === 'addr' ? 0 : e && e.prec === 'city' ? 1 : 2; };
    return pr(a) - pr(b);
  });
  for (const b of order) {
    const e = geo[b.key] || {};
    if (e.prec === 'g' || e.prec === 'site' || e.ovr) continue; // נקודת גוגל / ידני = מדויקת, לא נוגעים
    const anchor = e.lat ? { lat: e.lat, lng: e.lng } : (b.city && cityAnchor[b.city]) || null;
    const maxKm = e.prec === 'addr' ? 0.7 : e.prec === 'poi' ? 3 : 12;
    const cands = (byChain[b.chain] || []).filter((p) => !used.has(p.lat + ',' + p.lng) && inBox(b.district, p.lat, p.lng));
    let pick = null, best = Infinity;
    for (const p of cands) {
      // התאמת עיר מה-POI עצמו כשאין עוגן
      if (!anchor) {
        if (b.city && p.city && normalizeCity(p.city) === b.city) { pick = p; break; }
        continue;
      }
      const d2 = dist2(anchor, p);
      if (d2 < best && Math.sqrt(d2) <= maxKm * KM) { best = d2; pick = p; }
    }
    if (pick) {
      used.add(pick.lat + ',' + pick.lng);
      const had = e.prec;
      geo[b.key] = { lat: pick.lat, lng: pick.lng, prec: 'osm' };
      if (had === 'addr') refined++; else if (had === 'city') snapped++; else rescued++;
    } else if (!e.lat && b.city && cityAnchor[b.city]) {
      geo[b.key] = { lat: +cityAnchor[b.city].lat.toFixed(5), lng: +cityAnchor[b.city].lng.toFixed(5), prec: 'city' };
      cityFallback++;
    }
  }
  fs.writeFileSync(GEO_FILE, JSON.stringify(geo));

  const stats = { osm: 0, addr: 0, city: 0, none: 0 };
  for (const b of branches) { const e = geo[b.key]; if (!e || !e.lat) stats.none++; else stats[e.prec === 'osm' ? 'osm' : e.prec === 'addr' ? 'addr' : 'city']++; }
  console.log(`הצמדות: ${refined} עודנו מכתובת, ${snapped} שודרגו מעיר, ${rescued} חולצו מאפס, ${cityFallback} קיבלו מרכז-עיר`);
  console.log(`מצב סופי: ${JSON.stringify(stats)} מתוך ${branches.length}`);
})();
