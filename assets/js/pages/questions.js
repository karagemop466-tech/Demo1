/* Questions register: what is known, what is missing, and how to close it. */

import { DOC } from '../config.js';
import { $, esc, srcLink } from '../util.js';

const QUESTIONS = [
  {
    area: 'Metric',
    q: 'What does “highest dollar amount” mean?',
    known: 'The API exposes open_interest_fp, volume_fp, volume_24h_fp and notional_value_dollars. A binary contract pays $1 on a winning outcome, so contracts × notional is a dollar amount. Kalshi publishes no single dollar ranking.',
    missing: 'Which of the three defensible metrics should lead the ranking, and at what notional valuation.',
    answer: 'Show all three side by side and rank by open-interest notional as the default, because it is the dollar amount at stake if every open contract settles at full value. State the formula in the table header.',
    status: 'decision',
    source: DOC.getMarkets,
  },
  {
    area: 'Metric',
    q: 'Is contract volume an acceptable proxy for “dollar amount”?',
    known: 'Volume fields are fixed-point contract counts, not dollars.',
    missing: 'Confirmation that the business question is really about dollar exposure rather than activity.',
    answer: 'Do not substitute. Keep volume in its own column labelled as contracts and rank on the dollar metric.',
    status: 'answered',
    source: DOC.getMarkets,
  },
  {
    area: 'Metric',
    q: 'Which price is “the current contract price” on the y-axis?',
    known: 'The market snapshot exposes yes_bid_dollars, yes_ask_dollars, no_bid_dollars, no_ask_dollars, last_price_dollars and previous_price_dollars. The order book publishes bids only; the ask is derived as $1.00 minus the opposite best bid.',
    missing: 'Whether the chart should plot the last trade, the mid, the bid or the ask.',
    answer: 'Plot the last trade price for the main line and show the bid/ask band as a second series, labelling each clearly. Do not silently mix mid and last.',
    status: 'decision',
    source: DOC.orderbook,
  },
  {
    area: 'Scope',
    q: 'Which exact series count as gas prices, elections, culture, crypto and golf?',
    known: 'Events expose a deprecated category field and the series list exposes a series-level category. Kalshi publishes no taxonomy matching the five requested topics.',
    missing: 'An approved list of series tickers per topic.',
    answer: 'Publish data/series-allowlist.json, have a human approve each ticker, and keep the keyword rules only as a fallback that is labelled as such in every row.',
    status: 'evidence',
    source: DOC.seriesList,
  },
  {
    area: 'Scope',
    q: 'Should multivariate (combo) markets be included?',
    known: 'The events endpoint excludes multivariate events; they have their own endpoint. The markets endpoint accepts mve_filter=only|exclude.',
    missing: 'Whether combo markets belong in the five topics.',
    answer: 'Exclude them by default and say so on the markets page, because a combo market is a basket rather than a single event.',
    status: 'decision',
    source: DOC.getEvents,
  },
  {
    area: 'Data',
    q: 'How fresh must the display be?',
    known: 'Unauthenticated public requests have their own limits, separate from the authenticated read budget. Reads are token-bucketed with a stated refill rate and burst capacity.',
    missing: 'The staleness the user is willing to accept, and whether authenticated reads may be used.',
    answer: 'Target a 30-second refresh for quotes and a 10-minute refresh for the committed snapshot, and always display the capture timestamp so staleness is visible rather than implied.',
    status: 'decision',
    source: DOC.rateLimits,
  },
  {
    area: 'Data',
    q: 'What is the minimum acceptable price-history resolution?',
    known: 'The candlestick endpoint accepts period_interval of 1, 60 or 1440 minutes only. There is no sub-minute server-side candle.',
    missing: 'Whether seconds-resolution history is a hard requirement.',
    answer: 'If seconds are required, stand up a WebSocket relay that keeps the tape; otherwise label the client-side live sampling honestly as sampled rather than server-provided.',
    status: 'evidence',
    source: DOC.getCandlesticks,
  },
  {
    area: 'Data',
    q: 'How are markets that settled before the historical cutoff handled?',
    known: 'Candlesticks and fills for anything settled before the historical cutoff are only available through the /historical endpoints, which are separate and authenticated.',
    missing: 'Whether the project needs pre-cutoff history at all.',
    answer: 'Scope the tracker to the live window and state the cutoff explicitly rather than silently missing data.',
    status: 'decision',
    source: DOC.historicalData,
  },
  {
    area: 'Resolution',
    q: 'How is “resolved” defined, and who decides it?',
    known: 'Status moves initialized → active → closed → determined → finalized, with disputed and amended as the exception states. The result field becomes yes, no or scalar. Each event carries settlement_sources.',
    missing: 'Confirmation that the settlement source in the event is the one the account should trust.',
    answer: 'Treat finalized as resolved, display the result and the settlement source together, and surface disputed or amended states prominently because they can change an outcome.',
    status: 'answered',
    source: DOC.lifecycle,
  },
  {
    area: 'Resolution',
    q: 'How long must an event be tracked before it is counted as settled?',
    known: 'A settlement timer runs after determination; settlement timing varies by market type and manual review.',
    missing: 'The exact end condition the tracker should use.',
    answer: 'Count a market as resolved when its status is finalized and settlement_ts is present, and keep the ledger running so the wait is visible rather than hidden.',
    status: 'answered',
    source: DOC.settlement,
  },
  {
    area: 'Resolution',
    q: 'How are scalar markets handled?',
    known: 'Market type can be binary or scalar, and a scalar result is reported as "scalar" with a settlement value rather than yes or no.',
    missing: 'Whether scalar markets in the five topics should be scored or excluded.',
    answer: 'Exclude scalar markets from win/loss scoring and show them separately with their settlement value; a binary win rate over mixed types would be misleading.',
    status: 'decision',
    source: DOC.getMarkets,
  },
  {
    area: 'Resolution',
    q: 'What is the payout rule on settlement?',
    known: 'Winning YES holders receive $1 per contract and winning NO holders receive $1 per contract; only net positions settle. Settlement fees are zero for a simple yes/no determination but can apply to sub-cent scalar settlement, and the payout is rounded to whole cents.',
    missing: 'Whether the rounding rule needs to be modelled per trade for the P&L.',
    answer: 'Model the $1 payout and subtract the fee fields the API already returns; add the rounding note to the analysis page.',
    status: 'answered',
    source: DOC.settlement,
  },
  {
    area: 'Account',
    q: 'Which demo account is being tracked, and with what permissions?',
    known: 'Demo credentials are separate from production and are not shared between environments. Keys are asymmetric; a key can be limited to market data.',
    missing: 'The key id, its scopes, and the account tier.',
    answer: 'Register the demo key, record its scope and tier alongside the snapshot, and publish only non-sensitive metadata.',
    status: 'evidence',
    source: DOC.demoEnv,
  },
  {
    area: 'Account',
    q: 'What is the account’s P&L after fees?',
    known: 'The balance endpoint returns balance, balance_dollars, portfolio_value and updated_ts. Positions expose market_exposure_dollars, realized_pnl_dollars and fees_paid_dollars. Fills expose fee_cost.',
    missing: 'The actual numbers — no credentials exist for this project yet.',
    answer: 'Connect a demo key, publish a snapshot, and compute P&L from the reported fields rather than from a model.',
    status: 'evidence',
    source: DOC.getBalance,
  },
  {
    area: 'Account',
    q: 'Should subaccounts be used to separate strategies?',
    known: 'Subaccounts exist, each with its own balance, and orders can target a subaccount number.',
    missing: 'Whether strategy isolation is a requirement.',
    answer: 'Decide before any multi-strategy run; retrofitting subaccounts after trades exist makes attribution ambiguous.',
    status: 'decision',
    source: DOC.subaccounts,
  },
  {
    area: 'Risk',
    q: 'What exposure limits apply per market, per topic and in total?',
    known: 'Orders accept reduce_only, post_only, order groups with a rolling contract limit, and explicit exchange shard routing.',
    missing: 'The numeric limits themselves.',
    answer: 'Agree limits before enabling any automated run; the runner in this project already refuses to exceed a contracts-per-order cap, an orders-per-run cap and a price band.',
    status: 'decision',
    source: DOC.createOrderV2,
  },
  {
    area: 'Risk',
    q: 'Is crossing the spread allowed, or must every order rest?',
    known: 'post_only is available on the order endpoint, and the order book explains why only bids are returned.',
    missing: 'The intended execution posture.',
    answer: 'Default to passive-only (post_only where appropriate) and make taker orders an explicit, separately reviewed choice.',
    status: 'decision',
    source: DOC.orderbook,
  },
  {
    area: 'Risk',
    q: 'What is the entry signal for a trade?',
    known: 'Nothing in the API defines one; the order book, quotes and candles are inputs, not instructions.',
    missing: 'A rule that can be stated, tested and falsified.',
    answer: 'Write the rule as an explicit strategy entry in the strategy library, with a minimum edge and a size cap, and only then allow the runner to act on it.',
    status: 'decision',
    source: DOC.getCandlesticks,
  },
  {
    area: 'Risk',
    q: 'How many trades are needed before a strategy is judged?',
    known: 'Nothing official prescribes a sample size.',
    missing: 'An agreed threshold and the metric to judge it on.',
    answer: 'Fix the metric (realised P&L per trade after fees) and require a minimum sample plus an out-of-sample window before drawing any conclusion.',
    status: 'decision',
    source: DOC.getFills,
  },
  {
    area: 'Governance',
    q: 'Can GitHub Pages host anything account-related?',
    known: 'GitHub Pages serves static files from the repository; there is no server-side runtime, and the WebSocket handshake needs headers a browser cannot set.',
    missing: 'Whether a separate signed proxy service is acceptable to run.',
    answer: 'Keep Pages to public data and the browser-side ticket, and treat any server-side signing service as a separate, reviewed deployment.',
    status: 'decision',
    source: DOC.environments,
  },
  {
    area: 'Governance',
    q: 'Who may execute a trade, and what audit trail is kept?',
    known: 'The API records orders, fills and their timestamps; client_order_id gives a durable local identifier before the server id exists.',
    missing: 'The approval rule and the retention requirement for the journal.',
    answer: 'Require an explicit confirmation per order in the UI and keep the journal — request, response, order id and timestamps — for every attempt, accepted or rejected.',
    status: 'decision',
    source: DOC.createOrder,
  },
  {
    area: 'Governance',
    q: 'Does the demo environment behave like production for fees and settlement?',
    known: 'The docs warn that demo prices and behaviour may not reflect real markets, and demo funds are mock money.',
    missing: 'Whether demo fee schedules and settlement timings match production exactly.',
    answer: 'Treat demo results as a rehearsal of the pipeline, never as evidence of live profitability, and state that on every performance page.',
    status: 'answered',
    source: DOC.demoEnv,
  },
  {
    area: 'Governance',
    q: 'What happens when the demo API is unavailable or the data is stale?',
    known: 'The API returns structured errors, and a rate-limited response is 429 with no penalty beyond the bucket refill.',
    missing: 'Whether the dashboard should keep showing the last snapshot or blank out.',
    answer: 'Show the last snapshot with its capture time and an explicit "snapshot" badge; never render a value that was not received.',
    status: 'answered',
    source: DOC.rateLimits,
  },
];

