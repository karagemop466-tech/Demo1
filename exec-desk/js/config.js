/* Kalshi Demo Dashboard — configuration
   All endpoints below are taken verbatim from official Kalshi docs:
   - https://docs.kalshi.com/getting_started/demo_env
   - https://docs.kalshi.com/getting_started/api_environments
   See docs/SOURCES.md (S2, S3). */
window.KALSHI_CONFIG = {
  // Recommended demo REST root (official). Alternate supported root kept as fallback host.
  demoRest: "https://external-api.demo.kalshi.co/trade-api/v2",
  demoRestAlt: "https://demo-api.kalshi.co/trade-api/v2",
  // Official demo WebSocket (requires signed handshake — see S5; not used without a key)
  demoWs: "wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2",
  demoWsAlt: "wss://demo-api.kalshi.co/trade-api/ws/v2",
  // Third-party CORS relay — FALLBACK ONLY, flagged as UNVERIFIED-03 on flagged.html.
  // Requests still target the official API URL; the relay only forwards them.
  relay: "https://api.allorigins.win/raw?url=",
  useRelayFallback: true,
  // Poll cadences (ms). Kept conservative vs official token-bucket limits (S19).
  pollMarkets: 15000,
  pollEvents: 30000,
  pollBook: 5000,
  pollQuote: 2000,
  // Ranking depth per topic
  topN: 10,
  // Topic keyword classifier (client-side; series `category` filter is exact/case-sensitive per S7,
  // and the official list of category strings is not published, so keywords are used transparently.)
  topics: {
    gas:      { label: "Gas prices",  kw: ["gas","gasoline","petrol","diesel","natural gas","lng","energy","oil","wti","brent"] },
    elections:{ label: "Elections",   kw: ["election","elections","president","presidential","senate","congress","governor","primary","caucus","vote","voting","ballot","democrat","republican","trump","house majority","senate majority"] },
    culture:  { label: "Culture",     kw: ["culture","entertainment","oscars","academy awards","grammy","grammys","emmy","grammy awards","movie","film","music","celebrity","box office","tv","television","broadway","met gala","fashion","award","awards","rap","artist","album","song","box-office"] },
    crypto:   { label: "Crypto",      kw: ["crypto","bitcoin","btc","ethereum","eth","solana","sol","xrp","dogecoin","doge","memecoin","blockchain","coin","coins","token","defi"] },
    golf:     { label: "Golf",        kw: ["golf","pga","pga tour","masters","open championship","ryder cup","tiger woods","fedex cup","scheffler","mcilroy","major championship","the players","tour championship"] }
  },
  // Official source links used inline (see docs/SOURCES.md)
  sources: {
    demo: "https://docs.kalshi.com/getting_started/demo_env",
    env: "https://docs.kalshi.com/getting_started/api_environments",
    marketData: "https://docs.kalshi.com/getting_started/quick_start_market_data",
    ws: "https://docs.kalshi.com/getting_started/quick_start_websockets",
    markets: "https://docs.kalshi.com/api-reference/market/get-markets",
    series: "https://docs.kalshi.com/api-reference/market/get-series-list",
    events: "https://docs.kalshi.com/api-reference/events/get-events",
    orderbook: "https://docs.kalshi.com/api-reference/market/get-market-orderbook",
    candles: "https://docs.kalshi.com/api-reference/market/get-market-candlesticks",
    settlement: "https://docs.kalshi.com/getting_started/market_settlement",
    balance: "https://docs.kalshi.com/api-reference/portfolio/get-balance",
    positions: "https://docs.kalshi.com/api-reference/portfolio/get-positions",
    settlements: "https://docs.kalshi.com/api-reference/portfolio/get-settlements",
    fills: "https://docs.kalshi.com/api-reference/portfolio/get-fills",
    orders: "https://docs.kalshi.com/api-reference/orders/get-orders",
    createOrder: "https://docs.kalshi.com/api-reference/orders/create-order-v2",
    keys: "https://docs.kalshi.com/getting_started/api_keys",
    rates: "https://docs.kalshi.com/getting_started/rate_limits",
    lifecycle: "https://docs.kalshi.com/getting_started/market_lifecycle",
    index: "https://docs.kalshi.com/llms.txt",
    feeSchedule: "https://kalshi.com/docs/kalshi-fee-schedule.pdf"
  },
  flags: [
    { id:"UNVERIFIED-01", title:"Browser CORS behavior — now evidenced for github.io, still unverified for other origins",
      detail:"Official docs do not document CORS. However, session arena-6aa291e9 recorded live response headers from the official demo API on 2026-11-20: Access-Control-Allow-Origin=https://karagemop466-tech.github.io (evidence file data/cors.json on main), and the deployed exec-desk confirmed it end-to-end: the connection badge read 'LIVE · official API' at https://karagemop466-tech.github.io/Demo1/exec-desk/ after the PR #25 merge. Direct browser calls from this GitHub Pages origin work; this site still detects and reports failures at runtime instead of assuming.",
      check:"Open exec-desk/dashboard.html: connection badge should read 'LIVE · official API'. If it ever reads BLOCKED, re-run the header check and update this entry.",
      src:"https://docs.kalshi.com/getting_started/quick_start_market_data" },
    { id:"UNVERIFIED-02", title:"No demo API credentials are present in this repository",
      detail:"Authenticated endpoints (/portfolio/balance, /portfolio/positions, /portfolio/settlements, /portfolio/fills, /portfolio/orders, POST /portfolio/events/orders) require an API key signed per https://docs.kalshi.com/getting_started/api_keys. No key was provided and credentials must never be posted in chat, so every authenticated cell renders blank until a key is entered in Settings (stored only in this browser's localStorage).",
      check:"exec-desk/trades.html → Settings → paste demo key ID + private key → Refresh portfolio.",
      src:"https://docs.kalshi.com/getting_started/api_keys" },
    { id:"UNVERIFIED-03", title:"Third-party CORS relay used as automatic fallback transport (disabled if direct works)",
      detail:"If the browser blocks direct calls to the official API (UNVERIFIED-01), requests are forwarded through api.allorigins.win. The request still targets https://external-api.demo.kalshi.co/trade-api/v2, but a third party relays it. Toggle it off in Settings to forbid the relay; given the cors.json evidence above, direct access should be the normal path and the relay should never engage on github.io.",
      check:"exec-desk/trades.html → 'Allow third-party relay' checkbox; badge should show 'LIVE · official API'.",
      src:"https://docs.kalshi.com/getting_started/quick_start_market_data" },
    { id:"UNVERIFIED-04", title:"Definition of 'highest dollar amount' is not fixed by the API",
      detail:"The official Market schema exposes volume_fp, volume_24h_fp, open_interest_fp and notional_value_dollars but no dollar-volume field. This site ranks events by computed 24h dollar volume = volume_24h_fp × last_price_dollars and also shows the other three metrics. The ranking definition is an open decision (questions.html Q1).",
      check:"Compare ranking toggles on dashboard.html against questions.html Q1.",
      src:"https://docs.kalshi.com/api-reference/market/get-markets" },
    { id:"UNVERIFIED-05", title:"Demo-environment prices may not reflect real markets",
      detail:"Official warning: 'The price and behavior of markets in the demo environment may not be reflective of those in real markets.' Every live figure on this site comes from the demo environment by design.",
      check:"Read the official warning on the demo environment page.",
      src:"https://docs.kalshi.com/getting_started/demo_env" },
    { id:"UNVERIFIED-06", title:"Official category strings for topic filtering are not published",
      detail:"GET /series supports an exact, case-sensitive `category` filter but the docs do not publish the list of valid category strings. This site therefore classifies series into the five required topics (Gas prices, Elections, Culture, Crypto, Golf) with a transparent keyword list shown on markets.html; a wrong match would be visible in the series column of every row.",
      check:"markets.html → each row shows the matched series ticker and title; keyword list is displayed on the page.",
      src:"https://docs.kalshi.com/api-reference/market/get-series-list" },
    { id:"UNVERIFIED-07", title:"Sub-minute chart data has no official source",
      detail:"Official candlesticks support period_interval of 1, 60 or 1440 minutes only. The 'Seconds' chart mode therefore plots client-sampled snapshots of the official market quote (poll cadence shown on the chart), not an official seconds series.",
      check:"dashboard.html → Seconds mode shows 'sampled every Ns from GET /markets/{ticker}'.",
      src:"https://docs.kalshi.com/api-reference/market/get-market-candlesticks" }
  ]
};
