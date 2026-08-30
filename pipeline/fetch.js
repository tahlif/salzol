// זול-לי: משיכת קבצי שקיפות מחירים - ריבוי רשתות, סניף מייצג לכל מחוז.
// שימוש: node pipeline/fetch.js   (אין תלויות - Node מובנה בלבד)
// פלט: cache/<chain>-<district>.xml (מחירים), cache/stores-<chain>.json (סניפים),
//        עדכון pipeline/branches.json (הסניפים הנבחרים - נשמר בגיט להמשכיות ההיסטוריה)
const https = require('https');
const http = require('http');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const { DISTRICTS, cityToDistrict, normalizeCity, fromAddress } = require('./districts');

const CACHE = path.join(__dirname, 'cache');
const BRANCHES_FILE = path.join(__dirname, 'branches.json');
fs.mkdirSync(CACHE, { recursive: true });

const CHAINS = require('./chains-list');

// ערים מועדפות לבחירת הסניף המייצג בכל מחוז (הראשונה שקיימת ברשת)
const PREFERRED = {
  north: ['כרמיאל', 'עפולה', 'נוף הגליל', 'טבריה', 'עכו', 'נהריה', 'קרית שמונה', 'צפת', 'יקנעם', 'מגדל העמק', 'בית שאן'],
  haifa: ['חיפה', 'קרית אתא', 'קרית ביאליק', 'קרית מוצקין', 'נשר', 'חדרה', 'טירת כרמל', 'פרדס חנה', 'אור עקיבא'],
  center: ['ראשון לציון', 'פתח תקווה', 'נתניה', 'רחובות', 'כפר סבא', 'רעננה', 'לוד', 'רמלה', 'מודיעין', 'יבנה', 'ראש העין', 'הוד השרון', 'נס ציונה'],
  telaviv: ['תל אביב', 'רמת גן', 'חולון', 'בני ברק', 'בת ים', 'הרצליה', 'גבעתיים', 'רמת השרון', 'אור יהודה', 'קרית אונו'],
  jerusalem: ['ירושלים', 'בית שמש', 'מבשרת ציון'],
  south: ['באר שבע', 'אשדוד', 'אשקלון', 'קרית גת', 'נתיבות', 'אופקים', 'שדרות', 'דימונה', 'אילת'],
  yosh: ['מודיעין עילית', 'ביתר עילית', 'אריאל', 'מעלה אדומים', 'אורנית'],
};

// ---------- HTTP ----------
function get(url, { headers = {}, insecure = false } = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { headers, rejectUnauthorized: !insecure }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = new URL(res.headers.location, url).href;
        res.resume();
        return resolve(get(next, { headers, insecure }));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), text: () => Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.setTimeout(120000, () => req.destroy(new Error('timeout ' + url)));
  });
}

function post(url, form, { insecure = false, cookies = '' } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = new URLSearchParams(form).toString();
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      rejectUnauthorized: !insecure,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(data),
        ...(cookies ? { Cookie: cookies } : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), text: () => Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.setTimeout(120000, () => req.destroy(new Error('timeout ' + url)));
    req.write(data);
    req.end();
  });
}

const gunzipMaybe = (buf) => {
  if (buf[0] === 0x1f && buf[1] === 0x8b) return zlib.gunzipSync(buf);
  if (buf[0] === 0x50 && buf[1] === 0x4b) { // חלק מרשתות binaprojects עוטפות ב-ZIP למרות סיומת gz
    const nameLen = buf.readUInt16LE(26), extraLen = buf.readUInt16LE(28), method = buf.readUInt16LE(8);
    const data = buf.slice(30 + nameLen + extraLen);
    return method === 0 ? data : zlib.inflateRawSync(data);
  }
  return buf;
};
const toText = (buf) => (buf[0] === 0xff && buf[1] === 0xfe ? buf.toString('utf16le') : buf.toString('utf8'));
const itemCount = (xml) => (xml.match(/<Item>/gi) || []).length;