function statusBadgeFor(status) {
  if (status === 'answered') return '<span class="badge ok">answered</span>';
  if (status === 'decision') return '<span class="badge warn">needs a decision</span>';
  return '<span class="badge bad">needs evidence</span>';
}

function render() {
  const area = $('#q-area').value;
  const status = $('#q-status').value;
  const q = $('#q-search').value.trim().toLowerCase();
  const rows = QUESTIONS.map((item, i) => ({ ...item, n: i + 1 })).filter((item) => {
    if (area !== 'all' && item.area !== area) return false;
    if (status !== 'all' && item.status !== status) return false;
    if (q && !`${item.q} ${item.known} ${item.missing} ${item.answer}`.toLowerCase().includes(q)) return false;
    return true;
  });

  $('#q-rows').innerHTML = rows.length
    ? rows
        .map(
          (r) => `<tr>
            <td class="num">${r.n}</td>
            <td class="title">${esc(r.q)}<span class="ticker">${esc(r.area)}</span></td>
            <td>${esc(r.known)}</td>
            <td>${esc(r.missing)}</td>
            <td>${esc(r.answer)}</td>
            <td>${statusBadgeFor(r.status)}</td>
            <td>${srcLink(r.source, 'docs')}</td>
          </tr>`,
        )
        .join('')
    : '<tr><td colspan="7" class="empty">No questions match the filters.</td></tr>';

  const answered = QUESTIONS.filter((q2) => q2.status === 'answered').length;
  const decision = QUESTIONS.filter((q2) => q2.status === 'decision').length;
  const evidence = QUESTIONS.filter((q2) => q2.status === 'evidence').length;
  $('#q-count').textContent = String(QUESTIONS.length);
  $('#q-count-note').textContent = 'questions in the register';
  $('#q-answered').textContent = String(answered);
  $('#q-decision').textContent = String(decision);
  $('#q-evidence').textContent = String(evidence);
}

['#q-area', '#q-status', '#q-search'].forEach((sel) => {
  $(sel).addEventListener('input', render);
  $(sel).addEventListener('change', render);
});
render();
