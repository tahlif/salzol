(async function () {
  const $ = (id) => document.getElementById(id);
  const fmt = (v) => '₪' + v.toFixed(2);

  // ---------- מחיר ליחידה (rec.u = [כמות, סוג] מנורמל מה-build) ----------
  const UNIT_BASE = { g: [100, "100 ג'"], ml: [100, '100 מ"ל'], unit: [1, "יח'"], m: [1, 'מטר'] };
  function unitPrice(p, u) {
    if (p == null || !u) return null;
    const [q, k] = u, def = UNIT_BASE[k];
    if (!def || !q) return null;
    if (k === 'unit' && q <= 1) return null; // מחיר ליחידה כשיש יחידה אחת = המחיר עצמו
    return { v: (p / q) * def[0], lbl: def[1], k };
  }
  const fmtU = (up) => `₪${up.v >= 100 ? up.v.toFixed(0) : up.v.toFixed(2)} ל־${up.lbl}`;
  const fmtUShort = (up) => `${up.v >= 100 ? up.v.toFixed(0) : up.v.toFixed(2)}/${up.lbl.replace(/\s/g, '')}`;
  function fmtPkg(u) {
    if (!u) return '';
    const [q, k] = u;
    if (k === 'g') return q >= 1000 ? +(q / 1000).toFixed(2) + ' ק"ג' : +q.toFixed(1) + ' גרם';
    if (k === 'ml') return q >= 1000 ? +(q / 1000).toFixed(2) + ' ליטר' : +q.toFixed(0) + ' מ"ל';
    if (k === 'unit') return q > 1 ? +q.toFixed(0) + " יח'" : '';
    return q + ' מטר';
  }
  const UNIT_HE = { g: 'גרם', ml: 'מ"ל', unit: "יח'", m: 'מטר' };
  // דגלים כתמונות SVG - ווינדוס לא מציג דגלי אמוג'י (מראה אותיות IL במקום דגל)
  const flagImg = (cc) => {
    if (!cc || !/^[A-Z]{2}$/.test(cc)) return '';
    const cp = [...cc].map((c) => (0x1f1e6 + c.charCodeAt(0) - 65).toString(16)).join('-');
    return `<img class="flagimg" alt="${cc}" src="https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/svg/${cp}.svg" loading="lazy" onerror="this.hidden=1">`;
  };
  const COUNTRY_NAME = { IL: 'ישראל', CN: 'סין', TR: 'טורקיה', IT: 'איטליה', ES: 'ספרד', DE: 'גרמניה', PL: 'פולין', FR: 'צרפת', US: 'ארה"ב', NL: 'הולנד', BE: 'בלגיה', CH: 'שוויץ', GR: 'יוון', GB: 'בריטניה', UA: 'אוקראינה', IN: 'הודו', TH: 'תאילנד', BR: 'ברזיל', AR: 'ארגנטינה', DK: 'דנמרק', SE: 'שוודיה', AT: 'אוסטריה', CZ: "צ'כיה", RO: 'רומניה', BG: 'בולגריה', LT: 'ליטא', LV: 'לטביה', PT: 'פורטוגל', IE: 'אירלנד', CA: 'קנדה', NO: 'נורווגיה', FI: 'פינלנד', EC: 'אקוודור', KR: 'קוריאה', JP: 'יפן', ZA: 'דרום אפריקה', CY: 'קפריסין', HU: 'הונגריה', VN: 'וייטנאם', LK: 'סרי לנקה', MX: 'מקסיקו', ID: 'אינדונזיה', PH: 'פיליפינים', MY: 'מלזיה', AE: 'האמירויות', JO: 'ירדן', EG: 'מצרים', SK: 'סלובקיה', SI: 'סלובניה', HR: 'קרואטיה', PE: 'פרו', CL: "צ'ילה", CO: 'קולומביה', ET: 'אתיופיה' };
  const flagHtml = (mc) => (mc && flagImg(mc) ? `<span class="rowflag" data-tip="תוצרת ${COUNTRY_NAME[mc] || mc}">${flagImg(mc)}</span>` : '');

  // ---------- התחברות: אנונימי מוגבל (2 סניפים, 5 מוצרים), מחובר נהנה מהכל (5, 100) ----------
  let me = null, googleCid = '';
  try {
    const auth = await fetch('/api/me').then((r) => (r.ok ? r.json() : null));
    if (auth) { me = auth.user; googleCid = auth.cid || ''; }
  } catch {}
  const LIMITS = () => (me ? { favs: 5, basket: 100 } : { favs: 2, basket: 5 });

  const toast = document.createElement('div');
  toast.className = 'sztoast';
  toast.hidden = true;
  document.body.appendChild(toast);
  let toastTimer = null;
  function showToast(html) {
    toast.innerHTML = html;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 6000);
  }

  // ---------- מודל התחברות: מייל+סיסמה, הרשמה, שכחתי סיסמה + כפתור גוגל ----------
  const authModal = $('authModal');
  const AUTH_ERRS = {
    'bad-credentials': 'אימייל או סיסמה שגויים.', exists: 'כבר קיים חשבון עם האימייל הזה - נסו להתחבר.',
    'bad-email': 'כתובת אימייל לא תקינה.', 'weak-password': 'הסיסמה קצרה מדי - לפחות 6 תווים.',
    'missing-name': 'חסר שם.', 'bad-token': 'קישור האיפוס פג תוקף - בקשו קישור חדש.',
    'reset-not-available': 'איפוס במייל יופעל בקרוב. בינתיים היכנסו עם Google, או כתבו לנו: contact@salzol.com',
  };
  // כפתור גוגל בעיצוב שלנו: ה-iframe הרשמי שקוף מעל - הקליק אמיתי, המראה מודרני
  const GOOGLE_G = '<svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';
  const GSLOT = `<div class="gslot"><button class="gbtn" type="button" tabindex="-1">${GOOGLE_G}<span>המשך עם Google</span></button><div id="gsiBtn" class="gsireal"></div></div>`;
  function authView(view, resetToken) {
    const F = {
      login: `<h3>התחברות לסַלְזוֹל</h3><p class="authsub">משווים עד 5 סניפים ועד 100 מוצרים - בחינם</p>
        <input type="email" id="afEmail" placeholder="אימייל" autocomplete="email">
        <input type="password" id="afPass" placeholder="סיסמה" autocomplete="current-password">
        <p class="autherr" id="afErr" hidden></p>
        <button class="authsubmit" id="afGo">התחברות</button>
        <p class="authlinks"><a href="#" data-v="register">להרשמה</a> · <a href="#" data-v="forgot">שכחתי סיסמה</a></p>
        <div class="authdiv"><span>או</span></div>${GSLOT}`,
      register: `<h3>הרשמה לסַלְזוֹל</h3><p class="authsub">הרשמה חינם - עד 5 סניפים ועד 100 מוצרים בהשוואה</p>
        <input type="text" id="afName" placeholder="שם" autocomplete="name">
        <input type="email" id="afEmail" placeholder="אימייל" autocomplete="email">
        <input type="password" id="afPass" placeholder="סיסמה (לפחות 6 תווים)" autocomplete="new-password">
        <p class="autherr" id="afErr" hidden></p>
        <button class="authsubmit" id="afGo">הרשמה</button>
        <p class="authlinks">כבר רשומים? <a href="#" data-v="login">התחברות</a></p>
        <div class="authdiv"><span>או</span></div>${GSLOT}`,
      forgot: `<h3>איפוס סיסמה</h3>
        <p class="authnote">נשלח לכם קישור איפוס לאימייל:</p>
        <input type="email" id="afEmail" placeholder="אימייל" autocomplete="email">
        <p class="autherr" id="afErr" hidden></p>
        <button class="authsubmit" id="afGo">שליחת קישור</button>
        <p class="authlinks"><a href="#" data-v="login">חזרה להתחברות</a></p>`,
      newpass: `<h3>סיסמה חדשה</h3>
        <input type="password" id="afPass" placeholder="סיסמה חדשה (לפחות 6 תווים)" autocomplete="new-password">
        <p class="autherr" id="afErr" hidden></p>
        <button class="authsubmit" id="afGo">שמירה</button>`,
    };
    $('authViews').innerHTML = F[view];
    $('authViews').querySelectorAll('[data-v]').forEach((a) => a.addEventListener('click', (ev) => { ev.preventDefault(); authView(a.dataset.v); }));
    const err = (code) => { const el = $('afErr'); el.textContent = AUTH_ERRS[code] || 'משהו השתבש - נסו שוב.'; el.hidden = false; };
    const post = (path, body) => fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (x) => ({ ok: x.ok, j: await x.json().catch(() => ({})) }));
    const loggedIn = (user, msg) => {
      me = user;
      authModal.hidden = true;
      renderAuthUI();
      const fab = $('listFab');
      if (fab) fab.hidden = false;
      syncListSoon();
      showToast(msg || `ברוכים הבאים, ${me.name}! עכשיו אפשר עד 5 סניפים ועד 100 מוצרים.`);
      // הגיעו מקישור רשימה משותפת והתחברו עכשיו - טוענים את הרשימה
      if (window.__pendingShare) {
        const id = window.__pendingShare;
        window.__pendingShare = null;
        tryLoadShared(id).then((ok) => { if (ok) render(); });
      }
    };
    $('afGo').addEventListener('click', async () => {
      $('afGo').disabled = true;
      let r;
      if (view === 'login') r = await post('/api/login-pass', { email: $('afEmail').value, password: $('afPass').value });
      else if (view === 'register') r = await post('/api/register', { name: $('afName').value, email: $('afEmail').value, password: $('afPass').value });
      else if (view === 'forgot') r = await post('/api/reset-request', { email: $('afEmail').value });
      else r = await post('/api/reset-confirm', { token: resetToken, password: $('afPass').value });
      $('afGo').disabled = false;
      if (!r.ok) { err(r.j.error); return; }
      if (view === 'forgot') { showToast('אם קיים חשבון עם האימייל הזה - נשלח אליו קישור איפוס.'); authModal.hidden = true; }
      else if (view === 'newpass') { showToast('הסיסמה עודכנה! התחברו עם הסיסמה החדשה.'); authView('login'); }
      else loggedIn(r.j.user);
    });
    if (googleCid && $('gsiBtn')) {
      const tryRender = () => {
        if (!window.google || !google.accounts || !google.accounts.id) { setTimeout(tryRender, 300); return; }
        google.accounts.id.initialize({
          client_id: googleCid,
          callback: async (resp) => {
            const r = await post('/api/login', { credential: resp.credential });
            if (r.ok && r.j.user) loggedIn(r.j.user);
            else err();
          },
        });
        if ($('gsiBtn')) google.accounts.id.renderButton($('gsiBtn'), { theme: 'outline', size: 'large', text: 'signin_with', locale: 'he', width: '320' });
      };
      tryRender();
    }
  }
  $('authClose').addEventListener('click', () => { authModal.hidden = true; });
  authModal.addEventListener('click', (ev) => { if (ev.target === authModal) authModal.hidden = true; });
  authModal.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && $('afGo')) $('afGo').click(); });

  function renderAuthUI() {
    const box = $('authBox');
    if (!box) return;
    if (me) {
      // מחובר: המבורגר עם דרופדאון - שם, ניהול (לאדמין) והתנתקות
      box.innerHTML = `<button class="hamb" id="menuBtn" aria-label="תפריט">☰</button>
        <div class="menupop" id="menuPop" hidden>
          <div class="menuhead">${me.picture ? `<img src="${me.picture}" alt="">` : ''}<div><b>${me.name}</b><small>${me.email}</small></div></div>
          <button class="menuitem" id="menuListBtn">🛒 שיתוף הרשימה</button>
          <button class="menuitem" id="menuAccBtn">👤 פרטים אישיים</button>
          ${me.admin ? '<a class="menuitem" href="admin.html">🛠 פאנל ניהול</a>' : ''}
          <a class="menuitem" href="pages/contact.html">📨 צור קשר</a>
          <a class="menuitem" href="pages/terms.html">📄 תקנון שימוש</a>
          <a class="menuitem" href="pages/accessibility.html">♿ הצהרת נגישות</a>
          <a class="menuitem" href="pages/privacy.html">🔒 מדיניות פרטיות</a>
          <button class="menuitem" id="logoutBtn">התנתקות</button>
        </div>`;
      box.querySelector('#menuListBtn').addEventListener('click', () => { box.querySelector('#menuPop').hidden = true; openListPanel(); });
      box.querySelector('#menuAccBtn').addEventListener('click', () => { box.querySelector('#menuPop').hidden = true; openAccountModal(); });
      const pop = box.querySelector('#menuPop');
      box.querySelector('#menuBtn').addEventListener('click', (ev) => { ev.stopPropagation(); pop.hidden = !pop.hidden; });
      document.addEventListener('click', (ev) => { if (!pop.hidden && !ev.target.closest('#authBox')) pop.hidden = true; });
      box.querySelector('#logoutBtn').addEventListener('click', async () => {
        await fetch('/api/logout', { method: 'POST' });
        me = null;
        renderAuthUI();
        const fab = $('listFab');
        if (fab) { fab.hidden = true; $('listPanel').hidden = true; }
        showToast('התנתקת. בחינם: עד 2 סניפים ו-5 מוצרים בהשוואה.');
      });
    } else {
      box.innerHTML = '<button class="loginbtn" id="loginOpen">התחברות</button>';
      box.querySelector('#loginOpen').addEventListener('click', () => {
        authModal.hidden = false;
        authView('login');
      });
    }
  }
  // כניסה מקישור איפוס סיסמה (?reset=<token>)
  const resetTok = new URLSearchParams(location.search).get('reset');
  if (resetTok) { authModal.hidden = false; authView('newpass', resetTok); }

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
  $('updatedBadge').textContent = `עדכון אחרון ${updatedLabel}`;
  $('storesLine').textContent = `במאגר: ${meta.products ? meta.products.toLocaleString() + ' פריטים · ' : ''}${meta.stores.toLocaleString()} סניפים · ${chainsAll.length} רשתות.`;

  // ---------- מצב ----------
  let district = localStorage.getItem('zulik-district');
  if (!meta.districts.some((x) => x.id === district)) district = 'telaviv';
  let mode = localStorage.getItem('zulik-mode') === 'fav' ? 'fav' : 'region';
  let favs = []; // מפתחות "chain:store" - כל סניף בארץ
  try { favs = JSON.parse(localStorage.getItem('zulik-favs2')) || []; } catch {}
  let basket = [];
  try { basket = JSON.parse(localStorage.getItem('zulik-basket')) || []; } catch {}
  // כמות לכל מוצר בסל - מוצרי יחידה: 1-10; מוצרים שקילים: משקל בק"ג בקפיצות חצי ק"ג
  let qty = {};
  try { qty = JSON.parse(localStorage.getItem('zulik-qty')) || {}; } catch {}
  // מוצר שקיל = נמכר לפי ק"ג (שכבת התוצרת v-* או קוד פנימי קצר של רשת, לא ברקוד אמיתי)
  const byWeight = (code) => {
    const u = (byCode.get(code) || {}).u;
    return !!u && u[1] === 'g' && u[0] >= 500 && !/^\d{8,13}$/.test(code);
  };
  const QTY_MAX = 30;
  const qtyStep = (code) => (byWeight(code) ? 0.1 : 1);
  const qtyOf = (code) => Math.min(QTY_MAX, Math.max(qtyStep(code), qty[code] || 1));
  const fmtQ = (q) => String(Math.round(q * 100) / 100); // 1.37 נשאר 1.37, לא מעוגל ל-1.4
  const saveQty = () => { localStorage.setItem('zulik-qty', JSON.stringify(qty)); syncListSoon(); };
  let sortByUnit = false; // מיון תצוגה לפי מחיר-ליחידה (לא משנה את סדר הסל השמור)
  let noClub = localStorage.getItem('zulik-noclub') === '1'; // הסתרת מבצעים שדורשים מועדון
  const esc = (s) => String(s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const promoTip = (pr) => `${esc(pr.d) || 'מבצע'} · עד ${fmtD(pr.e)}${pr.m ? ` · בקניית ${pr.m} יח'` : ''}${pr.c ? ' · 🎫 מועדון הרשת' : ''}`;
  // שמות מוצרים שנשמרים בין אזורים - כדי ששורת "לא נמכר כאן" תציג שם אמיתי
  let nameMap = {};
  try { nameMap = JSON.parse(localStorage.getItem('zulik-names')) || {}; } catch {}
  setInterval(() => localStorage.setItem('zulik-names', JSON.stringify(nameMap)), 4000);
  if (!basket.length) basket = sample.slice(0, LIMITS().basket);
  // מחובר: כל שינוי בסל נדחף לענן (debounce) - הרשימה מסתנכרנת בין מכשירים
  let listSyncT = 0;
  const syncListSoon = () => {
    if (!me) return;
    clearTimeout(listSyncT);
    listSyncT = setTimeout(() => {
      fetch('/api/list', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: basket.map((c) => ({ c, q: qtyOf(c) })) }) }).catch(() => {});
    }, 1200);
  };
  const saveBasket = () => { localStorage.setItem('zulik-basket', JSON.stringify(basket)); syncListSoon(); };
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
    else if (favs.length >= LIMITS().favs) {
      showToast(me
        ? `הגעת למקסימום - עד ${LIMITS().favs} סניפים קבועים.`
        : 'בחינם משווים עד 2 סניפים קבועים. <b>התחברו עם Google</b> (למעלה) לעד 5 סניפים ו-100 מוצרים - בחינם.');
      return;
    }
    else if (favValid(key)) favs.push(key);
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
  favs = favs.filter((k) => branchByKey.has(k)).slice(0, 5);
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
  // אותיות סופיות מנורמלות: "מלפפון" (ן סופית) חייב למצוא את "מלפפונים" (נ רגילה)
  const FINALS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
  const norm = (s) => s.toLowerCase().replace(/["'`׳״]/g, '').replace(/[ךםןףץ]/g, (c) => FINALS[c]).replace(/\s+/g, ' ').trim();
  const searchEl = $('search');
  const sugEl = $('suggest');
  let active = -1;
  let matches = [];
  let allMatches = [];
  let shown = 10;
  let decorate = (e) => e;
  function renderSuggest() {
    if (!matches.length) { sugEl.hidden = true; sugEl.innerHTML = ''; return; }
    sugEl.innerHTML = matches.map((e, i) => {
      const mcFlag = flagImg(e.mc || (e.il ? 'IL' : ''));
      const meta = [
        e.pm ? '<span class="sgpromo">🏷 במבצע</span>' : '',
        e.dn ? '<span class="chgdown">▼ הוזל</span>' : '',
        e.b, fmtPkg(e.u),
        mcFlag ? `${mcFlag} ${COUNTRY_NAME[e.mc] || ''}`.trim() : '',
      ].filter(Boolean).join(' · ');
      // מחיר: מהאינדקס אם קיים (e.p), אחרת placeholder שמתמלא מהשארד ברקע
      const priceB = e.p != null ? `<b class="sgprice">מ-${fmt(e.p)}</b>` : `<b class="sgprice" data-code="${e.c}"></b>`;
      const inBasket = basket.includes(e.c);
      return `<button data-code="${e.c}" class="${i === active ? 'active' : ''}"><span style="display:flex;align-items:center;gap:8px;min-width:0"><span class="thumb sgthumb" data-code="${e.c}"></span><span class="sgtext"><span class="sgname">${e.n}</span>${meta ? `<small class="sgmeta">${meta}</small>` : ''}</span></span><span class="chains">${e.favAll ? `<span class="sgfav sgfavall">⭐ בכל המועדפים שלך</span><br>` : e.favIn && e.favIn.length ? `<span class="sgfav">⭐ יש ב${chainName[e.favIn[0]]}${e.favIn.length > 1 ? ` +${e.favIn.length - 1}` : ''}</span><br>` : ''}${e.ch.length} רשתות<br>${priceB}</span><span class="sgadd${inBasket ? ' insg' : ''}" data-add="${e.c}" data-tip="הוסף לרשימה">${inBasket ? '✓' : '+'}</span></button>`;
    }).join('');
    sugEl.hidden = false;
    hydrateSuggestImages();
    clearTimeout(priceHydT);
    priceHydT = setTimeout(hydrateSuggestPrices, 250);
  }
  // השלמת מחיר "מ-₪X" להצעות שאין להן p באינדקס - נשלף מהשארד של המחוז הנוכחי
  let priceHydT = 0;
  async function hydrateSuggestPrices() {
    const dist = useFav() && favCols().length ? favCols()[0].district : district;
    await Promise.all([...sugEl.querySelectorAll('.sgprice[data-code]')].map(async (el) => {
      const rec = await loadProductIn(dist, el.dataset.code);
      const ps = rec ? Object.values(rec.prices).map((x) => x.p).filter((v) => typeof v === 'number') : [];
      if (!ps.length) { if (el.previousSibling && el.previousSibling.nodeName === 'BR') el.previousSibling.remove(); el.remove(); return; }
      el.textContent = `מ-${fmt(Math.min(...ps))}`;
      el.removeAttribute('data-code');
    }));
  }
  async function hydrateSuggestImages() {
    // בלי מנעול "עסוק" - חיפוש חדש תמיד מטעין; fetchImg מונע כפילויות בעצמו
    const codes = [...sugEl.querySelectorAll('.sgthumb[data-code]')].map((t) => t.dataset.code);
    for (const t of sugEl.querySelectorAll('.sgthumb[data-code]')) {
      const code = t.dataset.code;
      if (code.startsWith('v-')) { t.textContent = PRODUCE_EMOJI[code] || '🥬'; continue; }
      const c = imgCache[code];
      if (typeof c === 'string' && c) t.style.backgroundImage = `url("${c}")`;
      else if (c === 0 || !/^\d{8,13}$/.test(code)) setThumbEmoji(t, code);
    }
    await Promise.all(codes.filter((c) => !c.startsWith('v-') && /^\d{8,13}$/.test(c)).slice(0, 12).map(async (code) => {
      const url = await fetchImg(code);
      const cur = sugEl.querySelector(`.sgthumb[data-code="${code}"]`);
      if (!cur) return;
      if (url) cur.style.backgroundImage = `url("${url}")`;
      else setThumbEmoji(cur, code);
    }));
  }
  // פילטרים לחיפוש: כחול-לבן / במבצע / הוזלו לאחרונה - ניתנים לשילוב;
  // פילטר פעיל בלי טקסט חיפוש = מציג ישר את המוצרים המתאימים
  let filters = { il: localStorage.getItem('zulik-ilonly') === '1', pm: false, dn: false };
  const anyFilter = () => filters.il || filters.pm || filters.dn;
  const passFilters = (e) =>
    (!filters.il || e.il || e.mc === 'IL') && (!filters.pm || e.pm) && (!filters.dn || e.dn);
  function computeMatches() {
    const q = norm(searchEl.value);
    active = -1;
    if (q.length < 2 && !anyFilter()) { matches = []; renderSuggest(); return; }
    const toks = q.length >= 2 ? q.split(' ') : [];
    // סניפים מועדפים: מוצר שקיים בכל הסניפים המועדפים - ראשון בעדיפות; אחריו לפי כמות כיסוי
    const favChains = new Set(favs.map((k) => (branchByKey.get(k) || {}).chain).filter(Boolean));
    const favCount = (e) => (favChains.size ? e.ch.filter((c) => favChains.has(c)).length : 0);
    const allFav = (e) => favChains.size > 0 && [...favChains].every((c) => e.ch.includes(c));
    // רלוונטיות: שם זהה לשאילתה קודם; רשומות התוצרת שלנו (v-*) באותה דרגה גם על
    // צורת יחיד/רבים ("בננה"→"בננות (ק\"ג)"); אחריהן שם שמתחיל בשאילתה - כדי
    // ש"בננה" יחזיר בננה אמיתית ולא מיץ תות-בננה שנמכר ב-15 רשתות
    const rel = (e) => {
      if (!toks.length) return 3;
      const n = norm(e.n);
      if (n === q) return 0;
      if (e.c.startsWith('v-') && n.startsWith(q.slice(0, Math.max(3, q.length - 1)))) return 0;
      if (n.startsWith(q)) return 1;
      return 3;
    };
    // חיפוש גם לפי מותג (יצרן); מוצרים שלא נמכרו 120+ יום יורדים לסוף.
    // כל התוצאות נשמרות; מוצגות 10 וגלילה לתחתית פותחת עוד 10 (פילטר "מבצע" = כל המבצעים)
    decorate = (e) => ({ ...e, favIn: favChains.size ? e.ch.filter((c) => favChains.has(c)) : [], favAll: allFav(e) });
    allMatches = index
      .filter(passFilters)
      .filter((e) => {
        if (!toks.length) return true;
        const n = norm(e.n + ' ' + (e.b || ''));
        // התאמה רכה: "מעדני דניאלה" מוצא את "דניאלה מעדן גבינה", "בננה" את "בננות" -
        // אם המילה לא נמצאת כמו שהיא, מנסים בלי ה/י בסוף, ובלי סיומת ים/ות
        return toks.every((t) => n.includes(t)
          || (t.length >= 4 && n.includes(t.slice(0, -1)))
          || (t.length >= 5 && /(ים|ות)$/.test(t) && n.includes(t.slice(0, -2))));
      })
      .sort((a, b) => ((a.z || 0) - (b.z || 0)) || (rel(a) - rel(b)) || (allFav(b) - allFav(a)) || (favCount(b) - favCount(a)) || (b.ch.length - a.ch.length) || (a.n.length - b.n.length));
    shown = 10;
    matches = allMatches.slice(0, shown).map(decorate);
    renderSuggest();
  }
  searchEl.addEventListener('input', computeMatches);
  searchEl.addEventListener('focus', () => { if (anyFilter() && !matches.length) computeMatches(); });
  searchEl.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown') { active = Math.min(active + 1, matches.length - 1); renderSuggest(); ev.preventDefault(); }
    else if (ev.key === 'ArrowUp') { active = Math.max(active - 1, 0); renderSuggest(); ev.preventDefault(); }
    else if (ev.key === 'Enter' && matches.length) { add(matches[Math.max(active, 0)].c); ev.preventDefault(); }
    else if (ev.key === 'Escape') { matches = []; renderSuggest(); }
  });
  sugEl.addEventListener('click', async (ev) => {
    // ➕ מוסיף לרשימה בלי לסגור את חלונית החיפוש - אפשר להוסיף כמה מוצרים ברצף
    const plus = ev.target.closest('.sgadd');
    if (plus) {
      ev.stopPropagation();
      const ok = await addToBasket(plus.dataset.add);
      if (ok) { const st = sugEl.scrollTop; renderSuggest(); sugEl.scrollTop = st; }
      return;
    }
    const b = ev.target.closest('button[data-code]');
    if (b) add(b.dataset.code);
  });
  // גלילה לתחתית ההצעות פותחת עוד 10 תוצאות
  sugEl.addEventListener('scroll', () => {
    if (shown >= allMatches.length) return;
    if (sugEl.scrollTop + sugEl.clientHeight < sugEl.scrollHeight - 80) return;
    shown += 10;
    const st = sugEl.scrollTop;
    matches = allMatches.slice(0, shown).map(decorate);
    renderSuggest();
    sugEl.scrollTop = st;
  });
  document.addEventListener('click', (ev) => {
    // קליק על צ'יפ פילטר לא סוגר את ההצעות - הוא בדיוק מה שפותח אותן
    if (!ev.target.closest('.searchbox') && !ev.target.closest('#sampleChips')) { matches = []; renderSuggest(); }
  });
  // הוספה לסל בלי לגעת בחלונית החיפוש (משרת גם את ➕ שבהצעות); מחזירה הצלחה
  async function addToBasket(code) {
    // בחירה חוזרת של מוצר שכבר בסל = עוד יחידה/0.1 ק"ג (עד 30) - כל המחירים והסה"כ מתעדכנים
    if (basket.includes(code)) {
      qty[code] = Math.round(Math.min(QTY_MAX, qtyOf(code) + qtyStep(code)) * 100) / 100;
      saveQty();
      await render();
      return true;
    }
    if (basket.length >= LIMITS().basket) {
      showToast(me
        ? `הגעת למקסימום - עד ${LIMITS().basket} מוצרים בהשוואה.`
        : 'בחינם משווים עד 5 מוצרים. <b>התחברו עם Google</b> (למעלה) להשוואה של עד 100 מוצרים ו-5 סניפים - בחינם.');
      return false;
    }
    if (byCode.has(code)) nameMap[code] = byCode.get(code).n; // השם נלכד מיד - גם אם המוצר לא קיים באזור אחר
    basket.push(code);
    saveBasket();
    await render();
    return true;
  }
  async function add(code) {
    searchEl.value = ''; matches = []; allMatches = []; renderSuggest();
    await addToBasket(code);
  }

  // ---------- צ'יפים לדוגמה ----------
  function renderSampleChips() {
    $('sampleChips').innerHTML =
      `<button class="chip ${filters.il ? 'sel' : ''}" data-filter="il" data-tip="רק מוצרים המיוצרים בישראל">${flagImg('IL')} כחול-לבן</button>` +
      `<button class="chip ${filters.pm ? 'sel' : ''}" data-filter="pm" data-tip="רק מוצרים שיש עליהם מבצע היום">🏷 במבצע</button>` +
      `<button class="chip ${filters.dn ? 'sel' : ''}" data-filter="dn" data-tip="מוצרים שמחירם ירד בשבוע האחרון">▼ הוזלו לאחרונה</button>`;
  }
  $('sampleChips').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-filter]');
    if (!b) return;
    const f = b.dataset.filter;
    filters[f] = !filters[f];
    if (f === 'il') localStorage.setItem('zulik-ilonly', filters.il ? '1' : '0');
    b.classList.toggle('sel', filters[f]);
    computeMatches();
    if (anyFilter()) searchEl.focus();
  });

  // ---------- סניפים קבועים (עד 4, כל סניף בארץ) ----------
  let favQuery = '';
  function renderFavPanel() {
    const el = $('favPanel');
    if (el.hidden) return;
    if (!el.dataset.init) {
      el.dataset.init = '1';
      el.innerHTML = `<p class="favhint"></p>
        <div id="favSel" class="favsel"></div>
        <input id="favSearch" placeholder="הוסיפו סניף — חפשו לפי עיר, רשת או שם…" autocomplete="off" aria-label="חיפוש סניף">
        <div id="favResults" class="favresults"></div>`;
      el.querySelector('#favSearch').addEventListener('input', (e) => { favQuery = e.target.value.trim(); renderFavResults(); });
    }
    el.querySelector('.favhint').textContent = `בחרו עד ${LIMITS().favs} סניפים מכל ${allBranches.length} הסניפים בארץ — כאן או דרך ⭐ בחלונית של סיכה במפה.`;
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
      ? ''
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
  $('sortUnit').addEventListener('click', async () => {
    sortByUnit = !sortByUnit;
    $('sortUnit').classList.toggle('sel', sortByUnit);
    $('sortUnit').textContent = sortByUnit ? '↩ חזרה לסדר שהוספתם' : '↕ מיון לפי מחיר ליחידה';
    await render();
  });
  const clubBtnText = () => { $('clubToggle').textContent = noClub ? '🎫 מבצעי מועדון מוסתרים' : '🎫 הסתרת מבצעי מועדון'; $('clubToggle').classList.toggle('sel', noClub); };
  clubBtnText();
  $('clubToggle').addEventListener('click', async () => {
    noClub = !noClub;
    localStorage.setItem('zulik-noclub', noClub ? '1' : '0');
    clubBtnText();
    await render();
  });
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
  // מוצר בלי תמונה בשום מאגר - אימוג'י קטגוריה לפי השם, שלא יישאר ריבוע ריק
  const CAT_EMOJI = [
    [/חלב|משקה שקד|משקה סויה|שמנת/, '🥛'], [/גבינ|קוטג|מוצרלה|פרמזן|בולגרית|צפתית/, '🧀'], [/יוגורט|מעדן|פודינג/, '🍮'],
    [/לחם|פיתה|פיתות|לחמני|בגט|טוסט|חלה/, '🍞'], [/ביצים|ביצי חופש/, '🥚'], [/שמן זית|שמן קנולה|שמן חמניות|שמן/, '🫒'],
    [/קפה|נס |אספרסו/, '☕'], [/\bתה\b|חליטה/, '🍵'], [/שוקולד|פרלין|נוטלה/, '🍫'], [/עוגי|ביסקוויט|וופל|פתי בר/, '🍪'],
    [/עוגה|בראוני|מאפין|טורט/, '🍰'], [/במבה|ביסלי|חטיף|צ'יפס|תפוצ|פופקורן|בייגלה/, '🥨'],
    [/קולה|ספרייט|פאנטה|משקה מוגז|סודה|מיץ|תרכיז|אנרגיה|XL|לימונדה/, '🥤'], [/מים מינרל|מי עדן|נביעות/, '💧'],
    [/יין |תירוש/, '🍷'], [/בירה|וודקה|ויסקי|ערק|ליקר/, '🍺'], [/בשר|בקר|טחון|אנטריקוט|צלעות|כבש/, '🥩'],
    [/עוף|הודו|שניצל|פרגית|כנפיים/, '🍗'], [/\bדג\b|דגים|טונה|סלמון|סרדינ|הרינג|אמנון|בקלה/, '🐟'],
    [/אורז/, '🍚'], [/פסטה|ספגטי|אטריות|נודלס|פתיתים|קוסקוס/, '🍝'], [/קמח|שמרים/, '🌾'], [/סוכר|ממתיק/, '🍬'],
    [/גלידה|שלגון|ארטיק|קרטיב/, '🍨'], [/דבש|ריבה|ממרח|חמאת בוטנים|סילאן/, '🍯'],
    [/קטשופ|מיונז|חרדל|רוטב|סויה|טריאקי/, '🥫'], [/שימורי|תירס|זיתים|מלפפון חמוץ|אפונה|חומוס גרגר/, '🥫'],
    [/נייר טואלט|מגבונ|טיטול|חיתול|נייר סופג|ממחט/, '🧻'], [/סבון|שמפו|מרכך שיער|דאודורנט|משחת שיניים|ג'ל רחצה|תחליב/, '🧴'],
    [/אקונומיק|כביסה|מרכך כביסה|ניקוי|נוזל כלים|מטהר|אבקת/, '🧽'], [/קורנפלקס|דגני|גרנולה|שיבולת/, '🥣'],
    [/חומוס|טחינה|סלט |מטבוחה|חציל במיונז/, '🥗'], [/נקניק|פסטרמה|סלמי|קבנוס/, '🥓'],
    [/פיצה|בורקס|ג'חנון|מלאווח|בצק/, '🥟'], [/מלח|פלפל שחור|פפריקה|כמון|תבלין|אבקת מרק/, '🧂'],
    [/אגוז|שקד|קשיו|בוטנ|פיצוח|גרעינ/, '🥜'], [/תמר|צימוק|מיובש|משמש/, '🍇'], [/קפוא/, '🧊'], [/ויטמין|תוסף/, '💊'],
  ];
  const emojiFor = (n) => { for (const [re, e] of CAT_EMOJI) if (re.test(n || '')) return e; return '🛒'; };
  const nameOf = (code) => nameMap[code] || (byCode.has(code) ? byCode.get(code).n : '');
  const setThumbEmoji = (t, code) => { t.style.backgroundImage = ''; t.textContent = emojiFor(nameOf(code)); };
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
  // מפת התמונות שנבנית בלילה בשרת (data/img/<NN>.json): 'r'=רמי לוי, URL=Open Facts, 0=אין
  const imgShardCache = {};
  async function imgMapLookup(code) {
    const sh = code.slice(-2).padStart(2, '0');
    if (!(sh in imgShardCache)) {
      imgShardCache[sh] = fetch(`data/img/${sh}.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
    }
    const m = await imgShardCache[sh];
    return code in m ? m[code] : undefined;
  }
  async function fetchImgInner(code) {
    const rl = `https://img.rami-levy.co.il/product/${code}/small.jpg`;
    const mapped = await imgMapLookup(code);
    if (mapped !== undefined) {
      const url = mapped === 0 ? 0 : mapped === 'r' ? rl : mapped;
      imgCache[code] = url;
      localStorage.setItem('zulik-img-v2', JSON.stringify(imgCache));
      return url;
    }
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
      else if (c === 0 || !/^\d{8,13}$/.test(code)) setThumbEmoji(t, code); // ידוע שאין תמונה - אימוג'י מיד
    }
    const codes = [...new Set(thumbs.map((t) => t.dataset.code))]
      .filter((c) => !c.startsWith('v-') && /^\d{8,13}$/.test(c) && !(c in imgCache))
      .slice(0, 24);
    await Promise.all(codes.map(async (code) => {
      const url = await fetchImg(code);
      for (const cur of document.querySelectorAll(`.thumb[data-code="${code}"]`)) {
        if (url) { cur.style.backgroundImage = `url("${url}")`; cur.textContent = ''; }
        else setThumbEmoji(cur, code);
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
      // התווית של נקודות הקצה נחתכה בשולי ה-SVG - מהדקים אותה פנימה
      const lx = Math.min(Math.max(parseFloat(x), 26), W - 26).toFixed(1);
      return `<text x="${lx}" y="${H - 2}" text-anchor="middle" font-size="8.5" fill="var(--text-3)">${fmtDT(d)}</text>`;
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
    $('basketCard').classList.toggle('narrowcols', narrow); // תגי מחיר מהודקים שלא ייחתכו ב-64px
    $('thead').innerHTML = `<div class="pname">מוצר</div>` + cols.map((c) => `<div>${c.head}</div>`).join('') + '<div></div>';

    const dists = [...new Set(cols.map((c) => c.dist))];
    const recsByDist = {};
    for (const dist of dists) {
      recsByDist[dist] = await Promise.all(basket.map((code) => loadProductIn(dist, code)));
    }
    const rows = []; // {html, key} - key = מחיר-ליחידה מינימלי, למיון "הזול ליחידה"
    const totals = cols.map(() => 0);
    let comparable = 0;
    const KIND_ORDER = { g: 0, ml: 1e4, unit: 2e4, m: 3e4 }; // אין השוואה בין גרם למ"ל - קבוצות נפרדות במיון

    basket.forEach((code, bi) => {
      const colRecs = cols.map((c) => recsByDist[c.dist][bi]);
      const anyRec = colRecs.find(Boolean);
      if (anyRec) nameMap[code] = anyRec.name;
      else if (byCode.has(code)) nameMap[code] = byCode.get(code).n;
      if (!anyRec) {
        // המוצר לא נמכר בסניפים/אזור הנוכחיים - שומרים את השם, והקליק פותח קארד שמראה איפה כן
        const nm = nameMap[code] || 'מוצר מהסל';
        rows.push({ key: Infinity, html: `<div class="rowwrap"><div class="row" data-code="${code}">
          <div class="pname"><span class="thumb" data-code="${code}"></span><span class="ptxt">${nm}</span> <span class="notherepill" data-tip="לא נמכר כאן - לחצו לראות איפה כן">לא נמכר כאן</span></div>
          <div class="prices-m"></div><button class="rmv" data-rm="${code}" aria-label="הסרה">✕</button></div></div>` });
        return;
      }
      const prices = cols.map((c, i) => {
        const rec = colRecs[i];
        return rec && rec.prices[c.chain] ? rec.prices[c.chain].p : null;
      });
      const have = prices.filter((p) => p !== null);
      const full = have.length === cols.length;
      const q = qtyOf(code);
      // מחיר אפקטיבי לעמודה: כשהכמות מזכה במבצע (q>=MinQty) היחידות שנכנסות בו במחיר
      // מבצע והשאר במחיר מדף - מה שהקונה משלם בפועל; זה מה שנספר גם בשורת הסה"כ
      const effs = cols.map((c, i) => {
        const p = prices[i];
        if (p === null) return null;
        const pr = colRecs[i] && colRecs[i].prices[c.chain] && colRecs[i].prices[c.chain].pr;
        if (!pr || (noClub && pr.c) || !(pr.p < p)) return p * q;
        const m = Math.max(1, pr.m || 1);
        if (q < m) return p * q;
        const inPromo = Math.floor(q / m) * m;
        return inPromo * pr.p + (q - inPromo) * p;
      });
      if (full) { comparable++; effs.forEach((t, i) => { totals[i] += t; }); }
      const bestEff = Math.min(...effs.filter((t) => t !== null));
      const best = Math.min(...have);
      const bestUp = unitPrice(best, anyRec.u);
      const cells = cols.map((c, i) => {
        const p = prices[i];
        if (p === null) return `<div class="price missing" data-chain="${c.label}">—</div>`;
        const eff = effs[i];
        const promoApplied = eff < p * q - 0.005;
        const isBest = eff === bestEff && have.length > 1;
        const h = colRecs[i] && colRecs[i].history[c.chain];
        const chg = h && h.length >= 2 ? (h[h.length - 1][1] > h[h.length - 2][1] ? 'cup' : 'cdown') : null;
        const chgDate = chg ? h[h.length - 1][0] : null;
        const chgTip = chg ? `${chg === 'cup' ? 'התייקר' : 'הוזל'} מ-${fmt(h[h.length - 2][1])} ב-${fmtD(chgDate)}${chgDate === meta.updated && upTime ? ' בשעה ' + upTime : ''}` : '';
        const arrow = chg ? `<i class="chg ${chg}" data-tip="${chgTip}">${chg === 'cup' ? '▲' : '▼'}</i>` : '';
        const up = unitPrice(p, colRecs[i] && colRecs[i].u);
        const uline = up ? `<small class="unitp"><bdi>${fmtUShort(up)}</bdi></small>` : '';
        const pr = colRecs[i] && colRecs[i].prices[c.chain] && colRecs[i].prices[c.chain].pr;
        // מבצע שחל (הכמות מספיקה): המחיר הראשי הוא המבצע והשורה הקטנה מראה כמה נחסך;
        // מבצע שעוד לא חל: המחיר הראשי מדף והשורה הקטנה מציגה את מחיר המבצע (טולטיפ עם התנאים)
        const prLine = pr && !(noClub && pr.c)
          ? `<small class="promop" data-tip="${promoTip(pr)}">🏷 ${promoApplied ? `במקום ${fmt(p * q)}` : fmt(pr.p * q)}${pr.c ? '🎫' : ''}</small>` : '';
        // כל תא באותו מבנה בדיוק (pval תמיד) - גבהים אחידים, והתג הכחול לא גולש על השורות שמתחת
        return `<div class="price ${isBest ? 'best' : ''}" data-chain="${c.label}"><span class="pval${promoApplied ? ' pvpromo' : ''}">${fmt(eff)}${arrow}</span>${prLine}${uline}</div>`;
      }).join('');
      const pkg = fmtPkg(anyRec.u);
      rows.push({
        key: bestUp ? KIND_ORDER[bestUp.k] + bestUp.v : Infinity,
        html: `<div class="rowwrap"><div class="row" data-code="${code}">
        <div class="pname"><span class="thumb" data-code="${code}"></span><span class="ptxt">${anyRec.name}</span>${pkg ? `<span class="pkg">${pkg}</span>` : ''}${flagHtml(anyRec.mc)}${full ? '' : '<span class="staremark" data-tip="לא נמכר בכל הרשתות שבהשוואה - לכן לא נכלל בשורת הסה־כ">*</span>'}</div>
        <div class="prices-m">${cells}</div>
        <span class="rowtools"><span class="qtybox"><button class="qbtn" data-qdown="${code}">−</button><input class="qinp ${q !== 1 ? 'qon' : ''}" data-qin="${code}" value="${fmtQ(q)}" type="text" inputmode="${byWeight(code) ? 'decimal' : 'numeric'}" aria-label="${byWeight(code) ? 'משקל בק&quot;ג' : 'כמות'}"><button class="qbtn" data-qup="${code}">+</button></span><button class="rmv" data-rm="${code}" aria-label="הסרה">✕</button></span>
      </div></div>` });
    });

    if (sortByUnit) rows.sort((a, b) => a.key - b.key);
    $('rows').innerHTML = rows.map((r) => r.html).join('');
    $('tablewrap').scrollLeft = 0; // RTL: מתחילים תמיד מעמודת המוצר, לא מהקצה השמאלי
    $('empty').hidden = basket.length > 0;

    const totalsEl = $('totals');
    const metricsEl = $('metrics');
    if (comparable > 0) {
      const bestT = Math.min(...totals);
      const worstT = Math.max(...totals);
      totalsEl.innerHTML = `<div class="pname">סה"כ (${comparable} מוצרים ${useFav() ? 'בכל הסניפים' : 'בכל הרשתות'})</div>
        <div class="prices-m">${cols.map((c, i) => `<div class="price ${totals[i] === bestT ? 'best' : ''}" data-chain="${c.label}"><span class="pval">${fmt(totals[i])}</span></div>`).join('')}</div><div></div>`;
      totalsEl.hidden = false;
      const bestCol = cols[totals.indexOf(bestT)];
      const pct = worstT > 0 ? Math.round(((worstT - bestT) / worstT) * 100) : 0;
      metricsEl.innerHTML = `
        <div class="metric"><p class="k">${useFav() ? 'הסניף הזול מביניהם' : 'הסל הזול ב' + dMeta().he}</p><p class="v">${bestCol.label}</p></div>
        <div class="metric"><p class="k">חיסכון מול היקר</p><p class="v">${fmt(worstT - bestT)} <small>${pct}%-</small></p></div>
        <div class="metric"><p class="k">מוצרים בסל</p><p class="v">${basket.length}${(() => { const u = basket.reduce((n, c) => n + qtyOf(c), 0); return u > basket.length ? ` <small>· ${fmtQ(u)} יח'</small>` : ''; })()}</p></div>`;
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
    // הקארד נפתח מיד עם "טוען" - 7 בקשות המחוזות רצות במקביל (היו עוקבות והקארד "לא הופיע")
    $('pcBody').innerHTML = `<div class="pchead"><span class="pcimgwrap"><span class="pcimg thumb"></span></span><div><h3>${name || 'טוען…'}</h3><p class="pcmeta">טוען מחירים…</p></div></div>`;
    $('pcard').hidden = false;
    document.body.style.overflow = 'hidden';
    // זמינות בכל הארץ: רשת → אזורים שבהם היא מוכרת את המוצר
    const avail = {};
    const recByDist = {};
    const recs = await Promise.all(meta.districts.map((dm) => loadProductIn(dm.id, code)));
    meta.districts.forEach((dm, i) => {
      const rec = recs[i];
      if (!rec) return;
      recByDist[dm.id] = rec;
      if (!name) name = rec.name;
      if (rec.name) nameMap[code] = rec.name;
      for (const [ch, pr] of Object.entries(rec.prices)) (avail[ch] = avail[ch] || []).push({ he: dm.he, p: pr.p });
    });
    const colRecs = cols.map((c) => recByDist[c.dist]);
    const prices = cols.map((c, i) => (colRecs[i] && colRecs[i].prices[c.chain] ? colRecs[i].prices[c.chain].p : null));
    const have = prices.filter((p) => p !== null);
    const best = have.length ? Math.min(...have) : null;
    // רשימה מאוחדת: מחיר + היסטוריה בשורה אחת לכל רשת, ממוינת מהזול ליקר
    const histOf = (i, chain) => (colRecs[i] && colRecs[i].history[chain]) || null;
    const tOf = (i, chain) => (colRecs[i] && colRecs[i].prices[chain] && colRecs[i].prices[chain].t) || null;
    const entries = cols.map((c, i) => ({ label: c.label, p: prices[i], h: histOf(i, c.chain), t: tOf(i, c.chain), pr: (colRecs[i] && colRecs[i].prices[c.chain] && colRecs[i].prices[c.chain].pr) || null }));
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
    // t = PriceUpdateTime של הרשת עצמה - "בתוקף מאז" מדויק גם כשההיסטוריה שלנו צעירה
    const histLine = (h, t) => {
      if (!h || !h.length) return t ? `<span class="phist stabletxt">בתוקף מאז ${fmtD(t)}</span>` : '';
      const first = h[0], last = h[h.length - 1];
      // "יציב" רק כשכל הנקודות שוות - מחיר שירד וחזר (ראשון=אחרון) הוא לא יציב
      const stable = h.every((x) => x[1] === first[1]);
      if (stable) {
        const since = t && t < first[0] ? t : first[0];
        if (h.length === 1 && first[0] >= meta.updated && !t) return '';
        return `<span class="phist stabletxt">${t && t < first[0] ? 'בתוקף' : 'יציב'} מאז ${fmtD(since)}</span>`;
      }
      // התג משקף את השינוי האחרון (לא ראשון-מול-אחרון); הגרף מראה את כל המסלול
      const prev = h[h.length - 2];
      const up = last[1] > prev[1];
      const pct = prev[1] ? Math.round((Math.abs(last[1] - prev[1]) / prev[1]) * 100) : 0;
      return `<div class="phist">${spark(h, up, true)}<span class="hbadge ${up ? 'hup' : 'hdown'}">${up ? '▲ התייקר' : '▼ הוזל'} ${pct}% · מ־${fmt(prev[1])}</span></div>`;
    };
    const cardRec = recByDist[district] || colRecs.find(Boolean) || Object.values(recByDist)[0];
    const cardU = cardRec && cardRec.u;
    const priceRows = entries.map((e) => {
      const priceHtml = e.p !== null
        ? (e.p === best && have.length > 1 ? `<span class="bestpill">${fmt(e.p)}</span>` : fmt(e.p))
        : (e.lastP != null ? `<span class="ghostprice" data-tip="הרשת לא בהשוואה היום - מחיר אחרון ידוע">${fmt(e.lastP)}*</span>` : '—');
      const up = unitPrice(e.p != null ? e.p : e.lastP, cardU);
      const promoRow = e.pr && !(noClub && e.pr.c)
        ? `<div class="pcpromo"><span class="promobadge">🏷 במבצע: ${fmt(e.pr.p)}</span> ${esc(e.pr.d)}${e.pr.m ? ` · בקניית ${e.pr.m} יח'` : ''} · עד ${fmtD(e.pr.e)}${e.pr.c ? ' · 🎫 חברי מועדון' : ''}</div>`
        : '';
      // מחיר ומחיר-ליחידה בעמודה נפרדת אחד מעל השני, עם bdi - בלי ערבוב bidi של המספרים
      return `<div class="pcprice"><span class="pclabel">${e.label}</span><span class="pcval"><b>${priceHtml}</b>${up ? `<small class="unitp pcunitp"><bdi>${fmtU(up)}</bdi></small>` : ''}</span>${histLine(e.h, e.t)}${promoRow}</div>`;
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
        <div><h3>${name || 'מוצר'}</h3>${(() => {
          // שורת מטא: גודל אריזה · מחיר ליחידה (מהזול) · מותג · ארץ ייצור
          const bits = [];
          const pkg = fmtPkg(cardU);
          if (pkg) bits.push(pkg);
          if (best != null) { const up = unitPrice(best, cardU); if (up) bits.push(`<bdi>${fmtU(up)}</bdi>`); }
          if (cardRec && cardRec.mf) bits.push(cardRec.mf);
          if (cardRec && cardRec.mc && flagImg(cardRec.mc)) bits.push(`${flagImg(cardRec.mc)} ${COUNTRY_NAME[cardRec.mc] || cardRec.mc}`);
          const meta1 = bits.length ? `<p class="pcmeta">${bits.join(' · ')}</p>` : '';
          // שרינקפלציה: האריזה התכווצה (qh = היסטוריית כמויות מה-build)
          let shrink = '';
          if (cardRec && cardRec.qh && cardRec.qh.length >= 2) {
            const q0 = cardRec.qh[cardRec.qh.length - 2][1], q1 = cardRec.qh[cardRec.qh.length - 1][1];
            if (q1 < q0) shrink = `<span class="hbadge hup" style="display:inline-block;margin-top:4px">📉 האריזה התכווצה: ${q0} ← ${q1} ${UNIT_HE[cardU ? cardU[1] : 'g'] || ''} (${fmtD(cardRec.qh[cardRec.qh.length - 1][0])})</span>`;
          }
          return meta1 + shrink;
        })()}${window.__pcTopChg}</div>
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
      else if (t) { t.style.backgroundImage = ''; t.textContent = emojiFor(name || nameOf(code)); }
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

  // הקלדת כמות/משקל ישירות בשדה: שקיל - עשרוני 0.1-10 ק"ג; יחידות - שלם 1-10
  $('rows').addEventListener('change', async (ev) => {
    const inp = ev.target.closest('.qinp');
    if (!inp) return;
    const code = inp.dataset.qin;
    let v = parseFloat(String(inp.value).replace(',', '.'));
    if (!isFinite(v)) v = 1;
    v = byWeight(code)
      ? Math.round(Math.min(QTY_MAX, Math.max(0.1, v)) * 100) / 100
      : Math.min(QTY_MAX, Math.max(1, Math.round(v)));
    qty[code] = v;
    saveQty();
    await render();
  });
  $('rows').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && ev.target.closest('.qinp')) { ev.preventDefault(); ev.target.blur(); }
  });
  $('rows').addEventListener('click', async (ev) => {
    const qup = ev.target.closest('[data-qup]');
    const qdown = ev.target.closest('[data-qdown]');
    if (ev.target.closest('.qinp')) return; // קליק בשדה הכמות לא פותח את כרטיס המוצר
    if (qup || qdown) {
      const code = qup ? qup.dataset.qup : qdown.dataset.qdown;
      const st = qtyStep(code);
      // עיגול לשתי ספרות - משקל מוקלד כמו 1.37 לא נמחק בלחיצת +/-
      qty[code] = Math.round(Math.min(QTY_MAX, Math.max(st, qtyOf(code) + (qup ? st : -st))) * 100) / 100;
      saveQty();
      await render();
      return;
    }
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

  // ---------- מכווצים לכם את האריזה (shrink.json נצבר ב-build לאורך זמן) ----------
  fetch('data/shrink.json').then((r) => (r.ok ? r.json() : [])).catch(() => []).then((list) => {
    if (!Array.isArray(list) || !list.length) return;
    $('shrinkCard').hidden = false;
    $('shrinkList').innerHTML = list.slice(0, 12).map((e) => {
      const pct = e.q0 ? Math.round((1 - e.q1 / e.q0) * 100) : 0;
      return `<button class="shrinkrow" data-code="${e.c}"><span class="thumb" data-code="${e.c}"></span><span class="shrinktxt"><b>${e.n}</b><small>${e.q0} ← ${e.q1} ${UNIT_HE[e.k] || ''} · פחות ${pct}% באריזה · ${fmtD(e.d)}</small></span></button>`;
    }).join('');
    hydrateImages();
  });
  $('shrinkList').addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-code]');
    if (b) await openProductCard(b.dataset.code);
  });

  // ---------- הרשימה שלי: פאנל צף (למחוברים), סנכרון ענן ושיתוף בוואטסאפ ----------
  const listWrap = document.createElement('div');
  listWrap.innerHTML = `
    <button id="listFab" class="listfab" hidden aria-label="הרשימה שלי">🛒</button>
    <div id="listPanel" class="listpanel" hidden role="dialog" aria-label="הרשימה שלי">
      <div class="lphead"><b>🛒 הרשימה שלי</b><small>מסתנכרנת אוטומטית לחשבון שלך</small><button id="lpClose" aria-label="סגירה">✕</button></div>
      <div id="lpItems" class="lpitems"></div>
      <div class="lpbtns">
        <button id="lpWa" class="lpbtn lpwa">שיתוף בוואטסאפ</button>
        <button id="lpShare" class="lpbtn">📤 שיתוף…</button>
        <button id="lpCopy" class="lpbtn">🔗 העתקת קישור</button>
      </div>
      <p class="lpnote">מי שמקבל את הקישור מתבקש להתחבר או להירשם (חינם) כדי לצפות ברשימה.</p>
    </div>`;
  document.body.appendChild(listWrap);
  // ---------- פרטים אישיים + מחיקת חשבון ----------
  const accModal = document.createElement('div');
  accModal.className = 'pcard';
  accModal.hidden = true;
  accModal.innerHTML = `<div class="pcbox accbox" role="dialog" aria-modal="true"><button class="pcclose" id="accClose" aria-label="סגירה">✕</button><div id="accBody"></div></div>`;
  document.body.appendChild(accModal);
  accModal.querySelector('#accClose').addEventListener('click', () => { accModal.hidden = true; });
  accModal.addEventListener('click', (ev) => { if (ev.target === accModal) accModal.hidden = true; });
  async function openAccountModal() {
    accModal.hidden = false;
    const body = accModal.querySelector('#accBody');
    body.innerHTML = '<p class="empty">טוען…</p>';
    const a = await fetch('/api/account').then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!a) { body.innerHTML = '<p class="empty">לא הצלחנו לטעון את הפרטים - נסו שוב.</p>'; return; }
    const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('he-IL') : '—');
    body.innerHTML = `
      <h3 class="acctitle">👤 פרטים אישיים</h3>
      <div class="acchead">${a.picture ? `<img src="${a.picture}" alt="">` : ''}<div><b>${a.name}</b><small>${a.email}</small></div></div>
      <div class="accrows">
        <div class="accrow"><span>סוג התחברות</span><b>${a.prov}</b></div>
        <div class="accrow"><span>חבר מאז</span><b>${fmtDate(a.created)}</b></div>
        <div class="accrow"><span>כניסה אחרונה</span><b>${fmtDate(a.lastLogin)}</b></div>
        <div class="accrow"><span>מספר התחברויות</span><b>${a.logins}</b></div>
        <div class="accrow"><span>מוצרים ברשימה המסונכרנת</span><b>${a.listCount}</b></div>
        ${a.admin ? '<div class="accrow"><span>הרשאה</span><b>🛠 מנהל</b></div>' : ''}
      </div>
      <button class="accdel" id="accDelBtn">מחיקת החשבון</button>
      <p class="lpnote">מחיקת החשבון מוחקת לצמיתות את הפרטים והרשימה המסונכרנת מהשרתים שלנו. הסל בדפדפן הזה נשאר.</p>`;
    const del = body.querySelector('#accDelBtn');
    del.addEventListener('click', async () => {
      if (!del.dataset.arm) {
        del.dataset.arm = '1';
        del.textContent = 'בטוחים? לחיצה נוספת תמחק לצמיתות';
        del.classList.add('armed');
        setTimeout(() => { if (del.isConnected) { delete del.dataset.arm; del.textContent = 'מחיקת החשבון'; del.classList.remove('armed'); } }, 6000);
        return;
      }
      del.disabled = true;
      const r = await fetch('/api/account/delete', { method: 'POST' }).catch(() => null);
      if (!r || !r.ok) { del.disabled = false; showToast('המחיקה נכשלה - נסו שוב.'); return; }
      accModal.hidden = true;
      me = null;
      renderAuthUI();
      const fab = $('listFab');
      if (fab) { fab.hidden = true; $('listPanel').hidden = true; }
      showToast('החשבון נמחק לצמיתות. תודה שהייתם איתנו 🙏');
    });
  }
  const itemName = (c) => (byCode.get(c) || {}).n || nameMap[c] || 'מוצר';
  function renderListPanel() {
    $('lpItems').innerHTML = basket.length
      ? basket.map((c) => `<div class="lpitem"><span>${itemName(c)}</span><b>${fmtQ(qtyOf(c))}${byWeight(c) ? ' ק"ג' : ''}</b></div>`).join('')
      : '<p class="empty">הסל ריק - הוסיפו מוצרים מהחיפוש.</p>';
  }
  function openListPanel() {
    renderListPanel();
    $('listPanel').hidden = false;
  }
  $('listFab').addEventListener('click', openListPanel);
  $('lpClose').addEventListener('click', () => { $('listPanel').hidden = true; });
  let shareCache = null; // {sig, url} - לא יוצרים קישור חדש אם הרשימה לא השתנתה
  async function shareUrl() {
    const items = basket.map((c) => ({ c, q: qtyOf(c) }));
    const sig = JSON.stringify(items);
    if (shareCache && shareCache.sig === sig) return shareCache.url;
    const r = await fetch('/api/list/share', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.id) { showToast(j.error === 'empty' ? 'הסל ריק - אין מה לשתף.' : 'השיתוף נכשל - נסו שוב.'); return null; }
    shareCache = { sig, url: location.origin + '/?l=' + j.id };
    return shareCache.url;
  }
  const shareText = (url) => `🛒 ${me ? me.name : ''} שיתף איתך רשימת קניות בסַלְזוֹל - השוואת מחירים בין הרשתות:\n${url}`;
  $('lpWa').addEventListener('click', async () => { const u = await shareUrl(); if (u) window.open('https://wa.me/?text=' + encodeURIComponent(shareText(u)), '_blank'); });
  $('lpShare').addEventListener('click', async () => {
    const u = await shareUrl();
    if (!u) return;
    if (navigator.share) navigator.share({ title: 'רשימת קניות - סַלְזוֹל', text: shareText(u) }).catch(() => {});
    else { navigator.clipboard.writeText(u); showToast('הקישור הועתק 🔗'); }
  });
  $('lpCopy').addEventListener('click', async () => { const u = await shareUrl(); if (u) { await navigator.clipboard.writeText(u); showToast('הקישור הועתק 🔗'); } });

  async function importShared(j) {
    let added = 0;
    for (const it of j.items) {
      if (!basket.includes(it.c)) {
        if (basket.length >= LIMITS().basket) break;
        basket.push(it.c);
        added++;
      }
      if (it.q && it.q !== 1) qty[it.c] = it.q;
    }
    saveBasket();
    saveQty();
    history.replaceState(null, '', location.pathname);
    showToast(`🛒 הרשימה של <b>${j.from}</b> נטענה (${j.items.length} מוצרים${added < j.items.length ? `, ${added} חדשים` : ''}).`);
  }
  async function tryLoadShared(id) {
    const r = await fetch('/api/shared/' + id);
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && j.from) {
      // אורח: מסך הרשמה עם הקשר - "X שיתף איתך רשימה"
      window.__pendingShare = id;
      authModal.hidden = false;
      authView('register');
      const note = document.createElement('p');
      note.className = 'sharednote';
      note.innerHTML = `🛒 <b>${j.from}</b> שיתף איתך רשימת קניות - הירשמו או התחברו (חינם) כדי לצפות בה`;
      $('authViews').prepend(note);
      return false;
    }
    if (r.ok && Array.isArray(j.items)) { await importShared(j); return true; }
    if (r.status === 404) showToast('הקישור פג תוקף או שהרשימה נמחקה.');
    return false;
  }

  // ---------- סרגל נגישות (זמין לכולם, נשמר בין ביקורים) ----------
  const A11Y = [
    ['font1', 'הגדלת טקסט'], ['font2', 'טקסט גדול מאוד'], ['contrast', 'ניגודיות גבוהה'],
    ['invert', 'ניגודיות הפוכה'], ['gray', 'גווני אפור'], ['links', 'הדגשת קישורים'],
    ['readable', 'גופן קריא'], ['cursor', 'סמן גדול'], ['noanim', 'עצירת אנימציות'],
  ];
  let a11yOn = [];
  try { a11yOn = JSON.parse(localStorage.getItem('zulik-a11y')) || []; } catch {}
  const applyA11y = () => {
    for (const [k] of A11Y) document.documentElement.classList.toggle('a11y-' + k, a11yOn.includes(k));
    localStorage.setItem('zulik-a11y', JSON.stringify(a11yOn));
  };
  applyA11y();
  const a11yWrap = document.createElement('div');
  a11yWrap.innerHTML = `
    <button id="a11yFab" class="a11yfab" aria-label="תפריט נגישות" title="נגישות">♿</button>
    <div id="a11yPanel" class="a11ypanel" hidden role="dialog" aria-label="הגדרות נגישות">
      <div class="lphead"><b>♿ נגישות</b><button id="a11yClose" aria-label="סגירה">✕</button></div>
      <div class="a11ybtns">${A11Y.map(([k, he]) => `<button class="a11yopt" data-a11y="${k}" aria-pressed="false">${he}</button>`).join('')}</div>
      <button class="a11yreset" id="a11yReset">איפוס הגדרות נגישות</button>
      <p class="lpnote"><a href="pages/accessibility.html">הצהרת הנגישות המלאה</a> · נתקלתם בבעיה? contact@salzol.com</p>
    </div>`;
  document.body.appendChild(a11yWrap);
  const syncA11yBtns = () => {
    a11yWrap.querySelectorAll('.a11yopt').forEach((b) => {
      const on = a11yOn.includes(b.dataset.a11y);
      b.classList.toggle('sel', on);
      b.setAttribute('aria-pressed', on);
    });
  };
  $('a11yFab').addEventListener('click', () => { $('a11yPanel').hidden = !$('a11yPanel').hidden; syncA11yBtns(); });
  $('a11yClose').addEventListener('click', () => { $('a11yPanel').hidden = true; });
  a11yWrap.addEventListener('click', (ev) => {
    const b = ev.target.closest('.a11yopt');
    if (b) {
      const k = b.dataset.a11y;
      a11yOn = a11yOn.includes(k) ? a11yOn.filter((x) => x !== k) : [...a11yOn, k];
      if (k === 'font1') a11yOn = a11yOn.filter((x) => x !== 'font2' || k === 'font2');
      if (k === 'font2') a11yOn = a11yOn.filter((x) => x !== 'font1');
      if (k === 'contrast') a11yOn = a11yOn.filter((x) => x !== 'invert');
      if (k === 'invert') a11yOn = a11yOn.filter((x) => x !== 'contrast');
      applyA11y();
      syncA11yBtns();
    }
    if (ev.target.id === 'a11yReset') { a11yOn = []; applyA11y(); syncA11yBtns(); }
  });

  renderAuthUI();
  $('listFab').hidden = !me;
  // מחובר: אימוץ רשימת הענן כשאין סל מקומי; אחרת דחיפת המקומי לענן
  if (me) {
    try {
      const j = await fetch('/api/list').then((r) => (r.ok ? r.json() : null));
      const cloud = j && j.list && Array.isArray(j.list.items) ? j.list.items : [];
      if (cloud.length && !localStorage.getItem('zulik-basket')) {
        basket = cloud.map((it) => it.c).slice(0, LIMITS().basket);
        for (const it of cloud) if (it.q && it.q !== 1) qty[it.c] = it.q;
        localStorage.setItem('zulik-basket', JSON.stringify(basket));
        localStorage.setItem('zulik-qty', JSON.stringify(qty));
      } else if (basket.length) syncListSoon();
    } catch {}
  }
  await loadDistrict();
  renderDistrictUI();
  renderSampleChips();
  $('favPanel').hidden = mode !== 'fav';
  if (mode === 'fav') renderFavPanel();
  await render();
  // קישור רשימה משותפת (?l=<id>) - אחרי שהכל נטען
  const sharedId = new URLSearchParams(location.search).get('l');
  if (sharedId) {
    const ok = await tryLoadShared(sharedId);
    if (ok) await render();
  }
})();
