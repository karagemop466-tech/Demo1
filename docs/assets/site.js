/* site.js — shared helpers for the docs/ data hub (session arena-6aa291e9-demo1).
   Pages declare their relative depth with <body data-depth="1|2">; nav + provenance
   banners are injected here so every page shares one source of truth. */

const K = {
  depth: parseInt(document.body.dataset.depth || "1", 10),
  up: "../".repeat(parseInt(document.body.dataset.depth || "1", 10)),
  esc(v) { return (v == null ? "" : String(v)).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); },
  blank(v) { return v === 0 ? "0" : (v == null || v === "" ? "" : String(v)); },
  usd(v) { const n = Number(v); return Number.isFinite(n) && n !== null && v !== "" ? "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : ""; },
  pct(n) { return Number.isFinite(n) ? (100 * n).toFixed(1) + "%" : ""; },
  time(iso) { if (!iso) return ""; const d = new Date(iso); return isNaN(d) ? K.esc(iso) : d.toUTCString().replace("GMT", "UTC"); },
  async json(path) { const r = await fetch(K.up + path, { cache: "no-store" }); if (!r.ok) throw new Error(path + " → HTTP " + r.status); return r.json(); },
  page: (name) => K.up + "pages/" + name,
};

const NAV = [
  ["Hub", (d) => d + (d ? "../" : "") + "index.html"],
  ["Live dashboard", (d) => K.page("live.html")],
  ["Resolutions", (d) => K.page("resolutions.html")],
  ["Portfolio & trades", (d) => K.page("portfolio.html")],
  ["Suggestions", (d) => K.page("suggestions.html")],
  ["Flagged for review", (d) => K.page("flagged.html")],
  ["Verification", (d) => K.page("verification.html")],
  ["Repo review", (d) => K.page("repo-review.html")],
  ["Sources", (d) => K.page("sources.html")],
];

function buildNav() {
  const here = location.pathname.split("/").pop() || "index.html";
  const rootDepth = K.depth ? K.up : "";
  const el = document.querySelector("header.site nav");
  if (!el) return;
  el.innerHTML = NAV.map(([label, href]) => {
    const url = href(K.depth);
    const on = url.endsWith(here) ? ' class="on"' : "";
    return `<a href="${url}"${on}>${label}</a>`;
  }).join("") + `<a href="${K.up ? K.up + "../index.html" : "index.html"}">v1 monitor ↗</a>`;
}

function buildFooter() {
  const f = document.querySelector("footer.site");
  if (!f) return;
  f.innerHTML = `<span>Kalshi demo data hub · Demo1 repo · static GitHub Pages</span>
  <span>Data: official Kalshi DEMO API via scheduled CI · <a href="https://docs.kalshi.com/getting_started/demo_env.md" target="_blank" rel="noreferrer">official docs ↗</a>
  · <a href="${K.page("flagged.html")}">flagged items</a></span>`;
}

async function snapshotBanner(elId) {
  const el = document.getElementById(elId);
  if (!el) return null;
  try {
    const s = await K.json("data/snapshot.json");
    const when = s.sample ? "seed snapshot (verified manual probes, 2026-11-20)" : K.time(s.generated_at);
    el.innerHTML = s.sample
      ? `<b>Seed data:</b> values below were captured by live probes of the official Kalshi DEMO API on 2026-11-20 and link to those API responses. The scheduled pipeline (<code>scripts/fetch_kalshi_data.py</code>, every 15 min) replaces this with a full auto snapshot.`
      : `Snapshot generated <b>${K.time(s.generated_at)}</b> · scanned <b>${K.blank(s.events_scanned)}</b> open events ·
         <a href="${K.up}data/snapshot.json">snapshot.json ↗</a> <a href="${K.up}data/run_log.json">run_log.json ↗</a>
         ${s.errors && s.errors.length ? `<span class="pill warn">${s.errors.length} run errors</span>` : `<span class="pill yes">run OK</span>`}`;
    return s;
  } catch (e) {
    el.innerHTML = `<b>Data unavailable:</b> ${K.esc(e.message)} — values below remain blank (never invented).`;
    return null;
  }
}

document.addEventListener("DOMContentLoaded", () => { buildNav(); buildFooter(); });
