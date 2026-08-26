(async function () {
  const $ = (id) => document.getElementById(id);
  const fmt = (v) => '₪' + v.toFixed(2);

  const [meta, chainsAll, sample, storesAll, cbsCities] = await Promise.all([
    fetch('data/meta.json').then((r) => r.json()),
    fetch('data/chains.json').then((r) => r.json()),
    fetch('data/sample.json').then((r) => r.json()),
    fetch('data/stores-all.json').then((r) => r.json()),
    fetch('data/cities.json').then((r) => r.json()).catch(() => []),
  ]);
  const chainName = Object.fromEntries(chainsAll.map((c) => [c.id, c.name]));
  const CHAIN_COLOR = {
    shufersal: '#e34948', ramilevy: '#2a78d6', osherad: '#1baf7a',
    yohananof: '#eda100', tivtaam: '#d55181', hazihinam: '#7a5cd6',
    carrefour: '#0aa2c0', keshet: '#6b9e23', salachd: '#b8860b',
    stopmarket: '#5e548e', politzer: '#2f7f6f', freshmarket: '#c04bc9',
    supersapir: '#8f1d5e', kingstore: '#5b21b6', maayan2000: '#075985',
    zolvebegadol: '#a16207', superbareket: '#0d9488', shefabirkathashem: '#4d7c0f',
    shukhayir: '#78350f',
  };

  const [y, m, d] = meta.updated.split('-');
  const upAt = meta.updatedAt ? new Date(meta.updatedAt) : null;
  const upTime = upAt ? upAt.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }) : '';
  const updatedLabel = `${d}.${m}.${y}${upTime ? ' ' + upTime : ''}`;
  $('updatedBadge').textContent = `מחירים רשמיים · עודכן ${updatedLabel}`;
  $('storesLine').textContent = `במאגר: ${meta.stores.toLocaleString()} סניפים מ-${chainsAll.length} רשתות, ב-${meta.districts.length} אזורים.`;

  // ---------- מצב ----------
  let district = localStorage.getItem('zulik-district');
  if (!meta.districts.some((x) => x.id === district)) district = 'telaviv';
  let mode = localStorage.getItem('zulik-mode') === 'fav' ? 'fav' : 'region';
  let favs = []; // מפתחות "chain:store" - כל סניף בארץ
  try { favs = JSON.parse(localStorage.getItem('zulik-favs2')) || []; } catch {}
  let basket = [];
  try { basket = JSON.parse(localStorage.getItem('zulik-basket')) || []; } catch {}
  // שמות מוצרים שנשמרים בין אזורים - כדי ששורת "לא נמכר כאן" תציג שם אמיתי
  let nameMap = {};
  try { nameMap = JSON.parse(localStorage.getItem('zulik-names')) || {}; } catch {}
  setInterval(() => localStorage.setItem('zulik-names', JSON.stringify(nameMap)), 4000);
  if (!basket.length) basket = sample.slice();
  const saveBasket = () => localStorage.setItem('zulik-basket', JSON.stringify(basket));
  const expanded = new Set();
  const indexCache = {};
  const productCache = {};
  let index = [];
  let byCode = new Map();

  const dMeta = (id) => meta.districts.find((x) => x.id === (id || district));
  const dChains = () => dMeta().chains.filter((id) => chainName[id]);
  const districtHe = Object.fromEntries(meta.districts.map((x) => [x.id, x.he]));

  // "סניפים קבועים": כל סניף בארץ ניתן לבחירה. המחירים לעמודה נלקחים
  // מהסניף המייצג של אותה רשת באזור של הסניף שנבחר (branchByKey ממולא אחרי טעינת המפה).
  const branchByKey = new Map();
  // אם לרשת אין נתונים באזור של הסניף - נופלים לאזור הקרוב ביותר שיש בו נתונים שלה
  const FALLBACK_ORDER = ['center', 'telaviv', 'jerusalem', 'south', 'haifa', 'north', 'yosh'];
  function dataDistrictFor(chain, dist) {
    const has = (d) => { const dm = meta.districts.find((x) => x.id === d); return dm && dm.chains.includes(chain); };
    if (dist && dist !== 'other' && has(dist)) return dist;
    return FALLBACK_ORDER.find(has) || null;
  }
  const favValid = (k) => {
    const b = branchByKey.get(k);
    return !!(b && dataDistrictFor(b.chain, b.district));
  };
  const favCols = () => favs.filter(favValid).map((k) => {
    const b = branchByKey.get(k);
    const dataDist = dataDistrictFor(b.chain, b.district);
    const place = b.city && b.city.length <= 12 && !/תעשי|אזור|כביש/.test(b.city) ? b.city : districtHe[b.district] || '';
    const nm = b.name.length > 22 ? b.name.slice(0, 21) + '…' : b.name;
    const borrowed = dataDist !== b.district;
    return {
      key: k, district: dataDist, chain: b.chain,
      head: `${chainName[b.chain]}<br><small>${nm}</small>`,
      label: `${chainName[b.chain]} ${place}`.trim(),
      full: `${chainName[b.chain]} — ${b.name}${b.city && !b.name.includes(b.city) ? ' · ' + b.city : ''}${borrowed ? ` (מחירי אזור ${districtHe[dataDist]})` : ''}`,
    };
  });
  const useFav = () => mode === 'fav' && favCols().length >= 2;
  async function toggleFav(key) {
    if (favs.includes(key)) favs = favs.filter((k) => k !== key);
    else if (favs.length < 4 && favValid(key)) favs.push(key);
    localStorage.setItem('zulik-favs2', JSON.stringify(favs));
    renderFavPanel();
    updateModeUI();
    await loadDistrict();
    await render();
  }

  async function loadIndexOf(dist) {
    if (!indexCache[dist]) {
      indexCache[dist] = await fetch(`data/d/${dist}/index.json`).then((r) => r.json());
    }
    return indexCache[dist];
  }
  async function loadDistrict() {
    index = await loadIndexOf(useFav() ? favCols()[0].district : district);
    byCode = new Map(index.map((e) => [e.c, e]));
  }
  async function loadProductIn(dist, code) {
    const shard = code.slice(-2).padStart(2, '0');
    const key = dist + ':' + shard;
    if (!(key in productCache)) {
      productCache[key] = await fetch(`data/d/${dist}/s/${shard}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    }
    const rec = productCache[key] && productCache[key][code];
    return rec ? { code, ...rec } : null;
  }

  // ---------- מפה אמיתית (Leaflet + OSM) ----------
  const allBranches = [];
  for (const [dist, byChain] of Object.entries(storesAll)) {
    for (const [chain, arr] of Object.entries(byChain)) {
      for (const s of arr) {
        const b = { ...s, chain, district: dist, key: chain + ':' + s.store };
        allBranches.push(b);
        branchByKey.set(b.key, b);
      }
    }
  }
  favs = favs.filter((k) => branchByKey.has(k)).slice(0, 4);
  const lmap = L.map('realmap', { scrollWheelZoom: true, touchZoom: true }).setView([31.6, 34.95], 7);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(lmap);
  let cityFilter = '';
  let popupCloseTimer = null;
  // כשהעכבר בתוך הכרטיס עצמו - לא סוגרים (כדי שאפשר יהיה ללחוץ על הכפתורים)
  lmap.on('popupopen', (e) => {
    const el = e.popup.getElement();
    if (!el) return;
    el.addEventListener('mouseenter', () => clearTimeout(popupCloseTimer));
    el.addEventListener('mouseleave', () => { clearTimeout(popupCloseTimer); popupCloseTimer = setTimeout(() => lmap.closePopup(), 300); });
  });
  const markers = [];
  // סניפים עם אותה קואורדינטה (דיוק ברמת עיר) מפוזרים בטבעת קטנה כדי שכולם ייראו
  const coordSeen = new Map();
  for (const b of allBranches) {
    if (!b.lat) continue;
    const ck = b.lat.toFixed(4) + ',' + b.lng.toFixed(4);
    const n = coordSeen.get(ck) || 0;
    coordSeen.set(ck, n + 1);
    if (n > 0) {
      const ang = (n * 60) * Math.PI / 180;
      const r = 0.0009 * Math.ceil(n / 6);
      b.lat += r * Math.cos(ang);
      b.lng += r * Math.sin(ang) * 1.2;
    }
    const mk = L.circleMarker([b.lat, b.lng], {
      radius: 5.5,
      color: '#fff', weight: 1.5,
      fillColor: CHAIN_COLOR[b.chain] || '#888', fillOpacity: 0.9,
    }).bindPopup(() =>
      `<div class="popup" dir="rtl"><b>${chainName[b.chain]}</b> — ${b.name}` +
      `${b.city && !b.name.includes(b.city) ? '<br>' + b.city : ''}` +
      `${b.approx ? '<br><small>מיקום משוער (לפי עיר)</small>' : ''}` +
      `${b.used ? '<br><small class="usedtag">✓ בסיס ההשוואה באזור</small>' : ''}` +
      `<br>${favValid(b.key) ? `<button class="gotoDistrict favBtn" data-favkey="${b.key}">${favs.includes(b.key) ? '★ הסרה מההשוואה הקבועה' : '⭐ קבע להשוואה'}</button> ` : ''}` +
      `${b.district !== district && meta.districts.some((x) => x.id === b.district) ? `<button class="gotoDistrict" data-district="${b.district}">השוואה באזור הזה ←</button>` : ''}</div>`
    );
    mk.on('mouseover', () => { clearTimeout(popupCloseTimer); mk.openPopup(); }); // ריחוף פותח את כרטיס הסניף המלא
    mk.on('mouseout', () => { clearTimeout(popupCloseTimer); popupCloseTimer = setTimeout(() => lmap.closePopup(), 300); });
    mk._branch = b;
    mk.addTo(lmap);
    markers.push(mk);
  }
  // התאמת עיר קנונית: "תל אביב - יפו" = "תל אביב יפו" = "תל אביב";
  // מקפים נמחקים וסיומת "יפו" מוסרת - ואז השוואה דו-כיוונית
  const canonCityStr = (s) => norm(s).replace(/[-–]/g, ' ').replace(/\s+/g, ' ').replace(/ יפו$/, '').trim();
  function cityMatches(b, f) {
    const nf = canonCityStr(f);
    if (!nf) return true;
    const nc = canonCityStr(b.city || '');
    return (nc && (nc.includes(nf) || nf.includes(nc))) || canonCityStr(b.name).includes(nf);
  }
  function applyMapFilter() {
    const shown = [];
    for (const mk of markers) {
      const ok = !cityFilter || cityMatches(mk._branch, cityFilter);
      if (ok) { if (!lmap.hasLayer(mk)) mk.addTo(lmap); shown.push(mk); }
      else if (lmap.hasLayer(mk)) lmap.removeLayer(mk);
    }
    return shown;
  }
  function fitTo(list) {
    const pts = list.map((mk) => mk.getLatLng());
    if (pts.length) lmap.fitBounds(L.latLngBounds(pts).pad(0.2), { maxZoom: 13 });
  }
  $('mapLegend').innerHTML = chainsAll.map((c) =>
    `<span><i style="background:${CHAIN_COLOR[c.id]}"></i>${c.name}</span>`
  ).join('');

  // כל יישובי ישראל (למ"ס) + ערים מקבצי הסניפים, למקרה של איות שונה
  const cityDistrict = new Map();
  for (const c of cbsCities) cityDistrict.set(c.n, c.d);
  for (const b of allBranches) {
    if (b.city && !/^\d+$/.test(b.city) && !cityDistrict.has(b.city) && b.district !== 'other') {
      cityDistrict.set(b.city, b.district);
    }
  }
  const cities = [...cityDistrict.keys()].sort((a, b) => a.localeCompare(b, 'he'));
  $('cityList').innerHTML = cities.map((c) => `<option value="${c}">`).join('');

  const POPULAR = ['תל אביב - יפו', 'ירושלים', 'חיפה', 'באר שבע', 'נתניה', 'ראשון לציון', 'פתח תקווה', 'אשדוד'];
  $('popularChips').innerHTML = POPULAR.filter((c) => cityDistrict.has(c)).map((c) =>
    `<button class="chip" data-city="${c}">${c.replace(' - יפו', '')}</button>`
  ).join('');
  $('popularChips').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-city]');
    if (b) { $('cityFilter').value = b.dataset.city; selectCity(b.dataset.city); }
  });

  let cityGeoCache = {};
  try { cityGeoCache = JSON.parse(localStorage.getItem('zulik-citygeo')) || {}; } catch {}
  async function centerOnCity(name) {
    if (!cityGeoCache[name]) {
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=il,ps&q=${encodeURIComponent(name + ', ישראל')}`);
        const arr = r.ok ? await r.json() : [];
        if (arr[0]) {
          cityGeoCache[name] = [+arr[0].lat, +arr[0].lon];
          localStorage.setItem('zulik-citygeo', JSON.stringify(cityGeoCache));
        }
      } catch {}
    }
    if (cityGeoCache[name]) lmap.setView(cityGeoCache[name], 13);
  }
  async function selectCity(name) {
    cityFilter = name;
    $('cityClear').hidden = !name;
    const shown = applyMapFilter();
    renderBranchList();
    if (shown.length) fitTo(shown);
    else centerOnCity(name); // אין סניפים בעיר - מתמרכזים על העיר עצמה
    const d = cityDistrict.get(name);
    if (d && meta.districts.some((x) => x.id === d)) {
      district = d;
      localStorage.setItem('zulik-district', district);
      await loadDistrict();
      renderDistrictUI();
      renderSampleChips();
      await render();
    }
  }
  $('cityFilter').addEventListener('input', async () => {
    const v = $('cityFilter').value.trim();
    if (cityDistrict.has(v)) { await selectCity(v); return; }
    cityFilter = v;
    $('cityClear').hidden = !v;
    applyMapFilter();
    renderBranchList();
  });
  $('cityClear').addEventListener('click', () => {
    $('cityFilter').value = ''; cityFilter = ''; $('cityClear').hidden = true;
    applyMapFilter(); renderBranchList();
    fitTo(markers.filter((mk) => mk._branch.district === district));
  });
  document.addEventListener('click', async (ev) => {
    const b = ev.target.closest('.gotoDistrict');
    if (!b || !meta.districts.some((x) => x.id === b.dataset.district)) return;
    district = b.dataset.district;
    localStorage.setItem('zulik-district', district);
    lmap.closePopup();
    await loadDistrict();
    renderDistrictUI();
    renderSampleChips();
    await render();
  });

  function updateLocSummary() {
    const el = $('locSummary');
    if (!el) return;
    el.textContent = useFav()
      ? `📍 משווים בין ${favCols().length} הסניפים הקבועים שלך`
      : `📍 משווים באזור ${dMeta().he}${cityFilter ? ` · ${cityFilter}` : ''}`;
  }
  function renderDistrictUI() {
    updateLocSummary();
    setBranchesToggleText();
    renderBranchList();
  }
  // המפה חיה בתוך מקטע מתקפל - Leaflet חייב חישוב-גודל מחדש אחרי פתיחה
  $('mapToggle').addEventListener('click', () => {
    const sec = $('mapSection');
    sec.hidden = !sec.hidden;
    $('mapToggle').textContent = sec.hidden ? 'שינוי אזור במפה ▾' : 'סגירת המפה ▴';
    if (!sec.hidden) {
      setTimeout(() => {
        lmap.invalidateSize();
        const mine = markers.filter((mk) => !cityFilter ? mk._branch.district === district : cityMatches(mk._branch, cityFilter));
        fitTo(mine.length ? mine : markers);
      }, 60);
    }
  });
  function setBranchesToggleText() {
    const all = storesAll[district] || {};
    const count = Object.values(all).reduce((n, arr) => n + arr.length, 0);
    $('branchesToggle').hidden = !count;
    $('branchesToggle').textContent = $('branchList').hidden
      ? `כל ${count} הסניפים באזור ▾`
      : `סגירת רשימת הסניפים ▴`;
  }
  function renderBranchList() {
    const el = $('branchList');
    if (el.hidden) return;
    const all = storesAll[district] || {};
    const flt = (arr) => cityFilter ? arr.filter((s) => cityMatches(s, cityFilter)) : arr;
    el.innerHTML = chainsAll.map((c) => {
      const arr = flt(all[c.id] || []);
      if (!arr.length) return '';
      return `<div class="bgroup">
        <p class="bchain">${c.name} <small>(${arr.length})</small></p>
        <ul>${arr.map((s) => `<li class="${s.used ? 'used' : ''}">${s.name}${s.city && !s.name.includes(s.city) ? ' · ' + s.city : ''}${s.used ? ' <em>— בסיס ההשוואה</em>' : ''}</li>`).join('')}</ul>
      </div>`;
    }).join('') || '<p class="empty">אין סניפים תואמים באזור הזה.</p>';
  }
  $('branchesToggle').addEventListener('click', () => {
    const el = $('branchList');
    el.hidden = !el.hidden;
    setBranchesToggleText();
    renderBranchList();
  });

  // ---------- חיפוש ----------
  const norm = (s) => s.toLowerCase().replace(/["'`׳״]/g, '').replace(/\s+/g, ' ').trim();
  const searchEl = $('search');
  const sugEl = $('suggest');
  let active = -1;
  let matches = [];
  function renderSuggest() {
    if (!matches.length) { sugEl.hidden = true; sugEl.innerHTML = ''; return; }
    sugEl.innerHTML = matches.map((e, i) =>
      `<button data-code="${e.c}" class="${i === active ? 'active' : ''}"><span style="display:flex;align-items:center;gap:8px;min-width:0"><span class="thumb sgthumb" data-code="${e.c}"></span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${e.n}</span></span><span class="chains">${e.ch.length} רשתות</span></button>`
    ).join('');
    sugEl.hidden = false;
    hydrateSuggestImages();
  }
  async function hydrateSuggestImages() {
    // בלי מנעול "עסוק" - חיפוש חדש תמיד מטעין; fetchImg מונע כפילויות בעצמו
    const codes = [...sugEl.querySelectorAll('.sgthumb[data-code]')].map((t) => t.dataset.code);
    for (const t of sugEl.querySelectorAll('.sgthumb[data-code]')) {
      const code = t.dataset.code;
      if (code.startsWith('v-')) { t.textContent = PRODUCE_EMOJI[code] || '🥬'; continue; }
      const c = imgCache[code];
      if (typeof c === 'string' && c) t.style.backgroundImage = `url("${c}")`;
    }
    await Promise.all(codes.filter((c) => !c.startsWith('v-') && /^\d{8,13}$/.test(c)).slice(0, 12).map(async (code) => {
      const url = await fetchImg(code);
      const cur = sugEl.querySelector(`.sgthumb[data-code="${code}"]`);
      if (cur && url) cur.style.backgroundImage = `url("${url}")`;
    }));
  }
  searchEl.addEventListener('input', () => {
    const q = norm(searchEl.value);
    active = -1;
    if (q.length < 2) { matches = []; renderSuggest(); return; }
    const toks = q.split(' ');
    matches = index
      .filter((e) => { const n = norm(e.n); return toks.every((t) => n.includes(t)); })
      .sort((a, b) => (b.ch.length - a.ch.length) || (a.n.length - b.n.length))
      .slice(0, 12);
    renderSuggest();
  });
  searchEl.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown') { active = Math.min(active + 1, matches.length - 1); renderSuggest(); ev.preventDefault(); }
    else if (ev.key === 'ArrowUp') { active = Math.max(active - 1, 0); renderSuggest(); ev.preventDefault(); }
    else if (ev.key === 'Enter' && matches.length) { add(matches[Math.max(active, 0)].c); ev.preventDefault(); }
    else if (ev.key === 'Escape') { matches = []; renderSuggest(); }
  });
  sugEl.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-code]');
    if (b) add(b.dataset.code);
  });
  document.addEventListener('click', (ev) => {
    if (!ev.target.closest('.searchbox')) { matches = []; renderSuggest(); }
  });
  async function add(code) {
    searchEl.value = ''; matches = []; renderSuggest();
    if (byCode.has(code)) nameMap[code] = byCode.get(code).n; // השם נלכד מיד - גם אם המוצר לא קיים באזור אחר
    if (!basket.includes(code)) { basket.push(code); saveBasket(); }
    await render();
  }

  // ---------- צ'יפים לדוגמה ----------
  function renderSampleChips() {
    $('sampleChips').innerHTML = sample.filter((c) => byCode.has(c)).map((c) =>
      `<button class="chip" data-code="${c}">+ ${byCode.get(c).n.slice(0, 22)}</button>`
    ).join('');
  }
  $('sampleChips').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-code]');
    if (b) add(b.dataset.code);
  });

  // ---------- סניפים קבועים (עד 4, כל סניף בארץ) ----------
  let favQuery = '';
  function renderFavPanel() {
    const el = $('favPanel');
    if (el.hidden) return;
    if (!el.dataset.init) {
      el.dataset.init = '1';
      el.innerHTML = `<p class="favhint">בחרו עד 4 סניפים מכל ${allBranches.length} הסניפים בארץ — כאן או דרך ⭐ בחלונית של סיכה במפה. המחיר לכל סניף נלקח מסניף-הבסיס של הרשת באזור שלו.</p>
        <div id="favSel" class="favsel"></div>
        <input id="favSearch" placeholder="הוסיפו סניף — חפשו לפי עיר, רשת או שם…" autocomplete="off" aria-label="חיפוש סניף">
        <div id="favResults" class="favresults"></div>`;
      el.querySelector('#favSearch').addEventListener('input', (e) => { favQuery = e.target.value.trim(); renderFavResults(); });
    }
    renderFavSel();
    renderFavResults();
  }
  function renderFavSel() {
    const box = $('favSel');
    if (!box) return;
    box.innerHTML = favs.length
      ? favCols().map((c) => `<button class="chip sel" data-fav="${c.key}" title="הסרה">${c.full} ✕</button>`).join('')
      : '<span class="favempty">עוד לא נבחרו סניפים</span>';
  }
  function renderFavResults() {
    const box = $('favResults');
    if (!box) return;
    const q = norm(favQuery);
    if (q.length < 2) { box.innerHTML = ''; return; }
    const toks = q.split(' ');
    const res = allBranches
      .filter((b) => favValid(b.key) && !favs.includes(b.key))
      .filter((b) => { const t = norm(`${chainName[b.chain]} ${b.name} ${b.city || ''}`); return toks.every((x) => t.includes(x)); })
      .slice(0, 20);
    box.innerHTML = res.length
      ? res.map((b) => `<button class="favres" data-fav="${b.key}">+ ${chainName[b.chain]} — ${b.name}${b.city && !b.name.includes(b.city) ? ' · ' + b.city : ''}</button>`).join('')
      : '<p class="favempty">לא נמצא סניף מתאים</p>';
  }
  function updateModeUI() {
    const n = favCols().length;
    updateLocSummary();
    $('tabRegion').classList.toggle('active', mode === 'region');
    $('tabFav').classList.toggle('active', mode === 'fav');
    $('modeNote').textContent = useFav()
      ? `${n} סניפים נבחרו — הבחירה במפה לא משפיעה`
      : (mode === 'fav' ? 'בחרו לפחות 2 סניפים (כאן או דרך ⭐ בסיכה במפה)' : '');
  }
  async function setMode(m) {
    mode = m;
    $('favPanel').hidden = mode !== 'fav';
    if (mode === 'fav') renderFavPanel();
    localStorage.setItem('zulik-mode', mode);
    updateModeUI();
    await loadDistrict();
    renderSampleChips();
    await render();
  }
  $('tabRegion').addEventListener('click', () => setMode('region'));
  $('tabFav').addEventListener('click', () => setMode('fav'));
  $('favPanel').addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-fav]');
    if (b) await toggleFav(b.dataset.fav);
  });
  document.addEventListener('click', async (ev) => {
    const fb = ev.target.closest('.favBtn[data-favkey]');
    if (!fb) return;
    lmap.closePopup();
    mode = 'fav';
    localStorage.setItem('zulik-mode', mode);
    $('favPanel').hidden = false;
    renderFavPanel();
    await toggleFav(fb.dataset.favkey);
  });

  // ---------- תמונות מוצרים (Open Food Facts, נשמר ב-localStorage) ----------
  const PRODUCE_EMOJI = { 'v-tomato': '🍅', 'v-cherrytomato': '🍅', 'v-cucumber': '🥒', 'v-onion': '🧅', 'v-potato': '🥔', 'v-sweetpotato': '🍠', 'v-carrot': '🥕', 'v-pepper-red': '🫑', 'v-pepper-yellow': '🫑', 'v-eggplant': '🍆', 'v-zucchini': '🥒', 'v-cabbage': '🥬', 'v-cauliflower': '🥦', 'v-lettuce': '🥬', 'v-garlic': '🧄', 'v-banana': '🍌', 'v-apple': '🍎', 'v-pear': '🍐', 'v-lemon': '🍋', 'v-orange': '🍊', 'v-clementine': '🍊', 'v-avocado': '🥑', 'v-watermelon': '🍉', 'v-melon': '🍈', 'v-grapes': '🍇', 'v-peach': '🍑', 'v-nectarine': '🍑', 'v-mango': '🥭', 'v-strawberry': '🍓', 'v-pomegranate': '🍎', 'v-date': '🌴' };
  let imgCache = {};
  try { imgCache = JSON.parse(localStorage.getItem('zulik-img-v2')) || {}; } catch {}
  // מקור ראשי: CDN התמונות של רמי לוי - תמונה לפי ברקוד לרוב המוצרים בישראל;
  // נפילה: שלושת מאגרי ה-Open Facts (מזון, מוצרי צריכה, טואלטיקה)
  const IMG_DBS = ['world.openfoodfacts.org', 'world.openproductsfacts.org', 'world.openbeautyfacts.org'];
  const probeImg = (url) => new Promise((resolve) => {
    const im = new Image();
    im.onload = () => resolve(im.naturalWidth > 1);
    im.onerror = () => resolve(false);
    im.src = url;
  });
  const imgInflight = new Map(); // מניעת בקשות כפולות לאותו ברקוד במקביל
  async function fetchImg(code) {
    if (code in imgCache) return imgCache[code];
    if (imgInflight.has(code)) return imgInflight.get(code);
    const p = fetchImgInner(code);
    imgInflight.set(code, p);
    const r = await p;
    imgInflight.delete(code);
    return r;
  }
  async function fetchImgInner(code) {
    const rl = `https://img.rami-levy.co.il/product/${code}/small.jpg`;
    if (await probeImg(rl)) {
      imgCache[code] = rl;
      localStorage.setItem('zulik-img-v2', JSON.stringify(imgCache));
      return rl;
    }
    for (const host of IMG_DBS) {
      try {
        const r = await fetch(`https://${host}/api/v2/product/${code}.json?fields=image_small_url,image_front_small_url`);
        const j = r.ok ? await r.json() : null;
        const url = j && j.product && (j.product.image_small_url || j.product.image_front_small_url);
        if (url) { imgCache[code] = url; localStorage.setItem('zulik-img-v2', JSON.stringify(imgCache)); return url; }
      } catch {}
    }
    imgCache[code] = 0;
    localStorage.setItem('zulik-img-v2', JSON.stringify(imgCache));
    return 0;
  }
  let imgFetching = false;
  async function hydrateImages() {
    const thumbs = [...document.querySelectorAll('.thumb[data-code]')];
    for (const t of thumbs) {
      const code = t.dataset.code;
      if (code.startsWith('v-')) { t.textContent = PRODUCE_EMOJI[code] || '🥬'; continue; }
      const c = imgCache[code];
      if (typeof c === 'string' && c) { t.style.backgroundImage = `url("${c}")`; t.textContent = ''; }
    }
    const codes = [...new Set(thumbs.map((t) => t.dataset.code))]
      .filter((c) => !c.startsWith('v-') && /^\d{8,13}$/.test(c))
      .slice(0, 24);
    await Promise.all(codes.map(async (code) => {
      const url = await fetchImg(code);
      if (!url) return;
      for (const cur of document.querySelectorAll(`.thumb[data-code="${code}"]`)) {
        cur.style.backgroundImage = `url("${url}")`;
        cur.textContent = '';
      }
    }));
  }

  // ---------- טבלת הסל ----------
  const fmtD = (iso) => iso.slice(8, 10) + '.' + iso.slice(5, 7);
  const fmtDT = (iso) => fmtD(iso) + (iso.length > 10 ? ' ' + iso.slice(11, 16) : '');
  function spark(hist, up, wide) {
    const ps = hist.map((h) => h[1]);
    const min = Math.min(...ps), max = Math.max(...ps), span = max - min || 1;
    const W = wide ? 250 : 120;
    const bottomPad = wide ? 15 : 5;
    const H = wide ? 50 : 24;
    const xy = (p, i) => [(16 + (i / Math.max(ps.length - 1, 1)) * (W - 32)).toFixed(1), (H - bottomPad - 4 - ((p - min) / span) * (H - bottomPad - 10)).toFixed(1)];
    const pts = ps.map((p, i) => xy(p, i).join(',')).join(' ');
    const color = up ? '#e34948' : 'var(--accent)';
    const dots = hist.map(([d, p], i) => {
      const [x, y] = xy(p, i);
      return `<circle cx="${x}" cy="${y}" r="${wide ? 4.5 : 3.2}" fill="${color}" data-tip="${fmtDT(d)} · ₪${p.toFixed(2)}"></circle>`;
    }).join('');
    // בקארד: התאריך (והשעה אם קיימת) כתוב בקטן מתחת לכל נקודה
    const labels = wide ? hist.map(([d], i) => {
      const [x] = xy(hist[i][1], i);
      return `<text x="${x}" y="${H - 2}" text-anchor="middle" font-size="8.5" fill="var(--text-3)">${fmtDT(d)}</text>`;
    }).join('') : '';
    return `<svg class="spark" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>${dots}${labels}</svg>`;
  }

  // עמודות: במצב אזור - הרשתות של המחוז; במצב סניפים קבועים - הסניפים שנבחרו
  function colsNow() {
    return useFav()
      ? favCols().map((o) => ({ dist: o.district, chain: o.chain, head: o.head, label: o.label }))
      : dChains().map((id) => ({ dist: district, chain: id, head: chainName[id], label: chainName[id] }));
  }
  async function render() {
    const cols = colsNow();
    updateModeUI();
    // מעל 7 עמודות - רוחב קבוע וגלילה אופקית בתוך הכרטיס
    const narrow = cols.length > 7 || matchMedia('(max-width: 640px)').matches;
    $('basketCard').style.setProperty('--pcols', narrow ? `repeat(${cols.length}, 64px)` : `repeat(${cols.length}, minmax(56px, 84px))`);
    $('thead').innerHTML = `<div class="pname">מוצר</div>` + cols.map((c) => `<div>${c.head}</div>`).join('') + '<div></div>';

    const dists = [...new Set(cols.map((c) => c.dist))];
    const recsByDist = {};
    for (const dist of dists) {
      recsByDist[dist] = await Promise.all(basket.map((code) => loadProductIn(dist, code)));
    }
    const rows = [];
    const totals = cols.map(() => 0);
    let comparable = 0;

    basket.forEach((code, bi) => {
      const colRecs = cols.map((c) => recsByDist[c.dist][bi]);
      const anyRec = colRecs.find(Boolean);
      if (anyRec) nameMap[code] = anyRec.name;
      else if (byCode.has(code)) nameMap[code] = byCode.get(code).n;
      if (!anyRec) {
        // המוצר לא נמכר בסניפים/אזור הנוכחיים - שומרים את השם, והקליק פותח קארד שמראה איפה כן
        const nm = nameMap[code] || 'מוצר מהסל';
        rows.push(`<div class="rowwrap"><div class="row" data-code="${code}">
          <div class="pname"><span class="thumb" data-code="${code}"></span><span class="ptxt">${nm}</span> <span class="notherepill" data-tip="לא נמכר כאן - לחצו לראות איפה כן">לא נמכר כאן</span></div>
          <div class="prices-m"></div><button class="rmv" data-rm="${code}" aria-label="הסרה">✕</button></div></div>`);
        return;
      }
      const prices = cols.map((c, i) => {
        const rec = colRecs[i];
        return rec && rec.prices[c.chain] ? rec.prices[c.chain].p : null;
      });
      const have = prices.filter((p) => p !== null);
      const full = have.length === cols.length;
      if (full) { comparable++; prices.forEach((p, i) => { totals[i] += p; }); }
      const best = Math.min(...have);
      const cells = cols.map((c, i) => {
        const p = prices[i];
        if (p === null) return `<div class="price missing" data-chain="${c.label}">—</div>`;
        const isBest = p === best && have.length > 1;
        const h = colRecs[i] && colRecs[i].history[c.chain];
        const chg = h && h.length >= 2 ? (h[h.length - 1][1] > h[h.length - 2][1] ? 'cup' : 'cdown') : null;
        const chgDate = chg ? h[h.length - 1][0] : null;
        const chgTip = chg ? `${chg === 'cup' ? 'התייקר' : 'הוזל'} מ-${fmt(h[h.length - 2][1])} ב-${fmtD(chgDate)}${chgDate === meta.updated && upTime ? ' בשעה ' + upTime : ''}` : '';
        const arrow = chg ? `<i class="chg ${chg}" data-tip="${chgTip}">${chg === 'cup' ? '▲' : '▼'}</i>` : '';
        return `<div class="price ${isBest ? 'best' : ''}" data-chain="${c.label}">${isBest ? `<span>${fmt(p)}${arrow}</span>` : fmt(p) + arrow}</div>`;
      }).join('');
      // אינדיקטור שינוי צמוד לשם - נראה גם כשעמודת הרשת גלולה מחוץ למסך (מובייל)
      let rowChg = '';
      {
        let latest = null;
        cols.forEach((c, i) => {
          const h = colRecs[i] && colRecs[i].history[c.chain];
          if (h && h.length >= 2 && (!latest || h[h.length - 1][0] > latest.at)) {
            latest = { at: h[h.length - 1][0], up: h[h.length - 1][1] > h[h.length - 2][1], chain: c.label, from: h[h.length - 2][1], to: h[h.length - 1][1] };
          }
        });
        if (latest) rowChg = `<i class="chg ${latest.up ? 'cup' : 'cdown'} rowchg" data-tip="${latest.chain}: ${latest.up ? 'התייקר' : 'הוזל'} מ-${fmt(latest.from)} ל-${fmt(latest.to)} · ${fmtDT(latest.at)}">${latest.up ? '▲' : '▼'}</i>`;
      }
      rows.push(`<div class="rowwrap"><div class="row" data-code="${code}">
        <div class="pname"><span class="thumb" data-code="${code}"></span><span class="ptxt">${anyRec.name}</span>${full ? '' : '<span class="staremark" data-tip="לא נמכר בכל הרשתות שבהשוואה - לכן לא נכלל בשורת הסה־כ">*</span>'}${rowChg}</div>
        <div class="prices-m">${cells}</div>
        <button class="rmv" data-rm="${code}" aria-label="הסרה">✕</button>
      </div></div>`);
    });

    $('rows').innerHTML = rows.join('');
    $('tablewrap').scrollLeft = 0; // RTL: מתחילים תמיד מעמודת המוצר, לא מהקצה השמאלי
    $('empty').hidden = basket.length > 0;

    const totalsEl = $('totals');
    const metricsEl = $('metrics');
    if (comparable > 0) {
      const bestT = Math.min(...totals);
      const worstT = Math.max(...totals);
      totalsEl.innerHTML = `<div class="pname">סה"כ (${comparable} מוצרים ${useFav() ? 'בכל הסניפים' : 'בכל הרשתות'})</div>
        <div class="prices-m">${cols.map((c, i) => `<div class="price ${totals[i] === bestT ? 'best' : ''}" data-chain="${c.label}">${totals[i] === bestT ? `<span>${fmt(totals[i])}</span>` : fmt(totals[i])}</div>`).join('')}</div><div></div>`;
      totalsEl.hidden = false;
      const bestCol = cols[totals.indexOf(bestT)];
      const pct = worstT > 0 ? Math.round(((worstT - bestT) / worstT) * 100) : 0;
      metricsEl.innerHTML = `
        <div class="metric"><p class="k">${useFav() ? 'הסניף הזול מביניהם' : 'הסל הזול ב' + dMeta().he}</p><p class="v">${bestCol.label}</p></div>
        <div class="metric"><p class="k">חיסכון מול היקר</p><p class="v">${fmt(worstT - bestT)} <small>${pct}%-</small></p></div>
        <div class="metric"><p class="k">מוצרים בסל</p><p class="v">${basket.length}</p></div>`;
      metricsEl.hidden = false;
    } else {
      totalsEl.hidden = true;
      metricsEl.hidden = true;
    }
    hydrateImages();
    resolveMissingNames();
  }
  // שמות למוצרים שלא נמכרים באזור הנוכחי - חיפוש שקט בשאר האזורים ועדכון השורה
  let namesBusy = false;
  async function resolveMissingNames() {
    if (namesBusy) return;
    namesBusy = true;
    for (const code of basket) {
      if (nameMap[code]) continue;
      for (const dm of meta.districts) {
        const rec = await loadProductIn(dm.id, code);
        if (rec && rec.name) {
          nameMap[code] = rec.name;
          const cell = document.querySelector(`.row[data-code="${code}"] .ptxt`);
          if (cell && /מוצר מהסל/.test(cell.textContent)) cell.textContent = rec.name;
          break;
        }
      }
    }
    namesBusy = false;
  }

  // ---------- קארד מוצר ----------
  async function openProductCard(code) {
    const cols = colsNow();
    let name = byCode.has(code) ? byCode.get(code).n : '';
    // זמינות בכל הארץ: רשת → אזורים שבהם היא מוכרת את המוצר
    const avail = {};
    const recByDist = {};
    for (const dm of meta.districts) {
      const rec = await loadProductIn(dm.id, code);
      if (!rec) continue;
      recByDist[dm.id] = rec;
      if (!name) name = rec.name;
      if (rec.name) nameMap[code] = rec.name;
      for (const [ch, pr] of Object.entries(rec.prices)) (avail[ch] = avail[ch] || []).push({ he: dm.he, p: pr.p });
    }
    const colRecs = cols.map((c) => recByDist[c.dist]);
    const prices = cols.map((c, i) => (colRecs[i] && colRecs[i].prices[c.chain] ? colRecs[i].prices[c.chain].p : null));
    const have = prices.filter((p) => p !== null);
    const best = have.length ? Math.min(...have) : null;
    // רשימה מאוחדת: מחיר + היסטוריה בשורה אחת לכל רשת, ממוינת מהזול ליקר
    const histOf = (i, chain) => (colRecs[i] && colRecs[i].history[chain]) || null;
    const entries = cols.map((c, i) => ({ label: c.label, p: prices[i], h: histOf(i, c.chain) }));
    if (!useFav()) {
      // רשתות שיש להן היסטוריה באזור אבל נשרו מהעמודות היום - מוצגות עם המחיר האחרון הידוע
      const rec = recByDist[district];
      if (rec) for (const [ch, h] of Object.entries(rec.history || {})) {
        if (chainName[ch] && !cols.some((c) => c.chain === ch) && h.length) { // רק רשתות פעילות
          entries.push({ label: chainName[ch], p: null, lastP: h[h.length - 1][1], h, ghost: true });
        }
      }
    }
    entries.sort((a, b) => (a.p ?? a.lastP ?? 1e9) - (b.p ?? b.lastP ?? 1e9));
    const histSrc = entries.map((e) => ({ label: e.label, h: e.h }));
    const histLine = (h) => {
      if (!h || !h.length) return '';
      const first = h[0], last = h[h.length - 1];
      const stable = h.length === 1 || first[1] === last[1];
      if (stable) {
        if (h.length === 1 && first[0] >= meta.updated) return '';
        return `<span class="phist stabletxt">יציב מאז ${fmtD(first[0])}</span>`;
      }
      const up = last[1] > first[1];
      const pct = first[1] ? Math.round((Math.abs(last[1] - first[1]) / first[1]) * 100) : 0;
      return `<div class="phist">${spark(h, up, true)}<span class="hbadge ${up ? 'hup' : 'hdown'}">${up ? '▲ התייקר' : '▼ הוזל'} ${pct}% · מ־${fmt(first[1])}</span></div>`;
    };
    const priceRows = entries.map((e) => {
      const priceHtml = e.p !== null
        ? (e.p === best && have.length > 1 ? `<span class="bestpill">${fmt(e.p)}</span>` : fmt(e.p))
        : (e.lastP != null ? `<span class="ghostprice" data-tip="הרשת לא בהשוואה היום - מחיר אחרון ידוע">${fmt(e.lastP)}*</span>` : '—');
      return `<div class="pcprice"><span class="pclabel">${e.label}</span><b>${priceHtml}</b>${histLine(e.h)}</div>`;
    }).join('');
    const availHtml = Object.keys(avail).length
      ? Object.keys(avail).sort((a, b) => avail[b].length - avail[a].length).map((ch) => {
          // אזור + המחיר שם - שלא יישאר "נמכר בסופר ספיר" בלי לדעת בכמה
          const seen = new Set();
          const parts = avail[ch].filter((e) => !seen.has(e.he) && seen.add(e.he))
            .map((e) => `${e.he} ${fmt(e.p)}`).join(' · ');
          return `<div class="pcavail"><b>${chainName[ch] || ch}</b> — ${parts}</div>`;
        }).join('')
      : '<div class="pcavail">לא נמצא באף אזור</div>';
    const noneHere = have.length === 0 && Object.keys(avail).length > 0;

    $('pcBody').innerHTML = `
      ${(() => {
        // תג שינוי אחרון בראש הקארד - נראה מיד, בלי לגלול להיסטוריה
        let latest = null;
        for (const { label, h } of histSrc) {
          if (h && h.length >= 2 && (!latest || h[h.length - 1][0] > latest.at)) {
            latest = { at: h[h.length - 1][0], up: h[h.length - 1][1] > h[h.length - 2][1], label, from: h[h.length - 2][1], to: h[h.length - 1][1] };
          }
        }
        window.__pcTopChg = latest ? `<span class="hbadge ${latest.up ? 'hup' : 'hdown'}" style="margin-top:4px;display:inline-block">${latest.up ? '▲ התייקר' : '▼ הוזל'} ב${latest.label}: ${fmt(latest.from)} ← ${fmt(latest.to)} · ${fmtDT(latest.at)}</span>` : '';
        return '';
      })()}
      <div class="pchead">
        <span class="pcimgwrap"><span class="pcimg thumb" data-code="${code}"></span><button class="pczoom" aria-label="הגדלת תמונה">＋</button></span>
        <div><h3>${name || 'מוצר'}</h3>${window.__pcTopChg}</div>
      </div>
      ${noneHere ? `<p class="pcnote">המוצר לא נמכר ב${useFav() ? 'סניפים שבחרת' : 'אזור הנוכחי'} — הנה איפה כן:</p>` : ''}
      ${entries.length ? `<div class="pcprices">${priceRows}</div>` : ''}
      <details class="pcdet"><summary>איפה המוצר נמכר</summary>${availHtml}</details>
      <p class="hnote">המחירים נכונים לעדכון האחרון: ${updatedLabel}</p>`;
    $('pcard').hidden = false;
    document.body.style.overflow = 'hidden'; // הגלילה בקארד לא תזיז את העמוד
    // תמונה גדולה
    if (code.startsWith('v-')) {
      const t = $('pcBody').querySelector('.pcimg');
      t.textContent = PRODUCE_EMOJI[code] || '🥬';
    } else {
      const url = await fetchImg(code);
      const t = $('pcBody').querySelector('.pcimg');
      if (t && url) { t.style.backgroundImage = `url("${url}")`; t.textContent = ''; }
    }
  }
  // ---------- הגדלת תמונות: תצוגה בריחוף + לייטבוקס בלחיצה ----------
  const bigUrl = (u) => u.includes('img.rami-levy.co.il') ? u.replace('/small.jpg', '/large.jpg') : u.replace('.200.jpg', '.400.jpg');
  const imgPrev = document.createElement('div');
  imgPrev.className = 'imgprev';
  imgPrev.hidden = true;
  document.body.appendChild(imgPrev);
  document.addEventListener('mouseover', (ev) => {
    const t = ev.target.closest && ev.target.closest('.thumb');
    if (!t || !t.style.backgroundImage) { imgPrev.hidden = true; return; }
    imgPrev.style.backgroundImage = t.style.backgroundImage;
    const r = t.getBoundingClientRect();
    imgPrev.style.top = Math.max(8, Math.min(innerHeight - 188, r.top - 70)) + 'px';
    imgPrev.style.right = Math.min(innerWidth - 188, innerWidth - r.left + 12) + 'px';
    imgPrev.hidden = false;
  });
  document.addEventListener('mouseout', (ev) => {
    if (ev.target.closest && ev.target.closest('.thumb')) imgPrev.hidden = true;
  });
  const zoomBox = document.createElement('div');
  zoomBox.id = 'imgzoom';
  zoomBox.hidden = true;
  zoomBox.innerHTML = '<img alt="">';
  document.body.appendChild(zoomBox);
  function openImgZoom(url) {
    if (!url) return;
    zoomBox.querySelector('img').src = bigUrl(url);
    zoomBox.hidden = false;
  }
  zoomBox.addEventListener('click', () => { zoomBox.hidden = true; });
  const thumbUrl = (t) => (t && t.style.backgroundImage.match(/url\("(.+)"\)/) || [])[1] || '';

  // טולטיפ מיידי בסטייל האתר (במקום ה-title האיטי והמרובע של הדפדפן)
  const ztip = document.createElement('div');
  ztip.className = 'ztip';
  ztip.hidden = true;
  document.body.appendChild(ztip);
  document.addEventListener('mouseover', (ev) => {
    const t = ev.target.closest && ev.target.closest('[data-tip]');
    if (!t) { ztip.hidden = true; return; }
    ztip.textContent = t.dataset.tip || t.getAttribute('data-tip');
    ztip.hidden = false;
  });
  document.addEventListener('mousemove', (ev) => {
    if (ztip.hidden) return;
    const pad = 14;
    let x = ev.clientX + pad, y = ev.clientY - 34;
    if (x + ztip.offsetWidth > innerWidth - 8) x = ev.clientX - ztip.offsetWidth - pad;
    if (y < 8) y = ev.clientY + pad;
    ztip.style.left = x + 'px';
    ztip.style.top = y + 'px';
  });

  $('pcBody').addEventListener('click', (ev) => {
    // כפתור ה-＋ או לחיצה על התמונה בקארד - הגדלה
    if (ev.target.closest('.pczoom') || ev.target.closest('.pcimg')) {
      const t = $('pcBody').querySelector('.pcimg');
      if (thumbUrl(t)) openImgZoom(thumbUrl(t));
    }
  });
  $('pcClose').addEventListener('click', () => { $('pcard').hidden = true; document.body.style.overflow = ''; });
  $('pcard').addEventListener('click', (ev) => { if (ev.target === $('pcard')) $('pcard').hidden = true; document.body.style.overflow = ''; });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') $('pcard').hidden = true; document.body.style.overflow = ''; });

  $('rows').addEventListener('click', async (ev) => {
    const rm = ev.target.closest('[data-rm]');
    if (rm) {
      basket = basket.filter((c) => c !== rm.dataset.rm);
      saveBasket();
      await render();
      return;
    }
    // לחיצה על התמונה עצמה (נוח במובייל) - מגדילה אותה; לחיצה על השאר - קארד
    const th = ev.target.closest('.thumb');
    if (th && thumbUrl(th)) { openImgZoom(thumbUrl(th)); return; }
    const row = ev.target.closest('.row[data-code]');
    if (row) await openProductCard(row.dataset.code);
  });

  await loadDistrict();
  renderDistrictUI();
  renderSampleChips();
  $('favPanel').hidden = mode !== 'fav';
  if (mode === 'fav') renderFavPanel();
  await render();
})();
