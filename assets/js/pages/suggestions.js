/* Suggestions page: reviewable improvement proposals, stored locally. */

import { DOC } from '../config.js';
import { $, esc, srcLink } from '../util.js';
import { getReviews, setReview } from '../store.js';

const OPTIONS = ['Not reviewed', 'Consider', 'Defer', 'Implement now', 'Rejected'];

const IMPROVEMENTS = [
  {
    id: 'imp-proxy',
    title: 'Put a thin server-side proxy in front of the demo API',
    why: 'Removes the CORS unknown entirely, lets the browser use signed requests without holding a private key, and makes live WebSocket data reachable (the browser cannot set the handshake headers the Kalshi WebSocket API requires).',
    decision: 'Choose the host and the trust model: a Cloudflare Worker, a Vercel function, or a small container. Decide whether the proxy may hold credentials server-side or must stay stateless and receive a signed request to forward.',
    impact: 'High — unlocks the whole live layer and the account features.',
    source: DOC.websockets,
  },
  {
    id: 'imp-series-allowlist',
    title: 'Replace keyword topic matching with an approved series-ticker allowlist',
    why: 'Kalshi publishes no "gas / elections / culture / crypto / golf" taxonomy, so keyword matching can both miss markets and include the wrong ones. A reviewed allowlist of series tickers makes the scope auditable.',
    decision: 'Approve the series tickers to include per topic, and decide who maintains that list.',
    impact: 'High — every dollar ranking depends on the scope being right.',
    source: DOC.seriesList,
  },
  {
    id: 'imp-event-rollup',
    title: 'Roll market resolutions up to the event level',
    why: 'Today resolution is tracked per market. Several markets per event can resolve differently (a strike bracket, for example), so an event-level summary is what a decision maker actually needs.',
    decision: 'Decide how partial resolutions inside an event should be reported: as a mixed result, a weighted outcome, or a per-market list.',
    impact: 'Medium.',
    source: DOC.lifecycle,
  },
  {
    id: 'imp-digest',
    title: 'Publish a scheduled digest of the top dollar markets per topic',
    why: 'A short, timestamped summary (top 3 per topic by open-interest notional and by 24h traded notional) makes the dashboard usable without opening it.',
    decision: 'Decide the delivery channel and cadence, and whether the digest is emailed, posted to a channel, or committed as a dated markdown file in the repository.',
    impact: 'Medium.',
    source: DOC.getMarkets,
  },
  {
    id: 'imp-unrealised',
    title: 'Split realised and unrealised P&L and add a mark-to-market curve',
    why: 'Realised P&L only appears after settlement. Until then, a trader needs the position marked to the current book, and the split prevents an unrealised number from being read as a profit.',
    decision: 'Choose the mark price (best bid, best ask, or mid) and state it on the page. The order-book guide already documents the reciprocal ask derivation.',
    impact: 'Medium.',
    source: DOC.orderbook,
  },
  {
    id: 'imp-shortfall',
    title: 'Measure implementation shortfall on every fill',
    why: 'Compares the intended price with the actual fill price and the spread at fill time, which is what separates a good signal from a bad execution.',
    decision: 'Decide whether the reference price is the decision-time quote or the arrival quote, and store the decision-time quote alongside the order.',
    impact: 'Medium.',
    source: DOC.getFills,
  },
  {
    id: 'imp-quality-score',
    title: 'Add a market-quality score',
    why: 'Combines spread, depth inside the spread, time to expiry and the presence of a settlement source, so thin markets can be filtered out of the ranking.',
    decision: 'Agree the weights and the minimum score before it appears on a ranked list.',
    impact: 'Medium.',
    source: DOC.getMarket,
  },
  {
    id: 'imp-durable-journal',
    title: 'Move the trade journal from browser storage to durable storage',
    why: 'localStorage is per browser and per device. A durable journal keeps the analysis page meaningful across sessions and machines.',
    decision: 'Choose the store (a database, a JSON file in the repository written by the workflow, or an object store) and decide retention.',
    impact: 'Medium.',
    source: DOC.getOrders,
  },
  {
    id: 'imp-backtest',
    title: 'Add an out-of-sample backtest harness over historical candles',
    why: 'Lets a candidate strategy be scored on candles that were never used to design it, which is the only way to tell a rule from a coincidence.',
    decision: 'Agree the evaluation window, the metric, and the minimum sample size before any strategy is judged.',
    impact: 'Medium.',
    source: DOC.historicalData,
  },
  {
    id: 'imp-fees',
    title: 'Model the fee schedule per series in the P&L',
    why: 'Settlement fees can be zero for a simple yes/no determination but are not zero in every case, so a fee-aware P&L is closer to the exchange result.',
    decision: 'Decide whether to use the fee fields the API already returns on fills and orders, or the published schedule per series.',
    impact: 'Medium.',
    source: DOC.settlement,
  },
  {
    id: 'imp-alerts',
    title: 'Add alerts for price, depth and resolution events',
    why: 'Turns the dashboard from something you look at into something that tells you when a threshold is crossed, which is what makes “track live events until they resolve” practical.',
    decision: 'Choose the alert channels and the thresholds, and confirm how a browser-delivered alert behaves when the page is closed.',
    impact: 'Medium.',
    source: DOC.websockets,
  },
  {
    id: 'imp-contract-test',
    title: 'Add a contract test that checks the API still matches the documentation',
    why: 'The docs state exact field names, enum values and status lists. A scheduled test that asserts those against a live response catches breaking changes before the dashboard silently blanks a column.',
    decision: 'Decide which fields are contract-critical enough to fail the build.',
    impact: 'Low.',
    source: DOC.getMarkets,
  },
  {
    id: 'imp-rate-budget',
    title: 'Budget the request rate explicitly against the published limits',
    why: 'Reads and writes draw on separate token buckets with published refill rates and burst capacity. A dashboard that ignores this gets throttled without explanation.',
    decision: 'Agree the polling cadence per page and whether to authenticate reads to use the account budget.',
    impact: 'Low.',
    source: DOC.rateLimits,
  },
  {
    id: 'imp-timestamps',
    title: 'Show every timestamp in one timezone with a secondary UTC label',
    why: 'Market close times, settlement times and fill times are stored in UTC. Mixed presentation is a common source of misreading an expiry.',
    decision: 'Pick the display timezone and confirm whether exchange-local time is wanted as well.',
    impact: 'Low.',
    source: DOC.lifecycle,
  },
];

