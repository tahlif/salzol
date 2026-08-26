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
const b64urlToStr = (s) => atob(s.replace(/-/g, '+').replace(/_/g, '/'));

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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

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
      };
      await env.USERS.put(key, JSON.stringify(user));
      const session = await makeSession(env, user);
      return json(
        { user: { email: user.email, name: user.name, picture: user.picture, admin: user.email === env.ADMIN_EMAIL } },
        200, { 'set-cookie': sessionCookie(session, SESSION_DAYS * 86400) },
      );
    }

    if (url.pathname === '/api/me') {
      const s = await readSession(env, request);
      // cid = ה-Client ID הציבורי של גוגל - הלקוח צריך אותו כדי לצייר את כפתור ההתחברות
      return json({ user: s ? { email: s.email, name: s.name, picture: s.pic, admin: s.email === env.ADMIN_EMAIL } : null, cid: env.GOOGLE_CLIENT_ID || '' });
    }

    if (url.pathname === '/api/logout' && request.method === 'POST') {
      return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0) });
    }

    if (url.pathname === '/api/admin/users') {
      const s = await readSession(env, request);
      if (!s || s.email !== env.ADMIN_EMAIL) return json({ error: 'forbidden' }, 403);
      const users = [];
      let cursor;
      do {
        const page = await env.USERS.list({ prefix: 'user:', cursor });
        for (const k of page.keys) {
          const u = await env.USERS.get(k.name, 'json');
          if (u) users.push({ email: u.email, name: u.name, picture: u.picture, created: u.created, lastLogin: u.lastLogin, logins: u.logins || 1 });
        }
        cursor = page.list_complete ? null : page.cursor;
      } while (cursor);
      users.sort((a, b) => (a.created < b.created ? 1 : -1));
      return json({ users });
    }

    return json({ error: 'not-found' }, 404);
  },
};
