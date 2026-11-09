# backend_client.py
# Every call to the real backend happens here, server-side, using the
# admin session token stored in Flask's signed cookie — the browser
# never sees the bearer token directly. This also means no CORS setup
# is needed on the FastAPI side, since browser JS never talks to it.

import requests
from flask import session, current_app, request, has_request_context


class BackendError(Exception):
    def __init__(self, status_code, detail):
        self.status_code = status_code
        self.detail = detail
        super().__init__(f"Backend error {status_code}: {detail}")


class Unauthorized(BackendError):
    pass


def _base_url():
    return current_app.config["BACKEND_URL"]


def _timeout():
    return current_app.config["REQUEST_TIMEOUT"]


def login(username: str, password: str) -> dict:
    """Calls POST /api/auth/login. Raises BackendError on failure,
    returns {token, username, expires_in_hours} on success.

    Forwards the real client's IP as X-Forwarded-For so the backend's
    per-IP login rate limiter (auth.is_rate_limited) sees the actual admin's
    address instead of this Flask server's own IP for every login attempt."""
    headers = {}
    if has_request_context():
        forwarded = request.headers.get("X-Forwarded-For") or request.remote_addr
        if forwarded:
            headers["X-Forwarded-For"] = forwarded
    try:
        resp = requests.post(
            f"{_base_url()}/api/auth/login",
            json={"username": username, "password": password},
            headers=headers,
            timeout=_timeout(),
        )
    except requests.RequestException as e:
        raise BackendError(503, f"Could not reach backend: {e}")

    if resp.status_code == 200:
        return resp.json()

    detail = _safe_detail(resp)
    if resp.status_code == 401:
        raise Unauthorized(401, detail)
    raise BackendError(resp.status_code, detail)


def logout():
    token = session.get("token")
    if not token:
        return
    try:
        requests.post(
            f"{_base_url()}/api/auth/logout",
            headers={"Authorization": f"Bearer {token}"},
            timeout=_timeout(),
        )
    except requests.RequestException:
        pass  # best-effort; the Flask session gets cleared regardless


def get(path: str, params: dict = None) -> dict:
    """Authenticated GET against the backend's admin API. `path` is
    relative, e.g. 'overview' -> /api/analytics/overview."""
    token = session.get("token")
    if not token:
        raise Unauthorized(401, "No active session")

    try:
        resp = requests.get(
            f"{_base_url()}/api/analytics/{path.lstrip('/')}",
            headers={"Authorization": f"Bearer {token}"},
            params={k: v for k, v in (params or {}).items() if v not in (None, "")},
            timeout=_timeout(),
        )
    except requests.RequestException as e:
        raise BackendError(503, f"Could not reach backend: {e}")

    if resp.status_code == 401:
        raise Unauthorized(401, "Session expired")
    if resp.status_code >= 400:
        raise BackendError(resp.status_code, _safe_detail(resp))

    return resp.json()


def post(path: str, json_body: dict = None) -> dict:
    """Authenticated POST against the backend's admin API (used by the
    Settings page to save preferences)."""
    token = session.get("token")
    if not token:
        raise Unauthorized(401, "No active session")

    try:
        resp = requests.post(
            f"{_base_url()}/api/analytics/{path.lstrip('/')}",
            headers={"Authorization": f"Bearer {token}"},
            json=json_body or {},
            timeout=_timeout(),
        )
    except requests.RequestException as e:
        raise BackendError(503, f"Could not reach backend: {e}")

    if resp.status_code == 401:
        raise Unauthorized(401, "Session expired")
    if resp.status_code >= 400:
        raise BackendError(resp.status_code, _safe_detail(resp))

    return resp.json()


def _safe_detail(resp) -> str:
    try:
        return resp.json().get("detail", resp.text)
    except Exception:
        return resp.text or f"HTTP {resp.status_code}"
