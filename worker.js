// סַלְזוֹל Worker: מגיש את האתר הסטטי + API התחברות עם Google.
// זרימה: הדפדפן מקבל ID-token מכפתור Google (GIS) → POST /api/login → אימות מול גוגל
// (tokeninfo, בדיקת aud) → upsert המשתמש ב-KV → עוגיית סשן חתומה HMAC (90 יום).
// אדמין (ADMIN_EMAIL) מקבל את רשימת המשתמשים ב-/api/admin/users עבור פאנל הניהול.
// סודות: SESSION_SECRET (wrangler secret). משתנים: GOOGLE_CLIENT_ID, ADMIN_EMAIL.

const COOKIE = 'sz_s';
const SESSION_DAYS = 90;

const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
// פענוח כ-UTF-8 אמיתי - atob לבדו מפרש בייטים כ-latin1 והורס שמות בעברית
const b64urlToStr = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
}

async function makeSession(env, user) {
  const payload = b64url(new TextEncoder().encode(JSON.stringify({
    sub: user.sub, email: user.email, name: user.name, pic: user.picture || '',
    exp: Date.now() + SESSION_DAYS * 864e5,
  })));
  const sig = await hmac(env.SESSION_SECRET, payload);
  return `${payload}.${sig}`;
}

async function readSession(env, request) {
  const cookie = request.headers.get('cookie') || '';
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return null;
  const [payload, sig] = m[1].split('.');
  if (!payload || !sig) return null;
  if ((await hmac(env.SESSION_SECRET, payload)) !== sig) return null;
  try {
    const data = JSON.parse(b64urlToStr(payload));
    if (!data.exp || data.exp < Date.now()) return null;
    return data;
  } catch { return null; }
}

