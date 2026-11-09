# app.py
# CareerMate Admin Panel — a separate Flask app that logs in against
# the FastAPI backend's real admin auth (auth.py, seeded from the
# DEFAULT_ADMIN_USER / DEFAULT_ADMIN_PASS env vars on Render) and then
# continuously pulls analytics from it to render the dashboard.

from datetime import timedelta
from functools import wraps

import os

from flask import Flask, render_template, request, redirect, url_for, session, jsonify

from config import Config
import backend_client as backend


def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)

    # SECURITY: Flask signs session cookies with SECRET_KEY. If it's left at
    # the dev default (or is predictable), anyone who reads this source can
    # forge a valid admin session cookie and walk straight into the
    # dashboard without a password. Refuse to start in production without
    # a real one set.
    if os.getenv("FLASK_ENV") == "production" and app.config["SECRET_KEY"] == "dev-only-change-me":
        raise RuntimeError(
            "FLASK_SECRET_KEY is not set. Generate one with: "
            "python -c \"import secrets; print(secrets.token_hex(32))\" "
            "and set it as an environment variable before deploying."
        )

    # SECURITY: force the session cookie to only ever travel over HTTPS,
    # and never be readable by page JavaScript (Flask already defaults
    # HttpOnly to True, but we set it explicitly here for clarity).
    app.config["SESSION_COOKIE_SECURE"] = os.getenv("FLASK_ENV") == "production"
    app.config["SESSION_COOKIE_HTTPONLY"] = True
    app.config["SESSION_COOKIE_SAMESITE"] = "Lax"

    app.permanent_session_lifetime = timedelta(hours=app.config["PERMANENT_SESSION_LIFETIME_HOURS"])

    # ------------------------------------------------------------
    # auth guards
    # ------------------------------------------------------------
    def login_required(view):
        @wraps(view)
        def wrapped(*args, **kwargs):
            if not session.get("token"):
                return redirect(url_for("login", next=request.path))
            return view(*args, **kwargs)
        return wrapped

    def api_login_required(view):
        """Same idea, but for JSON endpoints: a 401 JSON body instead of a
        redirect, so the dashboard's fetch() calls can detect it and send
        the browser to /login themselves (see dashboard.js)."""
        @wraps(view)
        def wrapped(*args, **kwargs):
            if not session.get("token"):
                return jsonify({"error": "session_expired"}), 401
            return view(*args, **kwargs)
        return wrapped

    # ------------------------------------------------------------
    # login / logout
    # ------------------------------------------------------------
    @app.route("/login", methods=["GET", "POST"])
    def login():
        if request.method == "GET":
            if session.get("token"):
                return redirect(url_for("dashboard"))
            return render_template("login.html", error=None)

        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")

        try:
            data = backend.login(username, password)
        except backend.Unauthorized:
            return render_template("login.html", error="Invalid username or password."), 401
        except backend.BackendError as e:
            if e.status_code == 429:
                return render_template("login.html", error="Too many failed attempts. Try again in 15 minutes."), 429
            return render_template("login.html", error=f"Backend unreachable: {e.detail}"), 503

        session.permanent = True
        session["token"] = data["token"]
        session["username"] = data["username"]

        next_path = request.args.get("next") or url_for("dashboard")
        return redirect(next_path)

    @app.route("/logout")
    def logout():
        backend.logout()
        session.clear()
        return redirect(url_for("login"))

    # ------------------------------------------------------------
    # pages — every page shares the same sidebar/topbar shell (base.html)
    # and fetches its own data client-side via /api/data/*. Each route
    # just needs to be logged in; the data itself never touches a
    # server-rendered template.
    # ------------------------------------------------------------
    @app.route("/")
    @login_required
    def dashboard():
        return render_template("dashboard.html", username=session.get("username"), active="dashboard")

    @app.route("/users")
    @login_required
    def users():
        return render_template("users.html", username=session.get("username"), active="users")

    @app.route("/users/<phone>")
    @login_required
    def user_detail(phone):
        return render_template("user_detail.html", username=session.get("username"), active="users", phone=phone)

    @app.route("/features")
    @login_required
    def features():
        return render_template("features.html", username=session.get("username"), active="features")

    @app.route("/resume")
    @login_required
    def resume():
        return render_template("resume.html", username=session.get("username"), active="resume")

    @app.route("/quiz")
    @login_required
    def quiz():
        return render_template("quiz.html", username=session.get("username"), active="quiz")

    @app.route("/jobs")
    @login_required
    def jobs():
        return render_template("jobs.html", username=session.get("username"), active="jobs")

    @app.route("/feedback")
    @login_required
    def feedback():
        return render_template("feedback.html", username=session.get("username"), active="feedback")

    @app.route("/utube-notes")
    @login_required
    def notes():
        return render_template("notes.html", username=session.get("username"), active="notes")

    @app.route("/chat-pdf-analytics")
    @login_required
    def pdf_analytics():
        return render_template("pdf.html", username=session.get("username"), active="pdf")

    @app.route("/books-analytics")
    @login_required
    def books_analytics():
        return render_template("books.html", username=session.get("username"), active="books")

    @app.route("/ai-providers")
    @login_required
    def ai_providers():
        return render_template("ai.html", username=session.get("username"), active="ai")

    @app.route("/pyq-analytics")
    @login_required
    def pyq_analytics():
        return render_template("pyq.html", username=session.get("username"), active="pyq")

    @app.route("/system")
    @login_required
    def system():
        return render_template("system.html", username=session.get("username"), active="system")

    @app.route("/settings")
    @login_required
    def settings():
        return render_template("settings.html", username=session.get("username"), active="settings")

    # ------------------------------------------------------------
    # data proxy — browser JS calls these; we call the real backend
    # server-side so the bearer token never reaches the browser.
    # Supports GET (reads) and POST (Settings page saves) alike.
    # ------------------------------------------------------------
    @app.route("/api/data/<path:endpoint>", methods=["GET", "POST"])
    @api_login_required
    def data_proxy(endpoint):
        try:
            if request.method == "POST":
                result = backend.post(endpoint, json_body=request.get_json(silent=True) or {})
            else:
                result = backend.get(endpoint, params=request.args.to_dict())
            return jsonify(result)
        except backend.Unauthorized:
            session.clear()
            return jsonify({"error": "session_expired"}), 401
        except backend.BackendError as e:
            return jsonify({"error": e.detail}), e.status_code if e.status_code < 500 else 502

    return app


app = create_app()

if __name__ == "__main__":
    import os
    port = int(os.getenv("PORT", "5000"))
    debug = os.getenv("FLASK_ENV") != "production"
    app.run(host="0.0.0.0", port=port, debug=debug)
