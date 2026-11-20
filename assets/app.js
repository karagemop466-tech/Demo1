/* app.js — dashboard shell + renderers. No build step, no dependencies.
   All market maths lives in kalshi.js (unit-tested); this file only fetches and paints. */
(function () {
  "use strict";
  const K = window.Kalshi;
  const NAV = [
    { group: "Brief", items: [["index", "Overview", "index.html"], ["exec", "Executive summary", "exec-summary.html"]] },
    {
      group: "Market",
      items: [
        ["dashboard", "Live dashboard", "dashboard.html"],
        ["markets", "Price & liquidity", "markets.html"],
        ["resolutions", "Resolution tracker", "dashboard.html#resolutions"],
      ],
    },
    {
      group: "Trading",
      items: [
        ["portfolio", "Portfolio & trades", "portfolio.html"],
        ["strategies", "Strategy lab", "strategies.html"],
      ],
    },
    {
      group: "Evidence",
      items: [
        ["api", "API reference", "api-reference.html"],
        ["provenance", "Data provenance", "provenance.html"],
        ["flagged", "Flagged for review", "flagged.html"],
      ],
    },
    {
      group: "Decisions",
      items: [
        ["questions", "Open questions", "questions.html"],
        ["suggestions", "Suggestions", "suggestions.html"],
      ],
    },
  ];

  const LS = {
    get(key, fallback) {
      try { const v = localStorage.getItem("kalshi-demo:" + key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
    },
    set(key, value) { try { localStorage.setItem("kalshi-demo:" + key, JSON.stringify(value)); } catch (e) { /* private mode */ } },
  };

  function el(tag, attrs, kids) {
    const n = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === "class") n.className = v;
        else if (k === "html") n.innerHTML = v;
        else if (k === "text") n.textContent = v;
        else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
        else if (k === "dataset") Object.assign(n.dataset, v);
        else n.setAttribute(k, v === true ? "" : String(v));
      }
    }
    (Array.isArray(kids) ? kids : kids === undefined ? [] : [kids]).forEach((c) => {
      if (c === null || c === undefined || c === false) return;
      n.appendChild(typeof c === "object" ? c : document.createTextNode(String(c)));
    });
    return n;
  }

  const srcLink = (url, label) =>
    url ? el("a", { href: url, target: "_blank", rel: "noopener noreferrer", title: url }, label || "source") : el("span", { class: "badge unverified", text: "unverified" });

  /* ------------------------------------------------------------------ *
   * shell
   * ------------------------------------------------------------------ */
  const state = {
    page: document.body.dataset.page || "index",
    base: LS.get("base", K.BASES[0].rest),
    env: LS.get("env", "demo"),
    topics: LS.get("topics", K.TOPICS.map((t) => t.id)),
    live: { mode: "snapshot", events: [], error: null, pages: 0, at: null },
    snapshot: null,
    settings: LS.get("settings", { autoRefresh: false, intervalSec: 30, maxPages: 3, charts: "minutes" }),
  };

  function buildShell() {
    const head = document.getElementById("site-header");
    if (head) {
      head.className = "masthead";
      const wrap = el("div", { class: "wrap row" });
      wrap.append(
        el("a", { class: "brand", href: "index.html" }, [
          el("span", { class: "mark", text: "K" }),
          el("span", {}, ["Kalshi Demo Desk", el("small", { text: "collect · organise · verify" })]),
        ]),
        el("span", { class: "env-tag", id: "env-tag", text: "demo environment — mock money" }),
        el("span", { class: "status-pill", id: "conn-pill" }, [el("span", { class: "dot snap", id: "conn-dot" }), el("span", { id: "conn-text", text: "loading snapshot…" })])
      );
      head.append(wrap);
    }
    const nav = document.getElementById("site-nav");
    if (nav) {
      nav.className = "tabs";
      const row = el("div", { class: "row", role: "tablist" });
      NAV.forEach((g) => {
        row.append(el("span", { class: "group", text: g.group }));
        g.items.forEach(([id, label, href]) => {
          const a = el("a", { href }, label);
          if (id === state.page) a.setAttribute("aria-current", "page");
          row.append(a);
        });
      });
      nav.append(row);
    }
    const foot = document.getElementById("site-footer");
    if (foot) {
      foot.className = "site";
      const w = el("div", { class: "wrap" });
      w.append(
        el("div", {}, [
          el("strong", { text: "Data policy: " }),
          "every table row links to the official page it came from. Values that could not be confirmed against an official source are left blank and tagged ",
          el("code", { text: "unverified" }),
          ", never estimated. ",
          srcLink(K.SOURCES.demoEnv, "Kalshi demo environment docs"),
          " · ",
          srcLink("https://docs.kalshi.com/llms.txt", "full docs index"),
        ]),
        el("div", { class: "dim", style: "margin-top:6px" }, [
          "Snapshot captured from the demo API ",
          el("code", { text: "2026-11-20T11:11–11:21Z" }),
          " · engine unit tests: ",
          el("code", { text: "node --test tests/kalshi.test.mjs" }),
          " · this site performs no trades.",
        ])
      );
      foot.append(w);
    }
  }

  function setConn(mode, detail) {
    const dot = document.getElementById("conn-dot");
    const txt = document.getElementById("conn-text");
    if (!dot || !txt) return;
    dot.className = "dot " + (mode === "live" ? "live" : mode === "error" ? "err" : "snap");
    txt.textContent = mode === "live" ? `live · ${detail || state.base}` : mode === "error" ? `live fetch failed · snapshot shown` : `snapshot · ${detail || "captured 2026-11-20"}`;
    txt.title = state.base + (state.live.error ? " — " + state.live.error : "");
  }

  /* ------------------------------------------------------------------ *
   * data
   * ------------------------------------------------------------------ */
  async function loadSnapshot() {
    const res = await K.fetchJson("data/snapshot.json", { timeoutMs: 8000 });
    if (!res.ok) throw new Error("snapshot unavailable: " + res.error);
    return res.data;
  }

  /** Attach a reproducible query URL to each live row so the Source column stays honest. */
  async function goLive() {
    const q = K.buildUrl(state.base, "/events", { status: "open", limit: 200 });
    const scan = await K.scanEvents({ base: state.base, status: "open", maxPages: state.settings.maxPages });
    if (scan.error && !scan.events.length) {
      state.live = { mode: "error", events: [], error: scan.error, pages: 0, at: new Date().toISOString() };
      return;
    }
    scan.events.forEach((e) => { e._source = q; e._live = true; });
    state.live = { mode: "live", events: scan.events, error: scan.error || null, pages: scan.pages, at: new Date().toISOString() };
    // Series metadata gives us categories for classification; best-effort.
    return scan;
  }

  /** Rows for the tables: live rows merged over the snapshot, restricted to the 5 topics. */
  function eventRows() {
    const snapEvents = (state.snapshot.events || []).map((e) => ({ ...e, _source: e.source, _origin: "snapshot" }));
    const merged = state.live.mode === "live" && state.live.events.length ? K.mergeEvents(snapEvents, state.live.events) : snapEvents;
    const ranked = K.rankEvents(merged, { preclassified: true, topics: state.topics.length ? K.TOPICS.map((t) => t.id) : undefined });
    return ranked
      .map((r) => ({ ...r.event, _m: r.metrics, _topic: r.topic, _basis: r.basis, _origin: r.event._origin || "snapshot" }))
      .filter((r) => !state.topics.length || state.topics.includes(r._topic));
  }

  function allMarkets(rows) {
    const out = [];
    for (const e of rows) {
      for (const m of e.markets || []) {
        out.push({ ...m, event_ticker: e.event_ticker, series_ticker: e.series_ticker, title_event: e.title, _topic: e._topic, _source: e._source, _origin: e._origin, _event: e });
      }
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * generic table with sorting + source column
   * ------------------------------------------------------------------ */
  function dataTable(spec) {
    const { columns, rows, emptyText } = spec;
    let sort = spec.defaultSort || null;
    const table = el("table", { class: "data" });
    const thead = el("thead");
    const hrow = el("tr");
    columns.forEach((c) => {
      const th = el("th", {
        class: (c.numeric ? "n " : "") + (c.sort !== false ? "sortable" : ""),
        scope: "col",
        text: c.label,
        onclick: c.sort === false ? null : () => {
          const dir = sort && sort.key === c.key && sort.dir === "desc" ? "asc" : "desc";
          sort = { key: c.key, dir };
          [...hrow.children].forEach((th2) => th2.removeAttribute("data-dir"));
          th.setAttribute("data-dir", dir);
          paint();
        },
      });
      hrow.append(th);
    });
    thead.append(hrow);
    const tbody = el("tbody");
    table.append(thead, tbody);

    function paint() {
      let data = rows.slice();
      if (sort) {
        const val = (r) => {
          const v = sort.get ? sort.get(r) : r[sort.key];
          return typeof v === "string" ? v.toLowerCase() : v;
        };
        data.sort((a, b) => {
          const av = val(a); const bv = val(b);
          if (av === bv) return 0;
          if (av === null || av === undefined) return 1;
          if (bv === null || bv === undefined) return -1;
          return (sort.dir === "asc" ? 1 : -1) * (av > bv ? 1 : -1);
        });
      }
      tbody.textContent = "";
      if (!data.length) { tbody.append(el("tr", {}, el("td", { colspan: String(columns.length), class: "empty", text: emptyText || "No rows." }))); return; }
      data.forEach((r, i) => {
        const tr = el("tr", { dataset: { key: r.id || i } });
        columns.forEach((c) => {
          const cell = c.render ? c.render(r, i) : document.createTextNode(String(r[c.key] ?? "—"));
          tr.append(el("td", { class: c.numeric ? "n" : c.class || "" }, cell));
        });
        tbody.append(tr);
      });
    }
    paint();
    return el("div", { class: "table-scroll" }, table);
  }

  const csvOf = (columns, rows) =>
    [columns.map((c) => c.label).join(",")]
      .concat(rows.map((r) => columns.map((c) => {
        const v = c.csv ? c.csv(r) : r[c.key];
        const s = v === null || v === undefined ? "" : String(v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(",")))
      .join("\n");

  function download(name, text, type) {
    const a = el("a", { href: URL.createObjectURL(new Blob([text], { type: type || "text/csv;charset=utf-8" })), download: name });
    document.body.append(a); a.click(); a.remove();
  }

  /* ------------------------------------------------------------------ *
   * chart (SVG candles + volume, hover readout)
   * ------------------------------------------------------------------ */
  function candleChart(candles, opts) {
    const o = opts || {};
    const W = 900; const H = 300; const VH = 56;
    if (!candles.length) return el("div", { class: "empty", text: "No candles in range." });
    const pts = candles.map((c) => ({ x: c.end_period_ts, y: c.close === undefined ? null : c.close }));
    const scale = K.chartScales(candles.map((c) => ({ x: c.end_period_ts, y: c.high })), {
      width: W, height: H - VH, padL: 56, padR: 14, padT: 12, padB: 6,
      yDomain: [Math.max(0, Math.min(...candles.map((c) => c.low).filter((v) => v !== null)) - 0.02), Math.min(1, Math.max(...candles.map((c) => c.high).filter((v) => v !== null)) + 0.02)],
    });
    if (!scale) return el("div", { class: "empty", text: "Candles have no priced points." });
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "chart");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const mk = (t, at) => { const n = document.createElementNS(NS, t); Object.entries(at).forEach(([k, v]) => n.setAttribute(k, v)); return n; };

    const grid = mk("g", { class: "grid" });
    scale.yTicks.forEach((t) => grid.append(mk("line", { x1: scale.padL, x2: W - scale.padR, y1: scale.y(t), y2: scale.y(t) })));
    svg.append(grid);

    const axis = mk("g", { class: "axis" });
    scale.yTicks.forEach((t) => {
      axis.append(mk("text", { x: scale.padL - 8, y: scale.y(t) + 3, "text-anchor": "end" }));
      axis.lastChild.textContent = "$" + t.toFixed(2);
    });
    const step = Math.max(1, Math.floor(candles.length / 7));
    candles.forEach((c, i) => {
      if (i % step) return;
      const t = mk("text", { x: scale.x(c.end_period_ts), y: scale.padT + scale.plotH + 14, "text-anchor": "middle" });
      t.textContent = fmtTime(c.end_period_ts, o.unit);
      axis.append(t);
    });
    axis.append(mk("text", { x: scale.padL, y: 10, class: "axis-title" }));
    axis.lastChild.textContent = "Y: contract price (USD, 0-1)";
    svg.append(axis);

    const band = Math.max(2, Math.min(16, (W - scale.padL - scale.padR) / candles.length - 3));
    candles.forEach((c) => {
      const up = c.close >= (c.open === null ? c.close : c.open);
      const cx = scale.x(c.end_period_ts);
      if (c.high !== null && c.low !== null) svg.append(mk("line", { class: "wick " + (up ? "candle-up" : "candle-down"), x1: cx, x2: cx, y1: scale.y(c.high), y2: scale.y(c.low), stroke: up ? "#177245" : "#b3261e" }));
      if (c.open !== null && c.close !== null) {
        const y1 = scale.y(Math.max(c.open, c.close)); const y2 = scale.y(Math.min(c.open, c.close));
        svg.append(mk("rect", { class: up ? "candle-up" : "candle-down", x: cx - band / 2, y: y1, width: band, height: Math.max(1, y2 - y1) }));
      }
      const vMax = Math.max(...candles.map((x) => x.volume || 0), 1);
      svg.append(mk("rect", { class: "vol", x: cx - band / 2, y: H - (c.volume / vMax) * VH, width: band, height: Math.max(0.5, (c.volume / vMax) * VH) }));
    });

    const shell = el("div", { class: "chart-shell" }, [svg]);
    if (o.readout !== false) {
      const tip = el("div", { class: "tooltip" });
      shell.append(tip);
      svg.addEventListener("pointermove", (ev) => {
        const r = svg.getBoundingClientRect();
        const xi = ((ev.clientX - r.left) / r.width) * W;
        let best = candles[0]; let bd = Infinity;
        for (const c of candles) { const d = Math.abs(scale.x(c.end_period_ts) - xi); if (d < bd) { bd = d; best = c; } }
        tip.classList.add("on");
        tip.style.left = (scale.x(best.end_period_ts) / W) * r.width + "px";
        tip.style.top = (scale.y(best.high === null ? best.close : best.high) / H) * r.height + "px";
        tip.textContent = `${fmtFull(best.end_period_ts)} · O ${fmt4(best.open)} H ${fmt4(best.high)} L ${fmt4(best.low)} C ${fmt4(best.close)} · vol ${K.count(best.volume)}`;
      });
      svg.addEventListener("pointerleave", () => tip.classList.remove("on"));
    }
    return shell;
  }

  const fmtTime = (sec, unit) => {
    const d = new Date(sec * 1000);
    const p = (n) => String(n).padStart(2, "0");
    if (unit === "days") return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
    return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
  };
  const fmtFull = (sec) => new Date(sec * 1000).toISOString().replace("T", " ").slice(0, 19) + "Z";
  const fmt4 = (v) => (v === null || v === undefined ? "—" : Number(v).toFixed(4));

  /* ------------------------------------------------------------------ *
   * controls shared by dashboard / markets
   * ------------------------------------------------------------------ */
  function topicChips(onChange) {
    return el("div", { class: "controls" }, [
      el("span", { class: "kicker", text: "Topics" }),
      ...K.TOPICS.map((t) => {
        const b = el("button", { class: "chip", type: "button", "aria-pressed": String(state.topics.includes(t.id)) }, t.label);
        b.addEventListener("click", () => {
          state.topics = state.topics.includes(t.id) ? state.topics.filter((x) => x !== t.id) : [...state.topics, t.id];
          if (!state.topics.length) state.topics = K.TOPICS.map((x) => x.id);
          LS.set("topics", state.topics);
          b.setAttribute("aria-pressed", String(state.topics.includes(t.id)));
          onChange();
        });
        return b;
      }),
      el("label", { style: "margin-left:auto" }, [
        "Environment ",
        (() => {
          const sel = el("select", { id: "env-select" }, K.BASES.map((b) => el("option", { value: b.rest, selected: b.rest === state.base }, b.label + (b.verified ? "" : " (not exercised)"))));
          sel.addEventListener("change", () => { state.base = sel.value; LS.set("base", sel.value); onChange(); });
          return sel;
        })(),
      ]),
    ]);
  }

  /* ------------------------------------------------------------------ *
   * page: dashboard
   * ------------------------------------------------------------------ */
  function renderDashboard() {
    const mount = document.getElementById("mount-events");
    const kpi = document.getElementById("mount-kpis");
    const res = document.getElementById("mount-resolutions");
    if (!mount) return;

    const rows = eventRows();
    const markets = allMarkets(rows);
    const liveSum = rows.reduce((a, r) => a + (r._m.dollarVolumeEstimate || 0), 0);
    const resolved = rows.filter((r) => r._m.resolution.complete);
    const partial = rows.filter((r) => r._m.resolution.settled > 0 && !r._m.resolution.complete);
    const yes = resolved.filter((r) => r._m.resolution.yes > 0).length;

    if (kpi) {
      kpi.textContent = "";
      kpi.append(
        kpiCard("Events in scope", String(rows.length), `topics: ${state.topics.join(", ")} · ${state.live.mode === "live" ? `live scan, ${state.live.pages} page(s)` : "captured snapshot"}`),
        kpiCard("Est. dollar volume", K.usd(liveSum, 0), "Σ volume_fp × last price per market — an estimate, see FL-1"),
        kpiCard("Markets tracked", String(markets.length), `${markets.filter((m) => m.result === "yes" || m.result === "no").length} resolved yes/no`),
        kpiCard("Events fully resolved", String(resolved.length), `${partial.length} still open with partial settlements · ${yes} contained a YES leg`),
        kpiCard("Contracts at top of book", K.count(markets.reduce((a, m) => a + ((K.num(m.yes_bid_size_fp) || 0) + (K.num(m.yes_ask_size_fp) || 0)), 0)), "resting YES size on the captured touch quotes")
      );
    }

    const columns = [
      { key: "title", label: "Event", sort: true, render: (r) => el("span", {}, [
        el("a", { href: `markets.html?event=${encodeURIComponent(r.event_ticker)}`, text: r.title || r.event_ticker }),
        el("div", {}, el("span", { class: "topic-tag", text: (r._topic || "?") + " · " + r.event_ticker })),
      ]) },
      { key: "dollars", label: "Est. $ volume", numeric: true, sort: true, get: (r) => r._m.dollarVolumeEstimate, render: (r) => el("span", {}, [
        K.usd(r._m.dollarVolumeEstimate, 2),
        r._m.dollarVolumeIsFloor ? el("span", { class: "badge warn", title: "one or more markets had no usable volume field; this is a lower bound", text: "floor" }) : null,
      ]), csv: (r) => (r._m.dollarVolumeEstimate === null ? "" : r._m.dollarVolumeEstimate) },
      { key: "contracts", label: "Contracts", numeric: true, sort: true, get: (r) => r._m.contracts, render: (r) => K.count(r._m.contracts), csv: (r) => r._m.contracts },
      { key: "oi", label: "Open interest", numeric: true, sort: true, get: (r) => r._m.openInterest, render: (r) => K.count(r._m.openInterest), csv: (r) => r._m.openInterest },
      { key: "liq", label: "Top-of-book", numeric: true, sort: true, get: (r) => r._m.topOfBookContracts, render: (r) => K.count(r._m.topOfBookContracts), csv: (r) => r._m.topOfBookContracts },
      { key: "markets", label: "Legs", numeric: true, render: (r) => `${r._m.resolution.settled}/${r._m.marketsTracked}` },
      { key: "outcome", label: "Resolution", render: (r) => {
        const x = r._m.resolution;
        if (!x.settled) return el("span", { class: "badge open", text: "open" });
        if (x.complete) return el("span", {}, [el("span", { class: "badge " + (x.yes ? "yes" : "no"), text: x.yes ? `${x.yes} YES` : "all NO" }), ` · ${x.totalMarkets} legs`]);
        return el("span", {}, [el("span", { class: "badge warn", text: `partial ${x.settled}/${x.totalMarkets}` }), " ", el("span", { class: "dim", text: `${x.yes}y/${x.no}n` })]);
      } },
      { key: "close", label: "Closes", render: (r) => (r._m.closeTime ? el("span", { class: "tick", text: r._m.closeTime.slice(0, 16).replace("T", " ") + "Z" }) : el("span", { class: "dim", text: "—" })) },
      { key: "origin", label: "Source", class: "src", sort: false, render: (r) => el("span", {}, [srcLink(r._source, r._origin === "live" ? "live query" : "snapshot"), r._basis ? el("div", {}, el("span", { class: "dim", style: "font-size:10.5px", text: r._basis })) : null]) },
    ];

    mount.textContent = "";
    const card = el("div", { class: "card" }, [
      el("h2", {}, [
        "Highest dollar-volume live events",
        el("span", { class: "sub", text: "ranked by estimated dollar turnover; filter to the five topics the brief asks for" }),
        el("span", { style: "margin-left:auto", class: "row-end" }, [
          el("button", { class: "btn", type: "button", onclick: async () => { setConn("live", "scanning…"); await goLive(); setConn(state.live.mode, state.live.pages ? `${state.live.pages} pages` : null); renderDashboard(); } }, "Scan live API now"),
          el("button", { class: "btn", type: "button", onclick: () => download("kalshi-events.csv", csvOf(columns, rows)) }, "Export CSV"),
        ]),
      ]),
      topicChips(() => renderDashboard()),
      el("div", { class: "body tight" }, dataTable({ columns, rows, emptyText: "No events match the current topic filter.", defaultSort: { key: "dollars", dir: "desc", get: (r) => r._m.dollarVolumeEstimate } })),
    ]);
    mount.append(
      state.live.mode === "error"
        ? el("div", { class: "notice warn" }, [
          el("h4", { text: "Live scan could not reach " + state.base }),
          "The browser request failed (", el("code", { text: state.live.error || "unknown error" }),
          "). A blocked cross-origin read and an offline network look identical to page code, so this cannot be distinguished from the client. Showing the captured snapshot instead; ",
          el("a", { href: "flagged.html#fl-2", text: "see FL-2" }), ".",
        ])
        : null,
      card,
      marketsTable(markets)
    );

    if (res) {
      res.textContent = "";
      const rcols = [
        { key: "event", label: "Event", render: (r) => el("span", {}, [r.title, el("div", {}, el("span", { class: "topic-tag", text: r.event_ticker }))]) },
        { key: "legs", label: "Legs settled", numeric: true, render: (r) => `${r._m.resolution.settled}/${r._m.resolution.totalMarkets}` },
        { key: "outcomes", label: "Per-leg outcome", render: (r) => el("div", { style: "display:flex;gap:5px;flex-wrap:wrap" }, (r.markets || []).map((m) => el("span", { class: "badge " + (m.result === "yes" ? "yes" : m.result === "no" ? "no" : "open"), title: m.ticker, text: (m.yes_sub_title || m.ticker.split("-").pop()) + ": " + (m.result || "open") }))) },
        { key: "settle", label: "Settled", render: (r) => (r._m.resolution.lastSettlementTs ? el("span", { class: "tick", text: r._m.resolution.lastSettlementTs.slice(0, 19).replace("T", " ") + "Z" }) : el("span", { class: "dim", text: "—" })) },
        { key: "payout", label: "Payout/contract", render: (r) => {
          const vals = (r.markets || []).map((m) => K.num(m.settlement_value_dollars)).filter((v) => v !== null);
          return vals.length ? el("span", { class: "tick", text: vals.map((v) => "$" + v.toFixed(4)).join(" / ") }) : el("span", { class: "dim", text: "—" });
        } },
        { key: "watch", label: "Still open", render: (r) => (r._m.resolution.pending.length ? el("span", { class: "dim", text: r._m.resolution.pending.join(", ") }) : el("span", { class: "badge muted", text: "tracking closed" })) },
        { key: "src", label: "Source", class: "src", sort: false, render: (r) => srcLink(r._source) },
      ];
      res.append(el("div", { class: "card" }, [
        el("h2", {}, ["Resolution tracker", el("span", { class: "sub", text: "an event stops being tracked only when every market in it has a yes/no result" })]),
        el("div", { class: "body tight" }, dataTable({
          columns: rcols,
          rows: rows.filter((r) => r._m.resolution.settled > 0 || r._m.resolution.pending.length),
          emptyText: "No events with settlements yet.",
        })),
      ]));
    }
  }

  function marketsTable(markets) {
    const cols = [
      { key: "ticker", label: "Market", render: (r) => el("a", { href: `markets.html?market=${encodeURIComponent(r.ticker)}`, class: "mono", text: r.ticker }) },
      { key: "title", label: "Question", render: (r) => r.title || "—" },
      { key: "bid", label: "YES bid", numeric: true, render: (r) => K.usd(K.num(r.yes_bid_dollars), 4), csv: (r) => r.yes_bid_dollars || "" },
      { key: "ask", label: "YES ask", numeric: true, render: (r) => K.usd(K.num(r.yes_ask_dollars), 4), csv: (r) => r.yes_ask_dollars || "" },
      { key: "spread", label: "Spread", numeric: true, render: (r) => { const q = K.quote(r); return q.spread === null ? "—" : cents4(q.spread); } },
      { key: "size", label: "Bid size", numeric: true, render: (r) => K.count(K.num(r.yes_bid_size_fp)) },
      { key: "vol", label: "Volume", numeric: true, render: (r) => K.count(K.num(r.volume_fp)) },
      { key: "oi", label: "OI", numeric: true, render: (r) => K.count(K.num(r.open_interest_fp)) },
      { key: "result", label: "Result", render: (r) => (r.result === "yes" ? el("span", { class: "badge yes", text: "YES" }) : r.result === "no" ? el("span", { class: "badge no", text: "NO" }) : el("span", { class: "badge open", text: r.status || "open" })) },
      { key: "turn", label: "Est. $", numeric: true, render: (r) => K.usd(K.turnoverEstimate(r), 2) },
      { key: "src", label: "Source", class: "src", sort: false, render: (r) => srcLink(r._source) },
    ];
    const cents4 = (v) => (v === null ? "—" : "$" + v.toFixed(4));
    return el("div", { class: "card", id: "all-markets" }, [
      el("h2", {}, ["Every market in scope", el("span", { class: "sub", text: `${markets.length} legs · click a ticker for price history and depth` })]),
      el("div", { class: "body tight" }, dataTable({ columns: cols, rows: markets, defaultSort: { key: "vol", dir: "desc", get: (r) => K.num(r.volume_fp) } })),
    ]);
  }

  const kpiCard = (label, value, note) =>
    el("div", { class: "kpi" }, [el("div", { class: "label", text: label }), el("div", { class: "value", text: value }), note ? el("div", { class: "note", text: note }) : null]);

  /* ------------------------------------------------------------------ *
   * page: markets (price + liquidity explorer)
   * ------------------------------------------------------------------ */
  function renderMarkets() {
    const mount = document.getElementById("mount-explorer");
    if (!mount) return;
    const rows = eventRows();
    const markets = allMarkets(rows);
    const qs = new URLSearchParams(location.search);
    const wanted = qs.get("market") || qs.get("event") || "";
    const current = markets.find((m) => m.ticker === wanted) || markets.find((m) => m.event_ticker === wanted) || markets[0];
    if (!current) { mount.textContent = ""; mount.append(el("div", { class: "empty", text: "No markets in scope — widen the topic filter." })); return; }

    let gran = state.settings.charts || "minutes";
    const seriesFor = (m) => (m.series_ticker || m.ticker.split("-")[0]);

    const chartCard = el("div", { class: "card" }, el("h2", { text: "Price history" }));
    const depthCard = el("div", { class: "card" }, el("h2", { text: "Liquidity at a price" }));
    const readout = el("div", { class: "price-focus" });

    function candlesFor(m) {
      const rec = state.snapshot.candlesticks || {};
      if (rec.ticker === m.ticker) return { src: "captured 1-minute candles", candles: K.resample(rec.candles, gran === "seconds" ? 60 : gran === "minutes" ? 60 : gran === "hours" ? 3600 : 86400) };
      return { src: null, candles: [] };
    }

    function paint() {
      chartCard.textContent = "";
      depthCard.textContent = "";
      const picker = el("select", { "aria-label": "market" }, markets.slice(0, 400).map((m) => el("option", { value: m.ticker, selected: m.ticker === current.ticker }, `${m.event_ticker} · ${m.yes_sub_title || m.title || ""}`)));
      const granSel = el("select", { "aria-label": "time axis granularity" }, K.GRANULARITIES.map((g) => el("option", { value: g.id, selected: g.id === gran }, g.label)));
      const note = el("span", { class: "dim", style: "font-size:12px" });
      picker.onchange = () => { location.search = "?market=" + encodeURIComponent(picker.value); };
      granSel.onchange = () => { gran = granSel.value; state.settings.charts = gran; LS.set("settings", state.settings); paint(); };

      chartCard.append(
        el("h2", {}, ["Price history", el("span", { class: "sub", text: "X = time (UTC), Y = YES contract price in dollars" }), el("span", { style: "margin-left:auto", class: "row-end" }, [granSel, picker,
          el("a", { class: "btn", href: `https://kalshi.com/markets/${encodeURIComponent(current.event_ticker.toLowerCase())}`, target: "_blank", rel: "noopener", text: "open on kalshi.com" })])]),
        el("div", { class: "controls", style: "border-top:0" }, [
          el("span", { class: "kicker", text: "market" }),
          el("code", { text: current.ticker }),
          el("span", { class: "dim", text: "· " + (current.title || "") }),
        ])
      );

      const { candles, src } = candlesFor(current);
      if (!candles.length) {
        const built = K.candlestickUrl({ base: state.base, seriesTicker: seriesFor(current), ticker: current.ticker, startTs: Math.floor(Date.now() / 1000) - 3600, endTs: Math.floor(Date.now() / 1000), granularityId: gran });
        chartCard.append(el("div", { class: "body" }, [
          el("div", { class: "notice info" }, [
            "No price history for this market in the captured snapshot. The live request that would fill it is ",
            el("code", { text: built.url || "(blocked: " + (built.error || "") + ")" }),
            built.error ? el("div", {}, el("strong", { text: "Builder refused: " + built.error })) : null,
            el("div", { class: "dim", style: "margin-top:6px" }, "Only the 15-minute BTC market captured at 11:11Z has recorded candles — pick it from the dropdown, or run the live scan from the dashboard."),
          ]),
        ]));
      } else {
        const body = el("div", { class: "body" });
        body.append(candleChart(candles, { unit: gran === "days" ? "days" : "time" }));
        body.append(el("div", { class: "dim", style: "font-size:12px;margin-top:8px" }, [
          `${candles.length} bucket(s) · ${src} · period ${gran === "seconds" ? "60s (sub-minute data does not exist in REST)" : gran === "minutes" ? "1 min" : gran === "hours" ? "60 min" : "1440 min"} · `,
          "y-axis is the YES contract price; a settled YES pays $1.00, a NO pays $1.00 as (1 − yes price).",
        ]));
        chartCard.append(body);
      }
      if (gran === "seconds") {
        chartCard.append(el("div", { class: "body" }, el("div", { class: "notice warn" }, [
          el("strong", { text: "Seconds cannot come from the REST API. " }),
          "Candlesticks are offered at 1-minute, 1-hour and 1-day periods only (",
          srcLink(K.SOURCES.candlesticks, "Get Market Candlesticks"),
          "). This view is bucketed to 60 seconds from those candles. True sub-second ticks need the WebSocket feed — ",
          el("code", { text: "cfbenchmarks_value_5hz" }),
          ", ", el("code", { text: "trade" }),
          " or ", el("code", { text: "ticker" }),
          " (", srcLink(K.SOURCES.websocket, "WebSocket connection"),
          ") — and the socket requires an authenticated handshake, which a static page cannot perform (see ",
          el("a", { href: "flagged.html#fl-3", text: "FL-3" }), ").",
        ])));
      }
      note.textContent = state.live.mode === "live" ? "live candles are fetched on demand" : "snapshot mode";

      /* ---- liquidity ladder ---- */
      const q = K.quote(current);
      const bookLike = state.snapshot.orderbook && state.snapshot.orderbook.ticker === current.ticker ? state.snapshot.orderbook : null;
      const derived = {
        orderbook_fp: {
          yes_dollars: q.bid !== null && q.bid > 0 && q.bidSize ? [[String(q.bid.toFixed(4)), String(q.bidSize)]] : [],
          no_dollars: (() => {
            const noBid = K.num(current.no_bid_dollars);
            const ask = q.ask;
            if (noBid && noBid > 0) return [[String(noBid.toFixed(4)), String(q.askSize || 0)]];
            if (ask !== null && ask < 1) return [[String((1 - ask).toFixed(4)), String(q.askSize || 0)]];
            return [];
          })(),
        },
      };
      // Prefer a captured full book when it has depth; otherwise derive two levels
      // from the touch quotes in GET /markets so the ladder still shows real size.
      const capturedHasDepth = !!bookLike && !!((bookLike.yes_dollars || []).length || (bookLike.no_dollars || []).length);
      const lad = K.ladder(capturedHasDepth ? bookLike : derived);
      const ladderRows = lad.rows.slice().sort((a, b) => b.price - a.price)
        .map((r) => ({ price: r.price, yesBid: r.yesBid, noBid: r.noBid }));
      let focus = Math.round(((q.mid === null ? K.num(current.last_price_dollars) ?? 0.5 : q.mid)) * 100) / 100;
      const maxC = Math.max(1, ...ladderRows.flatMap((r) => [r.yesBid, r.noBid]));

      const slider = el("input", { type: "range", min: "0", max: "100", step: "1", value: String(Math.round(focus * 100)), style: "width:260px" });
      const walkOut = el("span", {});
      const atOut = el("span", {});
      const sizeIn = el("input", { type: "number", min: "1", step: "1", value: "100", style: "width:90px" });
      const recalc = () => {
        focus = Number(slider.value) / 100;
        const at = K.atPrice(lad, focus);
        atOut.textContent = `${at.yesBid} YES / ${at.noBid} NO contracts resting at $${focus.toFixed(2)}`;
        const walk = K.walkBook(lad, { side: "buy", outcome: "yes", contracts: Number(sizeIn.value) || 1 });
        walkOut.textContent = walk && walk.filled
          ? `taking ${walk.filled} contract(s): avg $${walk.averagePrice.toFixed(4)}, slippage ${K.usd(walk.slippage, 4)}, fee $${(walk.fee || 0).toFixed(2)}${walk.fullyFillable ? "" : ` (only ${walk.filled} fillable, ${walk.unfilled} unfilled)`}`
          : "no resting depth to take — you would be the first order at any price";
      };
      slider.oninput = recalc; sizeIn.oninput = recalc;

      depthCard.append(
        el("h2", {}, ["Liquidity at a price", el("span", { class: "sub", text: capturedHasDepth ? "captured order book" : "ladder built from the touch quotes in GET /markets; the full book needs one more request per market"}), el("span", { style: "margin-left:auto" }, note)]),
        el("div", { class: "body" }, [
          el("table", { class: "data ladder" }, [
            el("thead", {}, el("tr", {}, [el("th", { text: "price (YES)" }), el("th", { class: "n", text: "YES bids resting" }), el("th", { class: "n", text: "NO bids resting" }), el("th", { text: "depth" })])),
            el("tbody", {}, ladderRows.length
              ? ladderRows.map((r) => el("tr", {}, [
                el("td", { class: "tick", text: "$" + r.price.toFixed(4) + (Math.abs(r.price - focus) < 0.005 ? " ◀" : "") }),
                el("td", { class: "n", text: K.count(r.yesBid) }),
                el("td", { class: "n", text: K.count(r.noBid) }),
                el("td", {}, [el("span", { class: "bar yes", style: `width:${Math.max(1, (r.yesBid / maxC) * 130)}px` }), " ", el("span", { class: "bar no", style: `width:${Math.max(1, (r.noBid / maxC) * 130)}px` })]),
              ]))
              : [el("tr", {}, el("td", { colspan: "4", class: "empty", text: "No resting orders were reported for this market at capture — both sides empty." }))]),
          ]),
          el("div", { class: "price-focus" }, [
            el("label", {}, ["Price ", slider, el("output", { text: "$" + focus.toFixed(2) })]),
            el("label", {}, ["Contracts ", sizeIn]),
            atOut, " · ", walkOut,
          ]),
          el("div", { class: "dim", style: "font-size:12px;margin-top:8px" }, [
            "A NO bid at price Y is a YES ask at $1.00 − Y, so asks are derived, not read (",
            srcLink(K.SOURCES.orderbook, "Orderbook Responses"), "). ",
            "Fees use the published taker formula 0.07 × C × P × (1 − P) rounded up (",
            srcLink(K.SOURCES.feeSchedule, "fee schedule"), ").",
          ]),
        ])
      );
      recalc();

      mount.textContent = "";
      mount.append(
        el("div", { class: "grid cols-4" }, [
          kpiCard("Last price", K.usd(K.num(current.last_price_dollars), 4), "last traded YES"),
          kpiCard("Bid / ask", `${fmt4(q.bid)} / ${fmt4(q.ask)}`, q.twoSided ? "two-sided" : "one-sided quote"),
          kpiCard("Est. dollar volume", K.usd(K.turnoverEstimate(current), 2), "volume_fp × last price"),
          kpiCard("Status", current.result ? `resolved ${current.result}` : current.status || "—", current.settlement_ts ? "settled " + current.settlement_ts.slice(0, 19) : "unresolved"),
        ]),
        chartCard,
        depthCard,
        el("div", { class: "card" }, [
          el("h3", {}, ["Contract rules", el("span", { class: "sub", text: "quoted from the API response — this is what determines yes/no" })]),
          el("div", { class: "body" }, [
            el("p", { style: "margin-top:0", text: current.rules_primary || "—" }),
            el("div", { class: "row-end" }, [
              el("span", { class: "dim", text: `strike ${current.strike_type || "—"} · settlement timer ${current.settlement_timer_seconds === undefined ? "—" : current.settlement_timer_seconds + "s"} · open ${current.open_time || "—"} → close ${current.close_time || "—"}` }),
              srcLink(current._source, "API row"),
            ]),
          ]),
        ])
      );
    }
    paint();
  }

  /* ------------------------------------------------------------------ *
   * page: portfolio (paper replay)
   * ------------------------------------------------------------------ */
  function renderPortfolio() {
    const mount = document.getElementById("mount-sim");
    if (!mount) return;
    const rec = state.snapshot.candlesticks || {};
    let strat = "longshot-decay";
    let contracts = 100;
    const run = () => {
      const s = K.STRATEGIES.find((x) => x.id === strat);
      const rules = {
        "longshot-decay": {
          entry: (c) => (num2(c.close) !== null && num2(c.close) <= 0.25 ? num2(c.close) : null),
          exit: (c) => (num2(c.close) !== null && num2(c.close) <= 0.05 ? num2(c.close) : null),
        },
        "favorite-drift": {
          entry: (c) => (num2(c.close) !== null && num2(c.close) >= 0.6 ? num2(c.close) : null),
          exit: (c) => (num2(c.close) !== null && num2(c.close) >= 0.99 ? num2(c.close) : null),
        },
      }[s.id] || {};
      const sim = K.replaySim(K.resample(rec.candles || [], 60), rules, { contracts, role: "taker" });
      paint(sim, s);
    };
    function paint(sim, s) {
      mount.textContent = "";
      const stratSel = el("select", {}, K.STRATEGIES.filter((x) => x.observableNow).map((x) => el("option", { value: x.id, selected: x.id === s.id }, x.label)));
      stratSel.onchange = () => { strat = stratSel.value; run(); };
      const sizeIn = el("input", { type: "number", min: "1", value: String(contracts) });
      sizeIn.oninput = () => { contracts = Math.max(1, Number(sizeIn.value) || 1); run(); };
      const cols = [
        { key: "entryTs", label: "Entry (UTC)", render: (r) => el("span", { class: "tick", text: fmtFull(r.entryTs) }) },
        { key: "exitTs", label: "Exit (UTC)", render: (r) => el("span", { class: "tick", text: fmtFull(r.exitTs) }) },
        { key: "entryPrice", label: "In", numeric: true, render: (r) => "$" + r.entryPrice.toFixed(4) },
        { key: "exitPrice", label: "Out", numeric: true, render: (r) => "$" + r.exitPrice.toFixed(4) },
        { key: "contracts", label: "Contracts", numeric: true, render: (r) => K.count(r.contracts) },
        { key: "grossPnl", label: "Gross P&L", numeric: true, render: (r) => signed(r.grossPnl) },
        { key: "fees", label: "Fees", numeric: true, render: (r) => el("span", { class: "dim", text: "−$" + r.fees.toFixed(2) }) },
        { key: "netPnl", label: "Net P&L", numeric: true, render: (r) => signed(r.netPnl) },
        { key: "heldToFinalCandle", label: "Note", render: (r) => (r.heldToFinalCandle ? el("span", { class: "badge warn", text: "marked at last candle" }) : el("span", { class: "badge muted", text: "rule exit" })) },
      ];
      mount.append(el("div", { class: "card" }, [
        el("h2", {}, ["Replay simulator", el("span", { class: "sub", text: sim.basis })]),
        el("div", { class: "controls" }, [el("label", {}, ["Strategy ", stratSel]), el("label", {}, ["Contracts ", sizeIn]),
          el("span", { class: "dim", style: "margin-left:auto;font-size:12px", text: `market ${rec.ticker || "—"} · ${K.resample(rec.candles || [], 60).length} one-minute candles from the 11:11Z capture` }),
          el("button", { class: "btn", type: "button", onclick: () => download("replay-trades.csv", csvOf(cols, sim.trades)) }, "Export")]),
        el("div", { class: "grid cols-4", style: "padding:14px 16px" }, [
          kpiCard("Round trips", String(sim.counts.trades), `${sim.counts.wins} up · ${sim.counts.losses} down`),
          kpiCard("Gross", signed(sim.totals.gross), "before fees"),
          kpiCard("Fees paid", "−$" + sim.totals.fees.toFixed(2), "taker formula both legs"),
          kpiCard("Net", signed(sim.totals.net), "1 contract ≈ $1 payout side"),
        ]),
        el("div", { class: "body tight" }, dataTable({ columns: cols, rows: sim.trades, emptyText: "No candle in the captured range satisfied the entry rule — that is a legitimate result, not a missing number." })),
      ]));
    }
    run();
  }
  const num2 = (v) => (v === null || v === undefined ? null : Number(v));
  const signed = (v) => el("span", { style: `color:${v > 0 ? "var(--yes)" : v < 0 ? "var(--no)" : "inherit"};font-weight:600`, text: (v > 0 ? "+$" : v < 0 ? "−$" : "$") + Math.abs(v).toFixed(2) });

  /* ------------------------------------------------------------------ *
   * page: suggestions
   * ------------------------------------------------------------------ */
  const SUGGESTIONS = [
    { id: "S-1", title: "Publish an exact dollar-volume figure (or accept the proxy explicitly)", area: "data", impact: "high", effort: "M", why: "The brief ranks by dollar amount, but Kalshi's market payload only exposes contract counts (volume_fp). Every ranking on this site is therefore an estimate built as volume × last price.", action: "Compute turnover from GET /trades (Σ price × count) in the collector and cache it per event, or formally adopt the proxy and label it in every table header.", evidence: [K.SOURCES.markets, "https://docs.kalshi.com/api-reference/market/get-trades.md"], blocks: "Decision confidence on 'which events matter most'" },
    { id: "S-2", title: "Stand up a tiny signed proxy for portfolio + WebSocket work", area: "architecture", impact: "high", effort: "S", why: "Portfolio reads, order placement and the WebSocket feed all require an authenticated handshake. A browser cannot send custom WS headers and must never hold a private key, so a static GitHub Pages site can only ever show public REST data.", action: "Run one small server-side component holding the demo key; keep the Pages site static and have it call the proxy for /portfolio/* and the WS bridge.", evidence: [K.SOURCES.websocket, K.SOURCES.apiKeys], blocks: "portfolio tracking, order placement, sub-minute streaming" },
    { id: "S-3", title: "Treat 15-minute crypto series as the live-tracking test bench", area: "product", impact: "med", effort: "S", why: "KXBTC15M resolves every 15 minutes with settlement_timer_seconds = 1 and settled about 4 seconds after close in the captured rows — no other topic gives that fast a full live→resolved loop to test against.", action: "Wire the resolution tracker, chart replay and alerting against KXBTC15M first, then extend to slower gas/election/golf series.", evidence: ["https://external-api.demo.kalshi.co/trade-api/v2/events?series_ticker=KXBTC15M&with_nested_markets=true&limit=3&status=settled"], blocks: "nothing — available now" },
    { id: "S-4", title: "Store the strategy tag in client_order_id at order time", area: "trading", impact: "med", effort: "S", why: "The categorisation the brief asks for (intent, role, horizon) is not derivable after the fact: fills come back without any strategy label, and the legacy action/side fields have been replaced by outcome_side/book_side.", action: "Adopt a `strat:<id>|topic:<t>|role:<maker|taker>` client_order_id convention so every fill is self-classifying and idempotent on retry.", evidence: [K.SOURCES.quickStartOrder, "https://docs.kalshi.com/getting_started/order_direction.md"], blocks: "trade categorisation quality later" },
    { id: "S-5", title: "Add a spread/depth gate before any live order", area: "risk", impact: "high", effort: "S", why: "In the capture, most non-crypto markets were quoted 0.00 / 1.00 with zero resting size, i.e. no executable liquidity at all. A naive 'buy the dip' rule would fill at absurd prices or not fill.", action: "Refuse to display a trade button unless top-of-book size × depth at the intended price covers the order, and show the slippage the walk produces.", evidence: ["https://docs.kalshi.com/api-reference/market/get-market-orderbook.md"], blocks: "safe order entry" },
    { id: "S-6", title: "Reconcile demo vs production catalog before drawing conclusions", area: "data", impact: "high", effort: "S", why: "The demo environment has only two Culture series, both with zero volume, and the biggest captured gas strike has 385 contracts of lifetime volume. Rankings, edges and liquidity from demo are not evidence about real markets.", action: "Add a one-click comparison run against the production REST host for the same series and publish the deltas side by side before any strategy decision.", evidence: [K.SOURCES.demoEnv, "https://external-api.kalshi.com/trade-api/v2/exchange/status"], blocks: "generalising any demo result" },
    { id: "S-7", title: "Cache and version the snapshot in git; refresh on a schedule", area: "ops", impact: "med", effort: "M", why: "Every number on this site is a point-in-time read of a cached API (the docs state prices can lag several seconds), so an undated table silently becomes wrong.", action: "Commit data/snapshot.json per run with its capture window, refresh from a scheduled job, and show the age in the header as a badge that turns amber past 15 minutes.", evidence: [K.SOURCES.markets], blocks: "auditability of past decisions" },
    { id: "S-8", title: "Handle the API's quirky empties explicitly in the UI", area: "robustness", impact: "med", effort: "S", why: "Observed during capture: GET /series with an unknown tag returns {\"series\":null}; an orderbook for a closed or mistyped ticker returns 200 with empty arrays rather than 404; /series ignores limit entirely. Naive code renders zeros or crashes.", action: "Keep 'no data' and 'zero' visually distinct (this site prints — for missing, 0.00 for real zeros) and unit-test those branches, as tests/kalshi.test.mjs already does.", evidence: ["https://docs.kalshi.com/getting_started/orderbook_responses.md", K.SOURCES.seriesList], blocks: "silent misreading of thin markets" },
    { id: "S-9", title: "Add alerting on resolution, not just price", area: "product", impact: "med", effort: "M", why: "The brief's core loop is 'track live events until they resolve'. Price alerts do not tell you an event flipped to yes/no; settlement_ts does.", action: "Poll GET /markets/{ticker} for a market inside its close window and raise an entry when result becomes non-empty, recording settlement_ts and settlement_value_dollars with the snapshot URL.", evidence: ["https://docs.kalshi.com/api-reference/market/get-market.md"], blocks: "nothing — design decided" },
    { id: "S-10", title: "Publish the questions register as a decision gate", area: "process", impact: "med", effort: "S", why: "Several high-value capabilities (real portfolio P&L, order execution, sub-second streaming) are blocked on information the project does not have yet: a demo API key, its private key, and confirmation of CORS/egress.", action: "Require each open question on questions.html to carry an owner and a decision before implementing the related feature; leave the answer blank rather than guessing.", evidence: ["questions.html"], blocks: "implementation sequencing" },
  ];

  function renderSuggestions() {
    const mount = document.getElementById("mount-suggestions");
    if (!mount) return;
    const decisions = LS.get("decisions", {});
    const counts = el("span", { class: "sub" });
    const repaint = () => {
      const done = Object.keys(decisions).filter((k) => decisions[k] && decisions[k].choice).length;
      counts.textContent = `${done} of ${SUGGESTIONS.length} reviewed`;
      mount.textContent = "";
      SUGGESTIONS.forEach((s) => {
        const cur = decisions[s.id] || {};
        const box = el("article", { class: "suggestion", dataset: { decision: cur.choice || "" }, id: s.id.toLowerCase() });
        const noteInput = el("input", { type: "text", placeholder: "note for the reviewer (saved locally)", style: "flex:1;min-width:220px", value: cur.note || "" });
        box.append(
          el("header", {}, [
            el("span", { class: "badge " + (s.impact === "high" ? "no" : "muted"), text: s.impact + " impact" }),
            el("span", { class: "badge open", text: "effort " + s.effort }),
            el("h3", {}, [s.title]),
            el("span", { class: "meta" }, [el("code", { text: s.id }), el("span", { text: s.area })]),
          ]),
          el("p", { class: "why", html: "<strong>Why:</strong> " + s.why }),
          el("p", { class: "why", html: "<strong>Suggested action:</strong> " + s.action }),
          el("p", { class: "why", html: "<strong>Blocks:</strong> " + s.blocks }),
          el("div", { class: "why" }, [el("span", { class: "kicker", text: "Evidence" }), " ", s.evidence.map((u) => (u.startsWith("flagged") || u.endsWith(".html") ? el("a", { href: u, text: u }) : srcLink(u, u.replace(/^https?:\/\//, "").slice(0, 46))))]),
          el("div", { class: "decision" }, [
            ...[["accepted", "Approve"], ["deferred", "Defer"], ["rejected", "Reject"]].map(([choice, label]) => {
              const b = el("button", { class: "btn" + (cur.choice === choice ? " primary" : ""), type: "button", text: label });
              b.onclick = () => {
                decisions[s.id] = { choice, at: new Date().toISOString(), note: noteInput.value || "" };
                LS.set("decisions", decisions);
                repaint();
              };
              return b;
            }),
            noteInput,
            el("span", { class: "dim", style: "font-size:12px", text: cur.choice ? `recorded ${String(cur.at).slice(0, 16)}Z` : "decisions stay in this browser; export to share" }),
          ])
        );
        mount.append(box);
      });
      mount.append(el("div", { class: "row-end", style: "margin-top:14px" }, [
        counts,
        el("button", { class: "btn", type: "button", onclick: () => download("suggestion-decisions.json", JSON.stringify(decisions, null, 2), "application/json") }, "Export decisions"),
        el("button", { class: "btn", type: "button", onclick: () => { Object.keys(decisions).forEach((k) => delete decisions[k]); LS.set("decisions", {}); repaint(); } }, "Clear"),
      ]));
    };
    repaint();
  }

  /* ------------------------------------------------------------------ *
   * boot
   * ------------------------------------------------------------------ */
  const PAGES = { dashboard: renderDashboard, markets: renderMarkets, portfolio: renderPortfolio, suggestions: renderSuggestions };

  async function boot() {
    buildShell();
    try {
      state.snapshot = await loadSnapshot();
    } catch (err) {
      document.querySelectorAll("[data-mount]").forEach((n) => { n.textContent = ""; n.append(el("div", { class: "notice stop", text: "Could not load data/snapshot.json (" + err.message + ")." })); });
      setConn("error", "snapshot missing");
      return;
    }
    setConn("snapshot", "captured " + (state.snapshot.capture_window_utc || "—"));
    const fn = PAGES[state.page];
    if (fn) {
      fn();
      if (state.settings.autoRefresh) {
        setInterval(async () => { await goLive(); setConn(state.live.mode, `${state.live.pages} pages`); fn(); }, Math.max(10, state.settings.intervalSec) * 1000);
      }
    }
    document.dispatchEvent(new CustomEvent("app:ready", { detail: state }));
  }

  window.__kalshiDemo = { state, K, el, dataTable, csvOf, download, goLive, eventRows, allMarkets, kpiCard, LS, srcLink, fmtFull, SUGGESTIONS };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