// ---------- פירסור קובץ סניפים (פורמטים שונים, tags לא רגישים לרישיות) ----------
// chainName מוסר משם הסניף לפני זיהוי עיר - "סופר ספיר מודיעין עילית" בלי זה
// היה מזוהה כיישוב ספיר שבערבה
function parseStores(xmlText, chainName) {
  const stripChain = (t) => chainName ? String(t || '').split(chainName).join(' ') : t;
  const stores = [];
  const re = /<Store>([\s\S]*?)<\/Store>/gi;
  let m;
  while ((m = re.exec(xmlText)) !== null) {
    const b = m[1];
    const tag = (t) => {
      const mm = b.match(new RegExp('<' + t + '>([^<]*)</' + t + '>', 'i'));
      return mm ? mm[1].trim() : '';
    };
    const store = tag('StoreId') || tag('StoreID');
    if (!store) continue;
    stores.push({
      store: String(parseInt(store, 10)).padStart(3, '0'),
      name: tag('StoreName'),
      city: tag('City'),
      address: tag('Address'),
    });
  }
  for (const s of stores) {
    const addr = fromAddress(stripChain(s.address));
    s.district = cityToDistrict(stripChain(s.city)) || cityToDistrict(stripChain(s.name)) || addr.district;
    if (!s.city || /^\d+$/.test(s.city)) s.city = addr.city;
    if (!s.name) s.name = [s.address.replace(/,.*$/, '').trim(), s.city].filter(Boolean).join(' · ') || 'סניף ' + s.store;
  }
  return stores;
}

// ---------- Cerberus (publishedprices): רמי לוי, אושר עד, יוחננוף, טיב טעם ----------
async function cerberusSession(user) {
  const jar = {};
  const eat = (res) => {
    for (const c of res.headers['set-cookie'] || []) jar[c.split('=')[0]] = c.split(';')[0];
    return Object.values(jar).join('; ');
  };
  const login = await get('https://url.publishedprices.co.il/login', { insecure: true });
  let cookies = eat(login);
  const tok = (login.text().match(/name="csrftoken" content="([^"]+)"/) || [])[1];
  const auth = await post('https://url.publishedprices.co.il/login/user', { username: user, password: '', csrftoken: tok }, { insecure: true, cookies });
  cookies = eat(auth);
  const fp = await get('https://url.publishedprices.co.il/file', { insecure: true, headers: { Cookie: cookies } });
  cookies = eat(fp);
  const tok2 = (fp.text().match(/name="csrftoken" content="([^"]+)"/) || [])[1];
  return {
    cookies,
    async dir(search) {
      const r = await post('https://url.publishedprices.co.il/file/json/dir', { iDisplayLength: '100000', sSearch: search, csrftoken: tok2 }, { insecure: true, cookies });
      return [...r.text().matchAll(/"fname":"([^"]+)"/g)].map((x) => x[1]);
    },
    async download(fname) {
      const r = await get('https://url.publishedprices.co.il/file/d/' + encodeURIComponent(fname), { insecure: true, headers: { Cookie: cookies } });
      return r.body;
    },
  };
}

