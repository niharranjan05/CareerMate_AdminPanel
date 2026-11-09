// app.js — shared shell behaviour (sidebar, topbar, theme, toasts) plus
// small utilities every page script below uses.
//
// SECURITY: command names, search topics, error messages and anything
// else traceable back to a WhatsApp user's raw text must never be
// trusted. Always pass it through esc() before inserting into innerHTML,
// anywhere in this file or in a page's own <script> block.
function esc(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmt(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return Number(n).toLocaleString();
}

function fmtPct(n, digits) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return Number(n).toFixed(digits === undefined ? 1 : digits) + "%";
}

function fmtDate(s) {
  if (!s) return "—";
  const d = new Date(s.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function fmtDateTime(s) {
  if (!s) return "—";
  const d = new Date(s.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function timeAgo(s) {
  if (!s) return "—";
  const d = new Date(s.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return s;
  const diffMs = Date.now() - d.getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return mins + "m ago";
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return hrs + "h ago";
  const days = Math.round(hrs / 24);
  return days + "d ago";
}

let CONNECTION_OK = true;

async function fetchJSON(url) {
  let resp;
  try {
    resp = await fetch(url, { credentials: "same-origin" });
  } catch (e) {
    setConnStatus(false);
    throw e;
  }
  if (resp.status === 401) {
    window.location.href = "/login";
    throw new Error("session expired");
  }
  if (!resp.ok) {
    setConnStatus(false);
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.error || ("HTTP " + resp.status));
  }
  setConnStatus(true);
  return resp.json();
}

async function postJSON(url, payload) {
  let resp;
  try {
    resp = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    });
  } catch (e) {
    setConnStatus(false);
    throw e;
  }
  if (resp.status === 401) {
    window.location.href = "/login";
    throw new Error("session expired");
  }
  if (!resp.ok) {
    setConnStatus(false);
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.error || ("HTTP " + resp.status));
  }
  setConnStatus(true);
  return resp.json();
}

function setConnStatus(ok) {
  CONNECTION_OK = ok;
  const pill = document.getElementById("connStatus");
  if (!pill) return;
  if (ok) {
    pill.classList.remove("bad");
    pill.innerHTML = '<span class="conn-dot conn-ok"></span>Backend Online';
  } else {
    pill.classList.add("bad");
    pill.innerHTML = '<span class="conn-dot conn-bad"></span>Backend Offline';
  }
}

function toast(message, isError) {
  let el = document.getElementById("appToast");
  if (!el) {
    el = document.createElement("div");
    el.id = "appToast";
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.classList.toggle("err", !!isError);
  el.innerHTML = (isError ? '<i class="fa-solid fa-triangle-exclamation"></i> ' : '<i class="fa-solid fa-circle-check"></i> ') + esc(message);
  requestAnimationFrame(() => el.classList.add("show"));
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 3200);
}

/* ---------- chart helpers ---------- */
const PALETTE = ["#00d4ff", "#9b6bff", "#ffd23f", "#34d399", "#ff4d8d", "#5b8cff", "#ffa94d"];

function chartOpts(extra) {
  const gridColor = "rgba(255,255,255,.06)";
  const tickColor = "#9aa3d6";
  const base = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "#1a2358",
        borderColor: "#232e66",
        borderWidth: 1,
        titleColor: "#f5f7ff",
        bodyColor: "#f5f7ff",
        padding: 10,
      },
    },
    scales: {
      x: { grid: { color: gridColor }, ticks: { color: tickColor, font: { size: 10 } } },
      y: { grid: { color: gridColor }, ticks: { color: tickColor, font: { size: 10 } }, beginAtZero: true },
    },
  };
  return Object.assign(base, extra || {});
}

function destroyChart(canvas) {
  if (canvas && canvas._chart) {
    canvas._chart.destroy();
    canvas._chart = null;
  }
}

function lineChart(canvas, labels, series, opts) {
  destroyChart(canvas);
  canvas._chart = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: series.map((s, i) => ({
        label: s.label,
        data: s.data,
        borderColor: s.color || PALETTE[i % PALETTE.length],
        backgroundColor: (s.color || PALETTE[i % PALETTE.length]) + "22",
        fill: !!s.fill,
        tension: 0.35,
        pointRadius: 2.5,
        pointHoverRadius: 4,
        borderWidth: 2,
      })),
    },
    options: chartOpts(opts),
  });
  return canvas._chart;
}

function barChart(canvas, labels, series, opts) {
  destroyChart(canvas);
  canvas._chart = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: series.map((s, i) => ({
        label: s.label,
        data: s.data,
        backgroundColor: s.color || PALETTE[i % PALETTE.length],
        borderRadius: 4,
        maxBarThickness: 34,
      })),
    },
    options: chartOpts(opts),
  });
  return canvas._chart;
}

