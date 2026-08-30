// הדר אחיד לדפי המשנה ולפאנל הניהול: תג "עדכון אחרון" + התחברות/המבורגר -
// אותו הדר כמו בעמוד הראשי, בכל דף. ROOT נגזר מהמיקום (pages/ יושב עמוק ברמה אחת).
(async function () {
  const ROOT = location.pathname.includes('/pages/') ? '../' : './';
  const $ = (id) => document.getElementById(id);

  // תג עדכון אחרון - זהה לעמוד הראשי
  try {
    const m = await fetch(ROOT + 'data/meta.json').then((r) => r.json());
    const [y, mo, d] = m.updated.split('-');
    const t = m.updatedAt ? new Date(m.updatedAt).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }) : '';
    const el = $('updatedBadge');
    if (el) el.textContent = `עדכון אחרון ${d}.${mo}.${y}${t ? ' ' + t : ''}`;
  } catch {}

  // התחברות/המבורגר - כמו בראשי; כפתור התחברות מפנה לעמוד הראשי שפותח את המודל
  const box = $('authBox');
  if (!box) return;
  let me = null;
  try { me = (await fetch('/api/me').then((r) => (r.ok ? r.json() : null)) || {}).user; } catch {}
  if (me) {
    box.innerHTML = `<button class="hamb" id="menuBtn" aria-label="תפריט">☰</button>
      <div class="menupop" id="menuPop" hidden>
        <div class="menuhead">${me.picture ? `<img src="${me.picture}" alt="">` : ''}<div><b>${me.name}</b><small>${me.email}</small></div></div>
        <a class="menuitem" href="${ROOT}">🏠 חזרה לסלזול</a>
        ${me.admin ? `<a class="menuitem" href="${ROOT}admin.html">🛠 פאנל ניהול</a>` : ''}
        <a class="menuitem" href="${ROOT}pages/contact.html">📨 צור קשר</a>
        <a class="menuitem" href="${ROOT}pages/terms.html">📄 תקנון שימוש</a>
        <a class="menuitem" href="${ROOT}pages/accessibility.html">♿ הצהרת נגישות</a>
        <a class="menuitem" href="${ROOT}pages/privacy.html">🔒 מדיניות פרטיות</a>
        <button class="menuitem" id="logoutBtn">התנתקות</button>
      </div>`;
    const pop = $('menuPop');
    $('menuBtn').addEventListener('click', (ev) => { ev.stopPropagation(); pop.hidden = !pop.hidden; });
    document.addEventListener('click', (ev) => { if (!pop.hidden && !ev.target.closest('#authBox')) pop.hidden = true; });
    $('logoutBtn').addEventListener('click', async () => { await fetch('/api/logout', { method: 'POST' }); location.href = ROOT; });
  } else {
    box.innerHTML = '<button class="loginbtn" id="loginOpen">התחברות</button>';
    $('loginOpen').addEventListener('click', () => { location.href = ROOT + '?login=1'; });
  }
})();