// ---------- מימוש לכל רשת ----------
const IMPL = {
  shufersal: {
    async stores(chain) {
      const page = await get('http://prices.shufersal.co.il/FileObject/UpdateCategory?catID=5&storeId=0');
      const link = (page.text().match(/https:\/\/[^"]*[Ss]tores[^"]*/) || [])[0];
      if (!link) throw new Error('no stores link');
      const file = await get(link.replace(/&amp;/g, '&'));
      return parseStores(toText(gunzipMaybe(file.body)), chain.name);
    },
    async price(chain, store) {
      const page = await get(`http://prices.shufersal.co.il/FileObject/UpdateCategory?catID=2&storeId=${parseInt(store, 10)}`);
      const link = (page.text().match(new RegExp('https://[^"]*PriceFull' + chain.chainId + '[^"]*')) || [])[0];
      if (!link) throw new Error('no PriceFull for store ' + store);
      const file = await get(link.replace(/&amp;/g, '&'));
      return gunzipMaybe(file.body);
    },
    async promo(chain, store) {
      const page = await get(`http://prices.shufersal.co.il/FileObject/UpdateCategory?catID=4&storeId=${parseInt(store, 10)}`);
      const link = (page.text().match(new RegExp('https://[^"]*PromoFull' + chain.chainId + '[^"]*')) || [])[0];
      if (!link) throw new Error('no PromoFull for store ' + store);
      const file = await get(link.replace(/&amp;/g, '&'));
      return gunzipMaybe(file.body);
    },
  },
  cerberus: {
    async stores(chain, ctx) {
      ctx.session = ctx.session || await cerberusSession(chain.user);
      const names = (await ctx.session.dir('Stores')).sort().reverse();
      if (!names.length) throw new Error('no stores file');
      return parseStores(toText(gunzipMaybe(await ctx.session.download(names[0]))), chain.name);
    },
    async price(chain, store, ctx) {
      ctx.session = ctx.session || await cerberusSession(chain.user);
      const names = (await ctx.session.dir('PriceFull' + chain.chainId)).filter((n) => new RegExp('-' + store + '-\\d{8}').test(n)).sort().reverse();
      if (!names.length) throw new Error('no PriceFull for store ' + store);
      return gunzipMaybe(await ctx.session.download(names[0]));
    },
    async promo(chain, store, ctx) {
      ctx.session = ctx.session || await cerberusSession(chain.user);
      const names = (await ctx.session.dir('PromoFull' + chain.chainId)).filter((n) => new RegExp('-' + store + '-\\d{8}').test(n)).sort().reverse();
      if (!names.length) throw new Error('no PromoFull for store ' + store);
      return gunzipMaybe(await ctx.session.download(names[0]));
    },
  },
  carrefour: {
    // prices.carrefour.co.il: רשימת הקבצים של היום מוטמעת בעמוד כ-const files = [...];
    // הורדה: origin/<תאריך>/<שם קובץ>
    async page(ctx) {
      if (!ctx.page) {
        const res = await get('https://prices.carrefour.co.il/');
        const s = res.text();
        ctx.page = {
          path: (s.match(/const path = '([0-9]+)'/) || [])[1],
          files: JSON.parse((s.match(/const files = (\[[\s\S]*?\]);/) || [, '[]'])[1]),
        };
      }
      return ctx.page;
    },
    async stores(chain, ctx) {
      const { path: dir, files } = await IMPL.carrefour.page(ctx);
      const st = files.filter((f) => /^Stores/.test(f.name)).map((f) => f.name).sort().reverse();
      if (!st.length) throw new Error('no stores file');
      const file = await get(`https://prices.carrefour.co.il/${dir}/${st[0]}`);
      return parseStores(toText(gunzipMaybe(file.body)), chain.name);
    },
    async price(chain, store, ctx) {
      const { path: dir, files } = await IMPL.carrefour.page(ctx);
      const pf = files.filter((f) => f.name.startsWith(`PriceFull${chain.chainId}-001-${store}-`)).map((f) => f.name).sort().reverse();
      if (!pf.length) throw new Error('no PriceFull for store ' + store);
      const file = await get(`https://prices.carrefour.co.il/${dir}/${pf[0]}`);
      return gunzipMaybe(file.body);
    },
    async promo(chain, store, ctx) {
      const { path: dir, files } = await IMPL.carrefour.page(ctx);
      const pf = files.filter((f) => f.name.startsWith(`PromoFull${chain.chainId}-001-${store}-`)).map((f) => f.name).sort().reverse();
      if (!pf.length) throw new Error('no PromoFull for store ' + store);
      const file = await get(`https://prices.carrefour.co.il/${dir}/${pf[0]}`);
      return gunzipMaybe(file.body);
    },
  },
  bina: {
    // binaprojects: MainIO_Hok.aspx מחזיר JSON של קבצים; WFileType: 1=סניפים, 4=מחירים מלא
    async list(chain, ctx, type) {
      ctx.lists = ctx.lists || {};
      if (!ctx.lists[type]) {
        const res = await get(`http://${chain.sub}.binaprojects.com/MainIO_Hok.aspx?WFileType=${type}`);
        ctx.lists[type] = JSON.parse(res.text()).map((f) => f.FileNm.trim());
      }
      return ctx.lists[type];
    },
    async stores(chain, ctx) {
      const names = (await IMPL.bina.list(chain, ctx, 1)).sort().reverse();
      if (!names.length) throw new Error('no stores file');
      const file = await get(`http://${chain.sub}.binaprojects.com/Download/${encodeURIComponent(names[0])}`);
      return parseStores(toText(gunzipMaybe(file.body)), chain.name);
    },
    async price(chain, store, ctx) {
      const names = (await IMPL.bina.list(chain, ctx, 4)).filter((n) => new RegExp('-' + store + '-\\d{8}').test(n)).sort().reverse();
      if (!names.length) throw new Error('no PriceFull for store ' + store);
      const file = await get(`http://${chain.sub}.binaprojects.com/Download/${encodeURIComponent(names[0])}`);
      return gunzipMaybe(file.body);
    },
    async promo(chain, store, ctx) {
      // WFileType=5 = PromoFull (2=Price, 3=Promo חלקי, 4=PriceFull)
      const names = (await IMPL.bina.list(chain, ctx, 5)).filter((n) => new RegExp('-' + store + '-\\d{8}').test(n)).sort().reverse();
      if (!names.length) throw new Error('no PromoFull for store ' + store);
      const file = await get(`http://${chain.sub}.binaprojects.com/Download/${encodeURIComponent(names[0])}`);
      return gunzipMaybe(file.body);
    },
  },
  hazihinam: {
    async stores(chain) {
      const page = await get('https://shop.hazi-hinam.co.il/Prices?t=3');
      const link = (page.text().match(/https:\/\/[^"]*StoresFull[^"]*\.gz/) || [])[0];
      if (!link) throw new Error('no StoresFull link');
      const file = await get(link);
      return parseStores(toText(gunzipMaybe(file.body)), chain.name);
    },
    async price(chain, store) {
      const page = await get('https://shop.hazi-hinam.co.il/Prices');
      const links = [...page.text().matchAll(new RegExp('https://[^"]*PriceFull' + chain.chainId + '-000-' + store + '-[^"]*\\.gz', 'g'))].map((m) => m[0]).sort().reverse();
      if (!links.length) throw new Error('no PriceFull for store ' + store);
      for (const link of links.slice(0, 3)) {
        const xml = gunzipMaybe((await get(link)).body);
        if (itemCount(xml.toString('utf8')) > 1000) return xml; // דילוג על קובצי השלמה קטנים
      }
      throw new Error('only partial files for store ' + store);
    },
    async promo(chain, store) {
      const page = await get('https://shop.hazi-hinam.co.il/Prices?t=2');
      const links = [...page.text().matchAll(new RegExp('https://[^"]*PromoFull' + chain.chainId + '-000-' + store + '-[^"]*\\.gz', 'g'))].map((m) => m[0]).sort().reverse();
      if (!links.length) throw new Error('no PromoFull for store ' + store);
      return gunzipMaybe((await get(links[0])).body);
    },
  },
};

