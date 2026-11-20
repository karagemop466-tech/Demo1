/* Extracted from api-notes.html so the repo link auditor scans links in HTML, not JS-built strings. */
(function(){
S.renderNav('api-notes.html'); S.setConn('live', 'static record');
var esc = KALSHI.esc;
function a(href, label) { return '<a href="' + esc(href) + '" target="_blank" rel="noreferrer">' + (label || 'docs ↗') + '</a>'; }
function b(t) { return '<span class="badge ' + (t.indexOf('Empirical') === 0 ? 'live' : 'info') + '">' + t + '</span>'; }
var EPS = [
 ['GET /markets', 'public', 'open-market snapshots (dashboard fallback, event markets)','Empirical 2026-11-20', a('https://docs.kalshi.com/api-reference/market/get-markets')],
 ['GET /markets/{ticker}', 'public', 'order-ticket validation (price grid, status)','Docs-only (schema fetched)', a('https://docs.kalshi.com/api-reference/market/get-market')],
 ['GET /markets/{ticker}/orderbook', 'public', 'depth panel: contracts available at each price','Empirical 2026-11-20 (incl. 1-level real book)', a('https://docs.kalshi.com/api-reference/market/get-market-orderbook')],
 ['GET /markets/trades', 'public', 'price charts ≤ 1 h, live 5 s ticks, notional study','Empirical 2026-11-20 (verbatim 6-trade page)', a('https://docs.kalshi.com/api-reference/market/get-trades')],
 ['GET /events', 'public', 'live event scan (status=open, with_nested_markets, limit≤200, cursor)','Empirical 2026-11-20', a('https://docs.kalshi.com/api-reference/events/get-events')],
 ['GET /events?tickers=…&status=settled', 'public', 'resolution lookups for watched events','Docs-only (params verified in OpenAPI)', a('https://docs.kalshi.com/api-reference/events/get-events')],
 ['GET /series', 'public', 'topic allowlist: category/tags filters (exact, case-sensitive)','Empirical 2026-11-20 (5 topic queries)', a('https://docs.kalshi.com/api-reference/market/get-series-list')],
 ['GET /series/{s}/markets/{m}/candlesticks', 'public', '6 h / 24 h / 7 d price windows','Empirical 2026-11-20 (200 + empty responses)', a('https://docs.kalshi.com/api-reference/market/get-market-candlesticks')],
 ['GET /search/filters_by_sport', 'public', 'sports taxonomy cross-check','Empirical 2026-11-20 (3-page response seen)', a('https://docs.kalshi.com/api-reference/search/get-filters-for-sports')],
 ['GET /portfolio/balance', 'API key (signed)', 'cash balance, portfolio value (cents + *_dollars fields)','Docs-only — needs demo key (flagged U-01)', a('https://docs.kalshi.com/api-reference/portfolio/get-balance')],
 ['GET /portfolio/positions', 'API key (signed)', 'position_fp, market_exposure, realized_pnl, fees_paid','Docs-only — needs demo key', a('https://docs.kalshi.com/api-reference/portfolio/get-positions')],
 ['GET /portfolio/fills', 'API key (signed)', 'trade journal: outcome_side, book_side, is_taker, fee_cost(raw)','Docs-only — needs demo key', a('https://docs.kalshi.com/api-reference/portfolio/get-fills')],
 ['GET /portfolio/orders', 'API key (signed)', 'order tracking (status resting/canceled/executed)','Docs-only — needs demo key', a('https://docs.kalshi.com/api-reference/orders/get-orders')],
 ['POST /portfolio/events/orders', 'API key (signed)', 'V2 order placement (bid/ask, fixed-point count+price, TIF, STP)','Docs-only — full request/response schema fetched', a('https://docs.kalshi.com/api-reference/orders/create-order-v2')],
 ['DELETE /portfolio/events/orders/{id}', 'API key (signed)', 'cancel with market_ticker auto-routing','Docs-only — full schema fetched', a('https://docs.kalshi.com/api-reference/orders/cancel-order-v2')],
 ['GET /account/limits', 'API key (signed)', 'your rate-limit tier (suggested after connecting)','Docs-only', a('https://docs.kalshi.com/getting_started/rate_limits')],
 ['CORS behaviour (browser)', 'n/a', 'browser-side fetching from GitHub Pages/preview origins','Empirical 2026-11-20 — origin echo in ACAO verified', a('https://cors-test.codehappy.dev/?url=https%3A%2F%2Fexternal-api.demo.kalshi.co%2Ftrade-api%2Fv2%2Fmarkets%3Flimit%3D1&method=get','CORS test evidence')]
];
document.getElementById('ep-rows').innerHTML = EPS.map(function (e) {
  return '<tr><td class="mono">' + esc(e[0]) + '</td><td>' + esc(e[1]) + '</td><td>' + esc(e[2]) + '</td><td>' + b(e[3]) + '</td><td class="src">' + e[4] + '</td></tr>';
}).join('');

})();
