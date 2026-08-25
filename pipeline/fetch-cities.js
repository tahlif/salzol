// הורדה חד-פעמית של רשימת כל היישובים בישראל (למ"ס דרך data.gov.il),
// כולל מיפוי נפה → מחוז. נשמר ב-pipeline/cities-il.json (בגיט).
// שימוש: node pipeline/fetch-cities.js
const https = require('https');
const fs = require('fs');
const path = require('path');

const RESOURCE = '5c78e9fa-c2e2-4771-93ff-7f400a12f7ba';
const OUT = path.join(__dirname, 'cities-il.json');

// נפה (למ"ס) → מחוז שלנו
const NAFA_TO_DISTRICT = [
  [/צפת|כנרת|יזרעאל|עכו|גולן|עפולה|נצרת/, 'north'],
  [/חיפה|חדרה/, 'haifa'],
  [/השרון|פתח תקווה|רמלה|רחובות/, 'center'],
  [/תל אביב|רמת גן|חולון/, 'telaviv'],
  [/ירושלים/, 'jerusalem'],
  [/אשקלון|באר שבע/, 'south'],
  [/חברון|שכם|רא?מאללה|בית לחם|יריחו|טול ?כרם|ג'נין|גנין|קלקיליה|יהודה|שומרון/, 'yosh'],
];
const unmatchedNafas = new Set();

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    }).on('error', reject);
  });
}

(async () => {
  const cities = [];
  let offset = 0;
  for (;;) {
    const body = JSON.parse(await get(`https://data.gov.il/api/3/action/datastore_search?resource_id=${RESOURCE}&limit=1000&offset=${offset}`));
    const recs = body.result.records;
    if (!recs.length) break;
    for (const r of recs) {
      const name = String(r['שם_ישוב'] || '').trim().replace(/\s+/g, ' ');
      const nafa = String(r['שם_נפה'] || '').trim();
      if (!name || name === 'לא רשום') continue;
      let d = null;
      for (const [re, id] of NAFA_TO_DISTRICT) if (re.test(nafa)) { d = id; break; }
      if (!d && nafa) unmatchedNafas.add(nafa);
      cities.push({ n: name, d });
    }
    offset += recs.length;
    if (recs.length < 1000) break;
  }
  cities.sort((a, b) => a.n.localeCompare(b.n, 'he'));
  fs.writeFileSync(OUT, JSON.stringify(cities));
  const mapped = cities.filter((c) => c.d).length;
  const byD = {};
  for (const c of cities) byD[c.d || '?'] = (byD[c.d || '?'] || 0) + 1;
  console.log(`${cities.length} יישובים (${mapped} עם מחוז)`, JSON.stringify(byD));
  if (unmatchedNafas.size) console.log('נפות לא ממופות:', [...unmatchedNafas].join(' | '));
})();
