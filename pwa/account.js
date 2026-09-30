/* Daily Value: email accounts for the installable app (never inside claude.ai, which has its own sync).
   Sign-in is a one-time code sent by email (Supabase Auth); a code rather than a link, because on iPhone a
   link opens Safari instead of the installed app. The diary syncs through one table, dv_docs, where
   row-level security lets each account read and write only its own rows (supabase/schema.sql).
   Plain HTTP, no SDK. Turned on by DV_CONFIG in js/config.js; without it, accounts don't appear. */
(function () {
  'use strict';
  const DV = window.DV;
  const cfg = window.DV_CONFIG || {};
  const BASE = String(cfg.supabaseUrl || '').replace(/\/+$/, '');
  const KEY = String(cfg.supabaseKey || '');
  const LS = 'dailyvalue:auth';
  const PAGE = 1000; // rows per request (Supabase's default maximum)

  class AccountError extends Error {
    constructor(code, message, status) {
      super(message);
      this.code = code; // unavailable | rate_limited | bad_code | bad_email | not_authorized | unauthenticated | too_large | error
      this.status = status || 0;
    }
  }

  // Session: { access_token, refresh_token, expires_at (seconds), user: { id, email } }
  function readSession() {
    try {
      const s = JSON.parse(localStorage.getItem(LS) || 'null');
      return s && s.refresh_token && s.user && s.user.id ? s : null;
    } catch (e) {
      return null;
    }
  }
  let session = readSession();
  const listeners = new Set();
  function setSession(s) {
    session = s;
    try {
      if (s) localStorage.setItem(LS, JSON.stringify(s));
      else localStorage.removeItem(LS);
    } catch (e) {}
    listeners.forEach((fn) => fn());
    DV.emit();
  }
  // Another tab signed in, out, or refreshed the tokens.
  window.addEventListener('storage', (e) => {
    if (e.key !== LS) return;
    session = readSession();
    listeners.forEach((fn) => fn());
    DV.emit();
  });
  function sessionFrom(r) {
    if (!r || !r.access_token || !r.refresh_token || !r.user) throw new AccountError('error', 'The account service sent an incomplete sign-in.');
    return {
      access_token: r.access_token,
      refresh_token: r.refresh_token,
      expires_at: r.expires_at || Math.floor(Date.now() / 1000) + (r.expires_in || 3600),
      user: { id: r.user.id, email: r.user.email || '' },
    };
  }

  function errorFrom(status, j) {
    const code = String((j && (j.error_code || j.code || j.error)) || '');
    const msg = String((j && (j.msg || j.message || j.error_description || j.error)) || 'HTTP ' + status);
    if (status === 429 || /rate_limit/.test(code)) return new AccountError('rate_limited', msg, status);
    if (/otp_expired|invalid_credentials|otp_disabled/.test(code) || (status === 403 && /token|otp|expired|invalid/i.test(msg))) return new AccountError('bad_code', msg, status);
    if (/email_address_not_authorized|signup_disabled/.test(code)) return new AccountError('not_authorized', msg, status);
    if (/email_address_invalid|validation_failed/.test(code)) return new AccountError('bad_email', msg, status);
    if (status === 401) return new AccountError('unauthenticated', msg, status);
    if (status === 413 || code === '23514') return new AccountError('too_large', msg, status);
    if (status >= 500) return new AccountError('unavailable', msg, status);
    return new AccountError('error', msg, status);
  }

  async function call(path, { method = 'GET', body, token, headers } = {}) {
    const h = Object.assign({ apikey: KEY, 'Content-Type': 'application/json' }, headers || {});
    if (token) h.Authorization = 'Bearer ' + token;
    let res;
    try {
      res = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
    } catch (e) {
      throw new AccountError('unavailable', 'No connection');
    }
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (e) {}
    if (!res.ok) throw errorFrom(res.status, json);
    return json;
  }

  // One refresh at a time; a rejected refresh token means the person is signed out.
  let refreshing = null;
  function refresh() {
    if (!session) return Promise.reject(new AccountError('unauthenticated', 'Signed out'));
    if (!refreshing) {
      const rt = session.refresh_token;
      refreshing = call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: rt } })
        .then((r) => setSession(sessionFrom(r)))
        .catch((e) => {
          if (e.code === 'unavailable') throw e;
          // Another tab may have rotated the token a moment ago; only give up if nothing newer arrived.
          const now = readSession();
          if (now && now.refresh_token !== rt) {
            session = now;
            return;
          }
          setSession(null);
          throw new AccountError('unauthenticated', 'Signed out');
        })
        .finally(() => (refreshing = null));
    }
    return refreshing;
  }
  async function accessToken() {
    if (!session) throw new AccountError('unauthenticated', 'Signed out');
    if (session.expires_at * 1000 - Date.now() < 60000) await refresh();
    return session.access_token;
  }
  // Signed-in request: refreshes an expiring token first, and once more if the server says it expired.
  async function authed(path, opts) {
    try {
      return await call(path, Object.assign({}, opts, { token: await accessToken() }));
    } catch (e) {
      if (e.code !== 'unauthenticated' || !session) throw e;
      await refresh();
      return call(path, Object.assign({}, opts, { token: session.access_token }));
    }
  }

  const AC = (DV.account = {
    // Accounts need this copy of the app to be set up (js/config.js), and never run inside claude.ai.
    configured: !!(BASE && KEY) && !(window.claude && typeof window.claude.use === 'function'),
    get signedIn() {
      return !!session;
    },
    get email() {
      return session ? session.user.email : '';
    },
    get userId() {
      return session ? session.user.id : null;
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    // Email a sign-in code. New addresses get an account.
    sendCode(email) {
      return call('/auth/v1/otp', { method: 'POST', body: { email, create_user: true } });
    },
    async verifyCode(email, token) {
      setSession(sessionFrom(await call('/auth/v1/verify', { method: 'POST', body: { type: 'email', email, token } })));
      return AC.userId;
    },
    async signOut() {
      const s = session;
      setSession(null);
      if (s) await call('/auth/v1/logout?scope=local', { method: 'POST', token: s.access_token }).catch(() => {});
    },
    // Deletes the account and, through the database, every row it owns.
    async deleteAccount() {
      await authed('/rest/v1/rpc/delete_my_account', { method: 'POST', body: {} });
      setSession(null);
    },

    // Diary rows changed after `seq` (0 for everything), oldest change first: [{ path, data, u, deleted, seq }]
    async fetchSince(seq) {
      const out = [];
      let after = seq || 0;
      for (;;) {
        const rows = await authed('/rest/v1/dv_docs?select=path,data,u,deleted,seq&seq=gt.' + after + '&order=seq.asc&limit=' + PAGE);
        out.push(...rows);
        if (rows.length < PAGE) return out;
        after = rows[rows.length - 1].seq;
      }
    },
    // Save one document. The database keeps whichever copy has the later u (the app's own edit time).
    put(path, data, u) {
      return authed('/rest/v1/dv_docs?on_conflict=user_id,path', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: { path, data, u: u || Date.now(), deleted: false },
      });
    },
    // Deleting leaves a marker, so the person's other devices remove their copy too.
    remove(path, u) {
      return authed('/rest/v1/dv_docs?on_conflict=user_id,path', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: { path, data: null, u: u || Date.now(), deleted: true },
      });
    },
  });
})();