function doughnutChart(canvas, labels, data, colors) {
  destroyChart(canvas);
  canvas._chart = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{ data, backgroundColor: colors || PALETTE, borderWidth: 0 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "72%",
      plugins: { legend: { display: false }, tooltip: { backgroundColor: "#1a2358", borderColor: "#232e66", borderWidth: 1 } },
    },
  });
  return canvas._chart;
}

function gaugeChart(canvas, pct, color) {
  destroyChart(canvas);
  const v = Math.max(0, Math.min(100, pct || 0));
  canvas._chart = new Chart(canvas, {
    type: "doughnut",
    data: {
      datasets: [{ data: [v, 100 - v], backgroundColor: [color || "#00d4ff", "#232e66"], borderWidth: 0 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "76%",
      rotation: -90,
      circumference: 360,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
    },
  });
  return canvas._chart;
}

/* ---------- date-range helper shared by pages ---------- */
function rangeDates(days) {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - (Number(days) - 1));
  const f = (d) => d.toISOString().slice(0, 10);
  return { start: f(start), end: f(end) };
}

/* ---------- shell: sidebar / topbar / theme ---------- */
function applyTheme(settings) {
  const root = document.documentElement;
  let theme = (settings && settings.theme) || "dark";
  if (theme === "auto") {
    theme = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  root.setAttribute("data-theme", theme === "light" ? "light" : "dark");

  const colors = { cyan: "#00d4ff", violet: "#9b6bff", green: "#34d399", blue: "#5b8cff", orange: "#ffa94d", pink: "#ff4d8d" };
  const c = colors[(settings && settings.primary_color) || "cyan"] || colors.cyan;
  root.style.setProperty("--accent", c);

  document.body.classList.toggle("sb-compact", !!(settings && settings.sidebar_style === "compact"));
  const av = (settings && settings.bot_avatar) || "🤖";
  document.querySelectorAll(".promo-avatar").forEach((el) => { el.textContent = av; });
}

function initShell() {
  const menuToggle = document.getElementById("menuToggle");
  const sidebarClose = document.getElementById("sidebarClose");
  const backdrop = document.getElementById("sidebarBackdrop");
  if (menuToggle) {
    menuToggle.addEventListener("click", () => {
      // desktop: collapse/expand the sidebar; mobile: slide it over the page
      const mobile = window.matchMedia("(max-width: 980px)").matches;
      document.body.classList.toggle(mobile ? "sidebar-open" : "sidebar-collapsed");
    });
  }
  if (sidebarClose) {
    sidebarClose.addEventListener("click", () => document.body.classList.remove("sidebar-open"));
  }
  if (backdrop) {
    backdrop.addEventListener("click", () => document.body.classList.remove("sidebar-open"));
  }

  const adminChip = document.getElementById("adminChip");
  const adminDropdown = document.getElementById("adminDropdown");
  if (adminChip && adminDropdown) {
    adminChip.addEventListener("click", (e) => {
      e.stopPropagation();
      adminDropdown.classList.toggle("open");
    });
    document.addEventListener("click", () => adminDropdown.classList.remove("open"));
  }

  const rangeSelect = document.getElementById("globalRange");
  if (rangeSelect) {
    const saved = sessionStorage.getItem("cm_range") || "7";
    rangeSelect.value = saved;
    rangeSelect.addEventListener("change", () => {
      sessionStorage.setItem("cm_range", rangeSelect.value);
      document.dispatchEvent(new CustomEvent("rangechange", { detail: { days: rangeSelect.value } }));
    });
  }

  // Apply a quick theme guess from localStorage immediately (avoids a
  // flash), then confirm against the shared backend setting.
  try {
    const cached = JSON.parse(localStorage.getItem("cm_settings_cache") || "null");
    if (cached) applyTheme(cached);
  } catch (e) {}

  fetchJSON("/api/data/settings")
    .then((s) => {
      applyTheme(s);
      try { localStorage.setItem("cm_settings_cache", JSON.stringify(s)); } catch (e) {}
      const bell = document.getElementById("bellBadge");
      if (bell) {
        fetchJSON("/api/data/errors?limit=5").then((e) => {
          const n = (e.recent || []).length;
          if (n > 0) { bell.hidden = false; bell.textContent = n; }
        }).catch(() => {});
      }
    })
    .catch(() => {});
}

document.addEventListener("DOMContentLoaded", () => {
  initShell();
  const page = document.body.dataset.page;
  const fn = window["init_" + page];
  if (typeof fn === "function") fn();
});
