# Demo API data verification log — session arena-288e8741-demo1 (2026-11-20 UTC)

Every row below records an actual HTTP GET made against the **official Kalshi demo Trade API** (`https://external-api.demo.kalshi.co/trade-api/v2`) or the **official Kalshi documentation site** (`docs.kalshi.com`), what it verified, and where the captured values were saved. The sandbox shell cannot reach `*.kalshi.co` (egress-restricted), so requests were made through the platform's page fetcher (direct HTTPS GET without an Origin header; no credentials used — all endpoints are documented public market-data endpoints). Values were transcribed verbatim into `data/demo-snapshot.json` and `data/demo-resolution-log.json`.

## Official documentation pages fetched and verified

| # | Source (official) | Verified |
|---|---|---|
| 1 | https://docs.kalshi.com/getting_started/quick_start_market_data | Public unauthenticated market data; browser `fetch()` examples for markets, events, orderbook; field names `yes_bid_dollars`, `volume_fp`; orderbook arrays sorted ascending (best bid last) |
| 2 | https://docs.kalshi.com/api-reference/events/get-events | `GET /events` params (`limit`, cursor); event schema incl. `category`, `series_ticker`, `result` on embedded markets; demo base URL listed |
| 3 | https://docs.kalshi.com/api-reference/market/get-market-candlesticks | `GET /series/{series}/markets/{ticker}/candlesticks`; required `start_ts`, `end_ts`, `period_interval` ∈ {1, 60, 1440} minutes; OHLC schema (`*_dollars`), `volume_fp`, `open_interest_fp` |
| 4 | https://docs.kalshi.com/api-reference/market/get-trades | `GET /markets/trades?ticker&min_ts&max_ts&limit(≤1000)`; trade schema (`count_fp`, `yes_price_dollars`, `no_price_dollars`, `taker_outcome_side`, `created_time`) |
| 5 | https://docs.kalshi.com/api-reference/market/get-series-list | `GET /series?category&tags&include_volume`; exact case-sensitive category matching; series schema incl. `categories`, `tags`, `settlement_sources` |
| 6 | https://docs.kalshi.com/llms.txt | Documentation index used to locate the endpoint references above |
| 7 | https://docs.kalshi.com/getting_started/api_environments | (fetched by earlier sessions, re-cited) demo REST `https://external-api.demo.kalshi.co/trade-api/v2`, WS `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2` |
| 8 | https://docs.kalshi.com/api-reference/market/get-market-orderbook | (cited via llms.txt + quick start) orderbook returns resting YES and NO bids only; asks derived as 1 − opposite-side bid |

## Live demo API responses fetched (values captured verbatim)