const DISCOVERIES = [
  {
    id: 'dis-cors',
    title: 'Measure the browser CORS behaviour of the demo API',
    gap: 'It is unknown whether a page served from GitHub Pages can call external-api.demo.kalshi.co directly, or whether a relay is required.',
    how: 'Load the site, open the browser console, and run one fetch to the markets endpoint. Record the console message and the response headers (Access-Control-Allow-Origin). Repeat once from a second origin to confirm the behaviour is not origin-specific.',
    evidence: 'A captured response header plus the exact console error, filed on the Flagged for review page.',
    source: DOC.marketData,
  },
  {
    id: 'dis-account',
    title: 'Provision a Kalshi demo account and register an API key',
    gap: 'Without demo credentials no portfolio number, fill, fee or realised P&L can be produced, and no order can be executed.',
    how: 'Create the demo account following the official tutorial, generate an API key on the profile settings page, then add KALSHI_API_KEY_ID and KALSHI_PRIVATE_KEY as repository secrets so the refresh workflow can publish a snapshot.',
    evidence: 'A portfolio.json snapshot with a non-empty fills array and a matching balance response.',
    source: DOC.demoEnv,
  },
  {
    id: 'dis-taxonomy',
    title: 'Build and approve a series-ticker allowlist per topic',
    gap: 'The five focus topics have no official mapping, so the current keyword rules are a heuristic that can omit or over-include markets.',
    how: 'List the series from the series endpoint, filter to plausible series per topic, and have a human approve the final list into data/series-allowlist.json.',
    evidence: 'An approved allowlist file plus a capture that records the classification method per market.',
    source: DOC.seriesList,
  },
  {
    id: 'dis-dollar-metric',
    title: 'Agree the definition of "highest dollar amount"',
    gap: 'Kalshi publishes contract counts and a per-contract notional, but no single dollar ranking; three defensible definitions exist and they produce different leaders.',
    how: 'Decide between open-interest notional, 24-hour traded notional, and resting depth notional at a chosen size, then state the choice in the metric table on the markets page.',
    evidence: 'A one-line definition in the requirements document and the ranking recomputed against it.',
    source: DOC.getMarkets,
  },
  {
    id: 'dis-settlement-source',
    title: 'Capture the settlement source for every event in scope',
    gap: 'The resolution depends on the settlement source published on the event; it is not currently displayed, so a reviewer cannot check why a market resolved a particular way.',
    how: 'Read settlement_sources from the events endpoint and show them next to each resolved market.',
    evidence: 'An event row that carries its settlement source alongside the reported result.',
    source: DOC.getEvents,
  },
  {
    id: 'dis-fee-schedule',
    title: 'Confirm the fee schedule for the series in scope',
    gap: 'Whether a trade paid a fee is not visible without the series fee schedule, so cost and P&L could be overstated.',
    how: 'Read the fee fields the API returns on fills and orders, and cross-check against the fee schedule endpoint for the series concerned.',
    evidence: 'A fee column populated for every fill, reconciled against the order response.',
    source: DOC.getFills,
  },
  {
    id: 'dis-restrictions',
    title: 'Confirm which account and product restrictions apply to the demo account',
    gap: 'Account tiers, subaccounts and exchange shards affect what can be queried and traded; none of it is documented for this account because it has never been queried.',
    how: 'Call the account endpoints that return tier and restriction information and record the response.',
    evidence: 'An account-restrictions record attached to the flagged-review page.',
    source: DOC.apiKeys,
  },
  {
    id: 'dis-subsecond',
    title: 'Decide whether sub-minute price history is required',
    gap: 'The candlestick endpoint only serves 1-minute, 1-hour and 1-day periods, so a true seconds-resolution history needs either a WebSocket relay that keeps the tape or it stays unserved.',
    how: 'Confirm the requirement, then either stand up the WebSocket relay (see the proxy suggestion) or accept the sampled live-tick approach and label it as such.',
    evidence: 'Either a relayed tick tape with sub-minute timestamps, or a written decision that the sampled approach is sufficient.',
    source: DOC.getCandlesticks,
  },
];