// ---------- בחירת סניף מייצג לכל מחוז ----------
const NOT_CONSUMER = /סיטונ|מפיץ|אונליין|אינטרנט|online|מרלוג|מחסן מרכזי/i;
const PREFER_FORMAT = { shufersal: [/דיל/, /שלי/] }; // פורמט צרכני מועדף לפי רשת
// שכונות שרשתות רושמות כ"עיר" - נחשבות כעיר-האם בהעדפת סניף מייצג.
// בלי זה "תלפיות" לא נספר כירושלים והנציג הירושלמי של אושר עד היה סניף
// מהדרין בבית שמש - בלי דניאלה ודומיו (מבחר שונה) - במקום סניף ירושלמי אמיתי
const NEIGH_CITY = { 'תלפיות': 'ירושלים', 'מלחה': 'ירושלים', 'גבעת שאול': 'ירושלים', 'רוממה': 'ירושלים', 'קרית חיים': 'חיפה', 'קרית אליעזר': 'חיפה' };

function chooseBranches(chain, stores, existing) {
  const byDistrict = {};
  for (const d of DISTRICTS) {
    let inD = stores.filter((s) => s.district === d.id);
    if (!inD.length) continue;
    const consumer = inD.filter((s) => !NOT_CONSUMER.test(s.name));
    if (consumer.length) inD = consumer;
    const prev = existing && existing[d.id];
    if (prev && inD.some((s) => s.store === prev.store)) {
      byDistrict[d.id] = inD.find((s) => s.store === prev.store); // המשכיות היסטוריה
      continue;
    }
    const rank = (s) => {
      let r = 100;
      (PREFER_FORMAT[chain.id] || []).forEach((re, i) => { if (r === 100 && re.test(s.name)) r = i; });
      return r;
    };
    let pick = null;
    const cityOf = (s) => {
      const c = normalizeCity(s.city);
      return NEIGH_CITY[c] || c;
    };
    for (const city of PREFERRED[d.id] || []) {
      const inCity = inD.filter((s) => cityOf(s).startsWith(city) || normalizeCity(s.name).includes(city) || NEIGH_CITY[normalizeCity(s.name)] === city);
      if (inCity.length) { pick = inCity.sort((a, b) => rank(a) - rank(b))[0]; break; }
    }
    byDistrict[d.id] = pick || inD.sort((a, b) => rank(a) - rank(b))[0];
  }
  return byDistrict;
}

