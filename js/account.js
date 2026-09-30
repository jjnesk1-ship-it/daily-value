/* Daily Value: email accounts for the installable app (never inside claude.ai, which has its own sync).
   Sign-in is a one-time code sent by email (Supabase Auth). A code is typed into the app itself; a
   link would open Safari on iPhone instead of the installed app, which keeps its own storage. Where
   the email holds a link instead (Supabase's default templates), the link works too: tapped, it comes
   back to this page; copied, it can be pasted where the code goes.
   The diary syncs through one table, dv_docs, where row-level security lets each account read and
   write only its own rows (supabase/schema.sql). Plain HTTP, no SDK. Turned on by DV_CONFIG in
   js/config.js; without it, accounts don't appear. */
(function () {
  'use strict';
  const DV = window.DV;
  const cfg = window.DV_CONFIG || {};
  const BASE = String(cfg.supabaseUrl || '').replace(/\/+$/, '');
  const KEY = String(cfg.supabaseKey || '');
  const LS = 'dailyvalue:auth';
  const PAGE = 1000; // rows per request (Supabase's default maximum)

  // Only the publishable key may ship in a public page. A secret key bypasses row-level security and
  // would let anyone read every account's diary, so it's refused outright.
  function keyIsPublic(key) {
    if (/^sb_publishable_/.test(key)) return true;
    if (/^sb_secret_/.test(key)) return false;
    const parts = key.split('.');
    if (parts.length !== 3) return false;
    try {
      return JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))).role === 'anon';
    } catch (e) {
      return false;
    }
  }
  const keyOk = !KEY || keyIsPublic(KEY);
  if (!keyOk) console.error('Daily Value: js/config.js holds a secret Supabase key. Accounts are off; use the publishable key and rotate the secret one.');

  class AccountError extends Error {
    constructor(code, message, status) {
      super(message);
      // unavailable | rate_limited | bad_code | bad_email | not_authorized | signups_closed | unauthenticated
      // | quota_exceeded | too_large | setup | error
      this.code = code;
      this.status = status || 0;
    }
  }

  // Session: { access_token, refresh_token, expires_at (seconds, this device's clock), user: { id, email } }
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
  function notify() {
    listeners.forEach((fn) => fn());
    DV.emit();
  }
  function setSession(s) {
    session = s;
    try {
      if (s) localStorage.setItem(LS, JSON.stringify(s));
      else localStorage.removeItem(LS);
    } catch (e) {}
    notify();
  }
  // Another window signed in, out, or refreshed the tokens.
  window.addEventListener('storage', (e) => {
    if (e.key !== LS) return;
    session = readSession();
    notify();
  });
  // The expiry is kept on this device's clock, so a clock that's off doesn't cause constant refreshing.
  function sessionFrom(r, user) {
    const u = user || (r && r.user);
    if (!r || !r.access_token || !r.refresh_token || !u || !u.id) throw new AccountError('error', 'The account service sent an incomplete sign-in.');
    return {
      access_token: r.access_token,
      refresh_token: r.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + (Number(r.expires_in) || 3600),
      user: { id: u.id, email: u.email || '' },
    };
  }

  // Supabase Auth answers { code: <status>, error_code, msg }; the data API answers { code, message, hint }.
  const SIGNED_OUT = /^(refresh_token_not_found|refresh_token_already_used|session_not_found|session_expired|user_not_found|user_banned|bad_jwt|no_authorization)$/;
  function errorFrom(status, j) {
    const code = String((j && (j.error_code || (typeof j.code === 'string' ? j.code : '') || j.error)) || '');
    const msg = String((j && (j.msg || j.message || j.error_description || j.error)) || 'HTTP ' + status);
    if (status === 429 || /rate_limit/.test(code)) return new AccountError('rate_limited', msg, status);
    if (/^(otp_expired|invalid_credentials|flow_state_expired|flow_state_not_found)$/.test(code)) return new AccountError('bad_code', msg, status);
    if (code === 'email_address_not_authorized') return new AccountError('not_authorized', msg, status);
    if (/^(otp_disabled|signup_disabled|email_provider_disabled)$/.test(code)) return new AccountError('signups_closed', msg, status);
    if (/^(email_address_invalid|validation_failed)$/.test(code)) return new AccountError('bad_email', msg, status);
    if (SIGNED_OUT.test(code) || /^PGRST30/.test(code) || status === 401) return new AccountError('unauthenticated', msg, status);
    if (code === '54000' || status === 413) return new AccountError('quota_exceeded', msg, status);
    if (code === '23514') return new AccountError('too_large', msg, status);
    if (code === '42501' || code === 'PGRST205' || code === 'PGRST202' || code === '42P01') return new AccountError('setup', msg, status);
    if (status >= 500 || status === 409 || status === 0) return new AccountError('unavailable', msg, status);
    return new AccountError('error', msg, status);
  }

  async function call(path, { method = 'GET', body, token, headers } = {}) {
    const h = Object.assign({ apikey: KEY, 'Content-Type': 'application/json' }, headers || {});
    if (token) h.Authorization = 'Bearer ' + token;
    let res;
    try {
      res = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', credentials: 'omit' });
    } catch (e) {
      throw new AccountError('unavailable', 'No connection');
    }
    let text = '';
    try {
      text = await res.text();
    } catch (e) {
      throw new AccountError('unavailable', 'The connection dropped');
    }
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (e) {}
    if (!res.ok) throw errorFrom(res.status, json);
    return json;
  }

  // One refresh at a time, across every window of the app on this device (Supabase lets a refresh token
  // be used once). Only a refusal of the token itself ends the sign-in; anything else keeps it for later.
  let refreshing = null;
  function withLock(fn) {
    return navigator.locks && navigator.locks.request ? navigator.locks.request('dailyvalue-auth', fn) : fn();
  }
  function refresh() {
    if (!session) return Promise.reject(new AccountError('unauthenticated', 'Signed out'));
    if (!refreshing) {
      const before = session;
      refreshing = withLock(async () => {
        // Another window may have refreshed already while this one waited.
        const stored = readSession();
        if (!session || session.refresh_token !== before.refresh_token) return; // signed out or replaced meanwhile
        if (stored && stored.user.id === before.user.id && stored.refresh_token !== before.refresh_token) {
          session = stored;
          return;
        }
        try {
          const r = await call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: before.refresh_token } });
          if (session && session.refresh_token === before.refresh_token) setSession(sessionFrom(r));
        } catch (e) {
          if (e.code !== 'unauthenticated') throw new AccountError('unavailable', e.message, e.status);
          if (session && session.refresh_token === before.refresh_token) setSession(null);
          throw e;
        }
      }).finally(() => (refreshing = null));
    }
    return refreshing;
  }
  async function accessToken() {
    if (!session) throw new AccountError('unauthenticated', 'Signed out');
    if (session.expires_at * 1000 - Date.now() < 60000) await refresh();
    if (!session) throw new AccountError('unauthenticated', 'Signed out');
    return session.access_token;
  }
  // Signed-in request: refreshes an expiring token first, and once more if the server says it expired.
  async function authed(path, opts) {
    const who = session && session.user.id;
    try {
      return await call(path, Object.assign({}, opts, { token: await accessToken() }));
    } catch (e) {
      if (e.code !== 'unauthenticated' || !session || session.user.id !== who) throw e;
      await refresh();
      if (!session || session.user.id !== who) throw new AccountError('unauthenticated', 'Signed out');
      return call(path, Object.assign({}, opts, { token: session.access_token }));
    }
  }

  // A sign-in link from an email: https://<project>.supabase.co/auth/v1/verify?token=<hash>&type=magiclink&...
  function linkToken(text) {
    const m = String(text || '').match(/https?:\/\/\S+/);
    if (!m) return null;
    try {
      const u = new URL(m[0]);
      const hash = u.searchParams.get('token') || u.searchParams.get('token_hash');
      if (!hash || !/\/auth\/v1\/verify$/.test(u.pathname)) return null;
      return { token_hash: hash, type: u.searchParams.get('type') || 'magiclink' };
    } catch (e) {
      return null;
    }
  }

  const AC = (DV.account = {
    // Accounts need this copy of the app to be set up (js/config.js) with a public key, and never run
    // inside claude.ai.
    configured: !!(BASE && KEY) && keyOk && !(window.claude && typeof window.claude.use === 'function'),
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
    isLink: (text) => !!linkToken(text),

    // Email a sign-in code (or link, depending on the project's email templates). New addresses get an account.
    sendCode(email) {
      const back = encodeURIComponent(location.origin + location.pathname);
      return call('/auth/v1/otp?redirect_to=' + back, { method: 'POST', body: { email, create_user: true } });
    },
    // The code from the email, or the whole sign-in link pasted from it.
    async verifyCode(email, entry) {
      const link = linkToken(entry);
      const body = link ? link : { type: 'email', email, token: String(entry).replace(/\D/g, '') };
      setSession(sessionFrom(await call('/auth/v1/verify', { method: 'POST', body })));
      return AC.userId;
    },
    // A tapped sign-in link comes back to the app with the session in the address (#access_token=…).
    // Returns true when that happened, false otherwise; throws when the link was used or expired.
    async finishLinkSignIn() {
      const h = new URLSearchParams(location.hash.replace(/^#/, ''));
      if (!h.get('access_token') && !h.get('error_code') && !h.get('error')) return false;
      history.replaceState(null, '', location.pathname + location.search);
      if (!h.get('access_token')) throw errorFrom(403, { error_code: h.get('error_code') || h.get('error'), msg: h.get('error_description') });
      const r = { access_token: h.get('access_token'), refresh_token: h.get('refresh_token'), expires_in: h.get('expires_in') };
      const user = await call('/auth/v1/user', { token: r.access_token });
      setSession(sessionFrom(r, user));
      return true;
    },
    // Sign out this device, revoking its sign-in on the server when there's a connection.
    async signOut() {
      if (session && session.expires_at * 1000 - Date.now() < 60000) await refresh().catch(() => {});
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
    // One stored row, or null.
    async fetchPath(path) {
      const rows = await authed('/rest/v1/dv_docs?select=path,data,u,deleted,seq&path=eq.' + encodeURIComponent(path));
      return rows[0] || null;
    },
    // Save one document, or (data null) mark it deleted. The database keeps whichever copy has the later
    // u (the app's own edit time). Returns { u, seq } as stored, or null when a newer copy was kept.
    async write(path, data, u) {
      const rows = await authed('/rest/v1/dv_docs?on_conflict=user_id,path&select=u,seq', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: { path, data: data || null, u: u || Date.now(), deleted: !data },
      });
      return (rows && rows[0]) || null;
    },
  });
})();