const sessionCookie = (value, maxAge) =>
  `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

// אדמין = ADMIN_EMAIL (שורש, לא ניתן להסרה) או משתמש שקודם ל-role:'admin' דרך הפאנל
const isRootAdmin = (env, email) => !!(email && env.ADMIN_EMAIL && email.toLowerCase() === env.ADMIN_EMAIL.toLowerCase());
async function isAdmin(env, s) {
  if (!s) return false;
  if (isRootAdmin(env, s.email)) return true;
  const u = await env.USERS.get('user:' + s.sub, 'json');
  return !!(u && u.role === 'admin');
}

// חשבונות מייל+סיסמה: sub = 'local:<email>'; הסיסמה נשמרת כ-PBKDF2 (מלח אקראי, 100K איטרציות)
const emailKey = (email) => 'user:local:' + String(email || '').trim().toLowerCase();
const validEmail = (e) => /^\S+@\S+\.\S+$/.test(String(e || '').trim());
async function hashPassword(password, saltB64, iterations = 100000) {
  const salt = saltB64 ? Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0)) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256);
  return { s: btoa(String.fromCharCode(...salt)), i: iterations, h: b64url(bits) };
}
const userOut = (env, u) => ({ email: u.email, name: u.name, picture: u.picture || '', admin: isRootAdmin(env, u.email) || u.role === 'admin' });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    // הרשמה עם מייל וסיסמה (מתחבר אוטומטית אחרי ההרשמה)
    if (url.pathname === '/api/register' && request.method === 'POST') {
      let b = {};
      try { b = await request.json(); } catch {}
      const email = String(b.email || '').trim().toLowerCase();
      const name = String(b.name || '').trim().slice(0, 60);
      if (!validEmail(email)) return json({ error: 'bad-email' }, 400);
      if (!name) return json({ error: 'missing-name' }, 400);
      if (String(b.password || '').length < 6) return json({ error: 'weak-password' }, 400);
      const key = emailKey(email);
      if (await env.USERS.get(key)) return json({ error: 'exists' }, 409);
      const user = {
        sub: 'local:' + email, email, name, picture: '',
        created: new Date().toISOString(), lastLogin: new Date().toISOString(), logins: 1, role: '',
        ph: await hashPassword(b.password),
      };
      await env.USERS.put(key, JSON.stringify(user));
      const session = await makeSession(env, user);
      return json({ user: userOut(env, user) }, 200, { 'set-cookie': sessionCookie(session, SESSION_DAYS * 86400) });
    }

    // כניסה עם מייל וסיסמה
    if (url.pathname === '/api/login-pass' && request.method === 'POST') {
      let b = {};
      try { b = await request.json(); } catch {}
      const u = validEmail(b.email) ? await env.USERS.get(emailKey(b.email), 'json') : null;
      if (!u || !u.ph) return json({ error: 'bad-credentials' }, 401);
      const attempt = await hashPassword(String(b.password || ''), u.ph.s, u.ph.i);
      if (attempt.h !== u.ph.h) return json({ error: 'bad-credentials' }, 401);
      u.lastLogin = new Date().toISOString();
      u.logins = (u.logins || 0) + 1;
      await env.USERS.put(emailKey(u.email), JSON.stringify(u));
      const session = await makeSession(env, u);
      return json({ user: userOut(env, u) }, 200, { 'set-cookie': sessionCookie(session, SESSION_DAYS * 86400) });
    }

    // שכחתי סיסמה: יוצר טוקן לשעה ושולח מייל (Resend) - בלי לחשוף אם החשבון קיים
    if (url.pathname === '/api/reset-request' && request.method === 'POST') {
      let b = {};
      try { b = await request.json(); } catch {}
      if (!env.RESEND_API_KEY) return json({ error: 'reset-not-available' }, 503);
      const u = validEmail(b.email) ? await env.USERS.get(emailKey(b.email), 'json') : null;
      if (u) {
        const token = b64url(crypto.getRandomValues(new Uint8Array(24)));
        await env.USERS.put('reset:' + token, u.sub, { expirationTtl: 3600 });
        const link = url.origin + '/?reset=' + token;
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { authorization: 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json' },
          body: JSON.stringify({
            from: env.RESET_FROM || 'onboarding@resend.dev', to: u.email,
            subject: 'איפוס סיסמה - סַלְזוֹל',
            html: `<div dir="rtl">לחצו לאיפוס הסיסמה (תקף לשעה): <a href="${link}">${link}</a></div>`,
          }),
        }).catch(() => {});
      }
      return json({ ok: true });
    }

    // קביעת סיסמה חדשה מתוך קישור האיפוס
    if (url.pathname === '/api/reset-confirm' && request.method === 'POST') {
      let b = {};
      try { b = await request.json(); } catch {}
      if (String(b.password || '').length < 6) return json({ error: 'weak-password' }, 400);
      const sub = b.token ? await env.USERS.get('reset:' + b.token) : null;
      if (!sub) return json({ error: 'bad-token' }, 400);
      const u = await env.USERS.get('user:' + sub, 'json'); // sub של חשבון מקומי הוא 'local:<email>'
      if (!u) return json({ error: 'bad-token' }, 400);
      u.ph = await hashPassword(b.password);
      await env.USERS.put('user:' + u.sub, JSON.stringify(u));
      await env.USERS.delete('reset:' + b.token);
      return json({ ok: true });
    }

    if (url.pathname === '/api/login' && request.method === 'POST') {
      if (!env.GOOGLE_CLIENT_ID) return json({ error: 'login-not-configured' }, 503);
      let credential = '';
      try { credential = (await request.json()).credential || ''; } catch {}
      if (!credential) return json({ error: 'missing-credential' }, 400);
      // אימות ה-ID-token מול גוגל - חתימה, תוקף וקהל (aud) נבדקים אצלם
      const info = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential)).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (!info || info.aud !== env.GOOGLE_CLIENT_ID || info.email_verified !== 'true') return json({ error: 'invalid-token' }, 401);
      const key = 'user:' + info.sub;
      const existing = await env.USERS.get(key, 'json');
      const user = {
        sub: info.sub, email: info.email, name: info.name || info.email, picture: info.picture || '',
        created: existing ? existing.created : new Date().toISOString(),
        lastLogin: new Date().toISOString(),
        logins: (existing ? existing.logins || 0 : 0) + 1,
        role: existing ? existing.role || '' : '',
      };
      await env.USERS.put(key, JSON.stringify(user));
      const session = await makeSession(env, user);
      const admin = isRootAdmin(env, user.email) || user.role === 'admin';
      return json(
        { user: { email: user.email, name: user.name, picture: user.picture, admin } },
        200, { 'set-cookie': sessionCookie(session, SESSION_DAYS * 86400) },
      );
    }

    if (url.pathname === '/api/me') {
      const s = await readSession(env, request);
      // cid = ה-Client ID הציבורי של גוגל - הלקוח צריך אותו כדי לצייר את כפתור ההתחברות
      return json({ user: s ? { email: s.email, name: s.name, picture: s.pic, admin: await isAdmin(env, s) } : null, cid: env.GOOGLE_CLIENT_ID || '' });
    }

    if (url.pathname === '/api/logout' && request.method === 'POST') {
      return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0) });
    }

    if (url.pathname === '/api/admin/users') {
      const s = await readSession(env, request);
      if (!(await isAdmin(env, s))) return json({ error: 'forbidden' }, 403);
      const users = [];
      let cursor;
      do {
        const page = await env.USERS.list({ prefix: 'user:', cursor });
        for (const k of page.keys) {
          const u = await env.USERS.get(k.name, 'json');
          if (u) users.push({
            sub: u.sub, email: u.email, name: u.name, picture: u.picture,
            created: u.created, lastLogin: u.lastLogin, logins: u.logins || 1,
            role: isRootAdmin(env, u.email) ? 'root' : (u.role || ''),
            prov: String(u.sub || '').startsWith('local:') ? 'מייל' : 'Google',
          });
        }
        cursor = page.list_complete ? null : page.cursor;
      } while (cursor);
      users.sort((a, b) => (a.created < b.created ? 1 : -1));
      return json({ users });
    }

    // קידום/הורדת מנהל מהפאנל - אדמין בלבד; את אדמין-השורש אי אפשר להוריד
    if (url.pathname === '/api/admin/setrole' && request.method === 'POST') {
      const s = await readSession(env, request);
      if (!(await isAdmin(env, s))) return json({ error: 'forbidden' }, 403);
      let body = {};
      try { body = await request.json(); } catch {}
      if (!body.sub || !['admin', 'user'].includes(body.role)) return json({ error: 'bad-request' }, 400);
      const key = 'user:' + body.sub;
      const u = await env.USERS.get(key, 'json');
      if (!u) return json({ error: 'not-found' }, 404);
      if (isRootAdmin(env, u.email)) return json({ error: 'root-admin-locked' }, 400);
      u.role = body.role === 'admin' ? 'admin' : '';
      await env.USERS.put(key, JSON.stringify(u));
      return json({ ok: true, email: u.email, role: u.role });
    }

    return json({ error: 'not-found' }, 404);
  },
};
