// עוגני ערים - הסמכות היחידה. שאילתה מובנית (city=X) ל-Nominatim מחזירה רק
// ישויות מסוג יישוב - לא רחובות ("אריאל, ישראל" חופשי החזיר את רחוב אריאל בירושלים).
// כותב מחדש את pipeline/city-geo.json. שימוש: node pipeline/city-anchors.js
const https = require('https');
const fs = require('fs');
const path = require('path');
const CHAIN_LIST = require('./chains-list');
const { knownCityIn, fromAddress, canonCity, normalizeCity } = require('./districts');

const CACHE = path.join(__dirname, 'cache');
const OUT = path.join(__dirname, 'city-geo.json');
const PLACE_TYPES = new Set(['city', 'town', 'village', 'hamlet', 'municipality', 'locality', 'suburb', 'quarter']);

const structured = (city) => new Promise((resolve) => {
  const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=5&addressdetails=0&countrycodes=il,ps&city=' + encodeURIComponent(city);
  https.get(url, { headers: { 'User-Agent': 'salzol-price-compare/1.0' } }, (res) => {
    let s = '';
    res.on('data', (d) => (s += d));
    res.on('end', () => {
      try {
        const arr = JSON.parse(s);
        const r = arr.find((x) => x.class === 'place' && PLACE_TYPES.has(x.type)) ||
                  arr.find((x) => x.class === 'boundary' && x.type === 'administrative') || null;
        resolve(r ? { lat: +(+r.lat).toFixed(6), lng: +(+r.lon).toFixed(6), t: r.type } : null);
      } catch { resolve(null); }
    });
  }).on('error', () => resolve(null));
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // כל הערים שמופיעות אצל הסניפים
  const cities = new Set();
  for (const c of CHAIN_LIST) {
    let stores;
    try { stores = JSON.parse(fs.readFileSync(path.join(CACHE, `stores-${c.id}.json`), 'utf8')); } catch { continue; }
    const noChain = (t) => String(t || '').split(c.name).join(' ');
    for (const s of stores) {
      const city = canonCity(knownCityIn(noChain(s.name)) || knownCityIn(noChain(s.city)) || fromAddress(noChain(s.address)).city || normalizeCity(noChain(s.city)));
      if (city) cities.add(city);
    }
  }
  console.log(`בונה עוגנים מובנים ל-${cities.size} ערים...`);
  const out = {};
  let ok = 0, i = 0;
  for (const city of cities) {
    await sleep(1100);
    const a = await structured(city);
    out[city] = a ? { lat: a.lat, lng: a.lng } : null;
    if (a) ok++;
    if (++i % 25 === 0) { fs.writeFileSync(OUT, JSON.stringify(out)); console.log(`${i}/${cities.size}...`); }
  }
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(`עוגנים: ${ok}/${cities.size} (אריאל: ${JSON.stringify(out['אריאל'] || null)})`);
})();