function renderRows(target, items) {
  const reviews = getReviews();
  const body = $(target);
  body.innerHTML = items
    .map((item, i) => {
      const current = reviews[item.id]?.value || 'Not reviewed';
      const opts = OPTIONS.map((o) => `<option${o === current ? ' selected' : ''}>${o}</option>`).join('');
      return `<tr>
        <td class="title">${esc(item.title)}</td>
        <td>${esc(item.why)}</td>
        <td>${esc(item.decision)}</td>
        <td>${esc(item.impact)}</td>
        <td>${srcLink(item.source, 'docs')}</td>
        <td><select data-review-id="${esc(item.id)}" aria-label="Review: ${esc(item.title)}">${opts}</select></td>
      </tr>`;
    })
    .join('');
}

function renderDiscoveryRows() {
  const reviews = getReviews();
  const body = $('#d-rows');
  body.innerHTML = DISCOVERIES.map((item) => {
    const current = reviews[item.id]?.value || 'Not reviewed';
    const opts = OPTIONS.map((o) => `<option${o === current ? ' selected' : ''}>${o}</option>`).join('');
    return `<tr>
      <td class="title">${esc(item.title)}</td>
      <td>${esc(item.gap)}</td>
      <td>${esc(item.how)}</td>
      <td>${esc(item.evidence)}</td>
      <td>${srcLink(item.source, 'docs')}</td>
      <td><select data-review-id="${esc(item.id)}" aria-label="Review: ${esc(item.title)}">${opts}</select></td>
    </tr>`;
  }).join('');
}

function updateCounts() {
  const reviews = getReviews();
  const all = [...IMPROVEMENTS, ...DISCOVERIES];
  let consider = 0;
  let defer = 0;
  let now = 0;
  let none = 0;
  for (const item of all) {
    const v = reviews[item.id]?.value || 'Not reviewed';
    if (v === 'Consider') consider++;
    else if (v === 'Defer') defer++;
    else if (v === 'Implement now') now++;
    else none++;
  }
  $('#s-consider').textContent = String(consider);
  $('#s-defer').textContent = String(defer);
  $('#s-now').textContent = String(now);
  $('#s-none').textContent = String(none);
  $('#s-count').textContent = String(consider + defer + now);
  $('#s-count-note').textContent = `of ${all.length} suggestions reviewed in this browser`;
}

function wire() {
  document.addEventListener('change', (e) => {
    const sel = e.target.closest('[data-review-id]');
    if (!sel) return;
    setReview(sel.dataset.reviewId, sel.value);
    updateCounts();
  });
  $('#s-reset').addEventListener('click', () => {
    try {
      localStorage.removeItem('kalshidemo.review.v1');
    } catch {
      /* ignore */
    }
    renderRows('s-rows', IMPROVEMENTS);
    renderDiscoveryRows();
    updateCounts();
  });
}

renderRows('s-rows', IMPROVEMENTS);
renderDiscoveryRows();
updateCounts();
wire();
