/* Flagged-for-review register. */

import { DOC } from '../config.js';
import { $, esc, srcLink } from '../util.js';

const ITEMS = [
  {
    id: 'f1',
    title: 'No Kalshi demo credentials exist for this project',
    severity: 'high',
    affects: 'Portfolio page, trade analysis page, any executed order.',
    did: 'The pages render real endpoint shapes with an explicit "not connected" state, and the trading ticket refuses to submit without a key. No balance, position, fill or P&L number is displayed.',
    verify:
      'Create a demo account using the official tutorial, generate an API key, and add KALSHI_API_KEY_ID and KALSHI_PRIVATE_KEY as repository secrets. The refresh workflow then publishes a snapshot.',
    sources: [DOC.demoEnv, DOC.apiKeys],
  },
  {
    id: 'f2',
    title: 'Browser CORS behaviour of the demo API could not be verified from the build environment',
    severity: 'high',
    affects: 'Every live panel. If the browser blocks the request, the site falls back to the committed snapshot.',
    did: 'The client tries the direct request first and then two public relays, and reports which transport succeeded in the header status. It never mixes live and snapshot values in one table.',
    verify:
      'Open the site in a browser, open the console, and run: fetch("https://external-api.demo.kalshi.co/trade-api/v2/markets?limit=1").then(r=>console.log(r.headers.get("access-control-allow-origin"))).catch(e=>console.log("blocked",e)). Then record the result.',
    sources: [DOC.marketData, DOC.environments],
  },
  {
    id: 'f3',
    title: '“Highest dollar amount” has no single official definition',
    severity: 'high',
    affects: 'The ranking on the markets page and the headline figures on the landing page.',
    did: 'Three named metrics are computed and printed with their formulas: open-interest notional, 24-hour traded notional and resting depth notional. Contract volume is never presented as dollars.',
    verify: 'Choose one metric as the default ranking and record the decision on the questions register.',
    sources: [DOC.getMarkets, DOC.settlement],
  },
  {
    id: 'f4',
    title: 'The five focus topics have no official Kalshi taxonomy',
    severity: 'medium',
    affects: 'Which markets appear on every page.',
    did: 'Each row records how it was classified — series category, series allowlist or keyword — so inclusion can be audited rather than trusted.',
    verify: 'Review the live series list and approve the series tickers to include per topic in data/series-allowlist.json.',
    sources: [DOC.seriesList, DOC.getEvents],
  },
  {
    id: 'f5',
    title: 'Sub-minute price history is not available from the official candle endpoint',
    severity: 'medium',
    affects: 'The seconds option on the price chart.',
    did: 'The seconds mode samples the live public quote in the browser and the page says so explicitly. The official candle modes use period_interval 1, 60 and 1440 minutes, which are the only values the API accepts.',
    verify: 'Confirm whether seconds-resolution history is required, then decide between a WebSocket relay and the sampled approach.',
    sources: [DOC.getCandlesticks, DOC.websockets],
  },
  {
    id: 'f6',
    title: 'The Kalshi WebSocket API requires headers a browser cannot set',
    severity: 'medium',
    affects: 'Any future push-based live feed.',
    did: 'The live layer uses REST polling from the browser instead of the WebSocket channels, and the limitation is documented rather than worked around silently.',
    verify: 'Stand up a signed WebSocket relay and compare its tick rate against the polling cadence.',
    sources: [DOC.websockets],
  },
  {
    id: 'f7',
    title: 'Public relays are used as a fallback transport',
    severity: 'medium',
    affects: 'Only the fallback path for public, unauthenticated market data.',
    did: 'Relays are used only for public market data, never for signed account requests, and the site displays which transport served the current data. The relay list is a single constant in assets/js/config.js.',
    verify: 'Remove the relays from that constant once CORS is confirmed, and the fallback disappears.',
    sources: [DOC.marketData],
  },
  {
    id: 'f8',
    title: 'Resolution data is an observation history, not an official event log',
    severity: 'medium',
    affects: 'The resolution ledger on the events page.',
    did: 'The ledger is labelled as something this project records between captures. The authoritative resolution remains the result field reported by the API.',
    verify: 'Compare a ledger row with the market record once the market is finalized.',
    sources: [DOC.lifecycle, DOC.settlement],
  },
  {
    id: 'f9',
    title: 'The published snapshot can be stale between refresh cycles',
    severity: 'low',
    affects: 'Every table when the browser cannot reach the API directly.',
    did: 'The capture time is displayed next to the data and the header badge reads "snapshot" rather than "live" when the snapshot is what is on screen.',
    verify: 'Compare the displayed capture time with the refresh workflow run list.',
    sources: [DOC.rateLimits],
  },
  {
    id: 'f10',
    title: 'Fee and rounding effects are modelled only to the extent the API reports them',
    severity: 'low',
    affects: 'Realised P&L on the analysis page.',
    did: 'P&L uses the fee fields returned on fills and orders. Settlement payouts use the documented $1-per-winning-contract rule. Nothing is estimated beyond that.',
    verify: 'Reconcile one settled fill by hand against the order response and the settlement record.',
    sources: [DOC.getFills, DOC.settlement],
  },
  {
    id: 'f11',
    title: 'Two publish paths remain configured for GitHub Pages',
    severity: 'low',
    affects: 'Which artefact is served at the public URL.',
    did: 'The Actions workflow publishes the same tree that is committed, so both paths serve identical content. Switching the repository to workflow-only publishing needs settings access this session does not have.',
    verify: 'Check the Pages build type in repository settings and confirm the deployed commit matches main.',
    sources: [DOC.environments],
  },
  {
    id: 'f12',
    title: 'Multivariate (combo) markets are excluded from the default view',
    severity: 'low',
    affects: 'The scope of the five topics.',
    did: 'Combo markets are filtered out and the choice is recorded here and on the questions register.',
    verify: 'Decide whether combos belong in scope and change the filter in scripts/fetch-demo-data.mjs if so.',
    sources: [DOC.getEvents, DOC.getMarkets],
  },
];

function severityLabel(s) {
  if (s === 'high') return '<span class="severity-high">High</span>';
  if (s === 'medium') return '<span class="severity-med">Medium</span>';
  return '<span class="severity-low">Low</span>';
}

$('#f-rows').innerHTML = ITEMS.map(
  (it, i) => `<tr>
    <td class="num">${i + 1}</td>
    <td class="title">${esc(it.title)}</td>
    <td>${severityLabel(it.severity)}</td>
    <td>${esc(it.affects)}</td>
    <td>${esc(it.did)}</td>
    <td>${esc(it.verify)}</td>
    <td>${it.sources.map((s) => srcLink(s, 'docs')).join(' ')}</td>
  </tr>`,
).join('');

$('#f-count').textContent = String(ITEMS.length);
$('#f-count-note').textContent = 'flagged items';
$('#f-high').textContent = String(ITEMS.filter((i) => i.severity === 'high').length);
$('#f-med').textContent = String(ITEMS.filter((i) => i.severity === 'medium').length);
$('#f-low').textContent = String(ITEMS.filter((i) => i.severity === 'low').length);