| # | Endpoint called (demo API) | UTC time (approx) | Verified / captured into snapshot |
|---|---|---|---|
| 1 | `/markets?limit=3` | 11:19 | New fixed-point response schema (`*_dollars`, `*_fp`, `status: "active"`, MVE cross-category markets) |
| 2 | `/markets?series_ticker=KXBTC&limit=2` | 11:20 | KXBTC exists on demo; BTC price-range rules (CF Benchmarks BRTI); far strikes with zero volume |
| 3 | `/markets?series_ticker=KXGAS&limit=1` | 11:20 | No such series (negative result, recorded) |
| 4 | `/markets?series_ticker=KXETH&limit=1` | 11:21 | KXETH exists on demo (ERTI rules) |
| 5 | `/markets?series_ticker=KXPRES28`, `KXPGA`, `KXOSCAR` | 11:21 | Negative results (series do not exist on demo) |
| 6 | `/markets/KXBTC-26NOV2101-T70799.99/orderbook` | 11:21 | Orderbook endpoint works; empty book for a far strike (`orderbook_fp` with empty arrays) |
| 7 | `/series?category=Elections&limit=200` (chunk 0) | 11:24 | Elections series inventory (KXAGRACE, KXMAYORBOS, KXSTATEDEEPKH, …) |
| 8 | `/series?category=Sports&tags=Golf` (chunk 0) | 11:25 | Golf series inventory (KXDPWTTOP20, KXNEXTWIN, KXPGARETURN, KXPRESCUPMATCH, KXGOLFMAJORS, …) |
| 9 | `/series?category=Crypto&limit=50` (chunk 0) | 11:25 | Crypto series inventory (KXSUIATH, KXBTC2025100, KXBTCMAXW, KXDOGE, KXSOLFLIPETH, KXETHMAXY, KXBTCVSSOL, KXDJTBTC, …) |
| 10 | `/series/KXAAAGASM` | 11:25 | Gas series metadata: category Economics, tags Oil & Gas, settlement source AAA (https://gasprices.aaa.com/) |
| 11 | `/markets?series_ticker=KXAAAGASM&limit=1` | 11:25 | Resolved gas market KXAAAGASM-26OCT31-4.18: result "yes", finalized, settlement_ts, settlement_value 1.0000, volume 784.60 |
| 12 | `/series/KXAAAGASM/markets/KXAAAGASM-26OCT31-4.18/candlesticks?start_ts=1792060800&end_ts=1795173900&period_interval=1440` | 11:25 | Candlesticks work on demo: daily OHLC (price 0.68→0.83), volume 784.60, OI 743.85 |
| 13 | `/markets/trades?limit=1000` (chunks 0–4) | 11:26–11:27 | ~4,000 most-recent demo trades transcribed selectively: active trading in golf (KXPGATOUR-THRC26), elections (KXPRESNOMD-28, KXPRESNOMR-28, KXPRESPERSON-28), culture (KXTIME-26), crypto (KXBTCD), gas (KXAAAGASW) |
| 14 | `/events?series_ticker=KXAAAGASM&limit=100` | 11:27 | Monthly gas events Dec 2025 → Dec 2026 |
| 15 | `/events?series_ticker=KXBTC&status=open&limit=50` | 11:27 | Hourly BTC range events Nov 20–21 |
| 16 | `/events?series_ticker=KXGRAMMY&limit=50` | 11:27 | Grammy 69 events (category "Entertainment") |
| 17 | `/events?series_ticker=KXNEXTWIN&limit=50`, `KXMAYORBOS`, `KXAGRACE&status=settled`, `KXBTCD&status=settled`, `KXBTC&status=settled` | 11:27–11:33 | Negative/synthetic results: NEXTWIN and MAYORBOS have zero events; settled lists contain future-dated synthetic events (flagged) |
| 18 | `/events?series_ticker=KXAGRACE&limit=50` | 11:28 | 2028 state AG race events (WA, WV, VT, UT, PA, OR, NC, MT, MO, IN …) |
| 19 | `/events?series_ticker=KXDPWTTOP20&limit=50` | 11:28 | DP World Tour 2026 events incl. DPWTC26 (live week) and settled GEC26 |
| 20 | `/events?series_ticker=KXGOLFMAJORS&limit=50` | 11:28 | KXGOLFMAJORS-SSCH26 (Scheffler majors 2026) |
| 21 | `/markets?event_ticker=KXAAAGASW-26NOV23&limit=1000` (chunk 0 of 4) | 11:31 | Weekly gas strike markets with volume/OI (650.51 and 3,398.05 contracts) |
| 22 | `/markets?event_ticker=KXBTCD-26NOV2017&limit=1000` (chunk 0 of 12) | 11:31 | BTC daily strike markets, volumes up to 23,963 contracts, OI up to 42,073 |
| 23 | `/markets?event_ticker=KXTIME-26&limit=1000` (chunk 0 of 20) | 11:31 | TIME POTY 2026 candidate markets (Taylor Swift 293.88 contracts; Alysa Liu OI 33,419.76 with 0 volume — flagged as injected demo position) |
| 24 | `/markets?event_ticker=KXPRESNOMD-28&limit=1000` (chunk 0 of 13) | 11:31 | 2028 Dem nominee markets; Jasmine Crockett 2,656,378.77 volume / 1,924,557.49 OI |
| 25 | `/markets?event_ticker=KXPGATOUR-THRC26&limit=1000` (chunk 0 of 38) | 11:31 | The RSM Classic winner markets; Matt Atkins bid/ask sizes 83,333 / 55,481 |
| 26 | `/markets/KXPGATOUR-THRC26-MATK/orderbook` | 11:33 | Full book captured (YES bids 0.001×166,666.66, 0.002×83,333.33; NO bids 0.995–0.997×33k–55k) |
| 27 | `/markets/KXBTCD-26NOV2017-T57499.99/orderbook` | 11:33 | YES bids 0.94–0.96 × 3.4k–4.5k; NO side empty |
| 28 | `/series/KXBTCD/markets/KXBTCD-26NOV2017-T57499.99/candlesticks?start_ts=1795166700&end_ts=1795173900&period_interval=1` | 11:33 | 1-minute candles: steady 0.96 bid / 1.00 ask, OI 22,024.83, zero volume in window |
| 29 | `/markets?event_ticker=KXDPWTTOP20-GEC26&limit=1000` (chunk 0 of 32) | 11:33 | Settled golf markets with result yes/no + settlement_ts + settlement_value (YBAE yes; SOH/MSON/WCHO no) |

## CORS verification (from repo pipeline, session 7bc11020, PR #7)

`data/cors.json` records an HTTP GET with Origin header `https://karagemop466-tech.github.io` sent from a GitHub Actions runner to the demo API; response header `access-control-allow-origin: https://karagemop466-tech.github.io` was returned (checked 2026-11-20T11:22:36Z). This authorizes the browser on the published Pages site to read the demo API directly. Third-party sources claim the **production** API rejects cross-origin browser requests (403 with Origin); that claim could not be verified from official docs and applies to a different host — flagged for review, not relied upon.

## Irregularities found (full list also on the Flagged for Review page)

1. Demo `status=settled` event indexes (KXBTC/KXBTCD) return synthetic future-dated events (2027–2035) with junk metadata (`cadence: "hohhggd"`).
2. KXDPWTTOP20-GEC26: `occurrence_datetime` says 2026-11-08 but markets finalized 2026-10-25.
3. Demo open interest injected on zero-trade markets (KXTIME-26-ALIU: OI 33,419.76, volume 0.00).
4. Demo volumes are dominated by synthetic 2028 election markets — "highest dollar amount" rankings on demo are exercise data, not real depth.
5. The `category` filter is case-sensitive and exact (`Culture` returned 2 series; KXGRAMMY events carry category `Entertainment`), so category-scoped discovery can miss related markets.
6. `custom_strike` objects contain demo placeholders (`"demo strike": "demo strike"`) on some markets.
7. The sandbox cannot reach `*.kalshi.co` directly (egress allowlist); all demo-API values were captured through the platform page fetcher instead, and browser-side live fetching relies on the CORS verification above.
8. Contract `volume_fp` is a contract count, NOT dollars; no official dollar-volume field exists in the market object — dollar figures on this site are computed estimates or exact sums from the trades feed, always labeled.