// ---------- ריצה ----------
(async () => {
  let branches = {};
  try { branches = JSON.parse(fs.readFileSync(BRANCHES_FILE, 'utf8')); } catch {}
  let okPrice = 0, failPrice = 0, okPromo = 0;

  for (const chain of CHAINS) {
    const impl = IMPL[chain.type];
    const ctx = {};
    console.log(`\n=== ${chain.name} ===`);
    let stores;
    try {
      stores = await impl.stores(chain, ctx);
      const mapped = stores.filter((s) => s.district).length;
      console.log(`סניפים: ${stores.length} (${mapped} משויכים למחוז)`);
      fs.writeFileSync(path.join(CACHE, `stores-${chain.id}.json`), JSON.stringify(stores));
    } catch (e) {
      console.error(`קובץ סניפים נכשל: ${e.message}`);
      try { stores = JSON.parse(fs.readFileSync(path.join(CACHE, `stores-${chain.id}.json`), 'utf8')); } catch { continue; }
    }

    branches[chain.id] = chooseBranches(chain, stores, branches[chain.id]);
    // מבצעים: לא-פטאלי - רשת בלי PromoFull פשוט תוצג בלי מבצעים
    const fetchPromo = async (store, districts) => {
      if (!impl.promo) return;
      try {
        const xml = await impl.promo(chain, store, ctx);
        for (const district of districts) fs.writeFileSync(path.join(CACHE, `promo-${chain.id}-${district}.xml`), xml);
        console.log(`  מבצעים (${store}): ${(xml.length / 1024 / 1024).toFixed(1)}MB → ${districts.length} מחוזות`);
        okPromo++;
      } catch (e) { console.warn(`  מבצעים (${store}) אין - ${e.message}`); }
    };
    if (chain.uniform) {
      try {
        const xml = await impl.price(chain, chain.priceStore, ctx);
        for (const district of Object.keys(branches[chain.id])) {
          fs.writeFileSync(path.join(CACHE, `${chain.id}-${district}.xml`), xml);
        }
        console.log(`  מחיר אחיד ארצי (חנות ${chain.priceStore}) - ${(xml.length / 1024 / 1024).toFixed(1)}MB → ${Object.keys(branches[chain.id]).length} מחוזות`);
        okPrice++;
      } catch (e) {
        console.error(`  מחיר אחיד נכשל - ${e.message}`);
        failPrice++;
      }
      await fetchPromo(chain.priceStore, Object.keys(branches[chain.id]));
      continue;
    }
    for (const [district, s] of Object.entries(branches[chain.id])) {
      try {
        const xml = await impl.price(chain, s.store, ctx);
        fs.writeFileSync(path.join(CACHE, `${chain.id}-${district}.xml`), xml);
        console.log(`  ${district}: ${s.name || s.store} (${s.city}) - ${(xml.length / 1024 / 1024).toFixed(1)}MB`);
        okPrice++;
      } catch (e) {
        console.error(`  ${district}: ${s.store} נכשל - ${e.message}`);
        failPrice++;
      }
      await fetchPromo(s.store, [district]);
    }
  }

  fs.writeFileSync(BRANCHES_FILE, JSON.stringify(branches, null, 2));
  console.log(`\nסיכום: ${okPrice} קבצי מחירים נמשכו, ${failPrice} נכשלו, ${okPromo} קבצי מבצעים`);
  if (!okPrice) process.exit(1);
})();
