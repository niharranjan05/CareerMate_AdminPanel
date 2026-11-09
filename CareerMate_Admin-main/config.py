import os


class Config:
    # The public URL of your FastAPI backend on Render, e.g.
    # https://careermate-web.onrender.com  (NO trailing slash)
    BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8000").rstrip("/")

    # Signs Flask's session cookie. Generate with:
    # python -c "import secrets; print(secrets.token_hex(32))"
    SECRET_KEY = os.getenv("FLASK_SECRET_KEY", "dev-only-change-me")

    # How long the Flask-side session cookie lasts (matches the backend's
    # 24h session token lifetime).
    PERMANENT_SESSION_LIFETIME_HOURS = int(os.getenv("SESSION_HOURS", "24"))

    # Seconds before an outbound call to the backend times out.
    REQUEST_TIMEOUT = float(os.getenv("BACKEND_TIMEOUT", "15"))
