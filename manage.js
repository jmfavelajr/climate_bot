import { listOpenCandidates, updateCandidate } from './persist.js';
import { sellYes as submitSellYes, getPositions, getMarket } from './kalshi_orders.js';
import { exitDecision, dollars } from './entry_policy.js';

const TAKE_PROFIT_CAP = 0.99;

function positionCount(positions, ticker) {
  const list = positions?.market_positions || positions?.marketPositions || [];
  const row = list.find((p) => (p.ticker || p.market_ticker) === ticker);
  if (!row) return 0;
  return Math.abs(Number(row.position_fp ?? row.position ?? row.yes_count ?? 0));
}

export function allowNewEntry(market) {
  if (process.env.FLATTEN_EOD === '1') return { ok: false, ask: null, reason: 'eod_flatten' };
  const ask = dollars(market.yes_ask_dollars ?? market.yes_ask);
  if (!Number.isFinite(ask)) return { ok: false, ask, reason: 'no_ask' };
  if (ask < 0.02) return { ok: false, ask, reason: 'ask_too_thin' };
  return { ok: true, ask };
}

export async function manageOpenTrades({ flatten = false } = {}) {
  let positions = await getPositions();

  let rows = await listOpenCandidates();
  const live = positions?.market_positions || positions?.marketPositions || [];
  if (!rows.length && live.length) {
    rows = live
      .filter((p) => Math.abs(Number(p.position_fp ?? p.position ?? 0)) > 0)
      .map((p) => ({
        id: null,
        market_ticker: p.ticker || p.market_ticker,
        entry_yes_ask: p.average_price ?? p.average_price_dollars ?? null,
        yes_ask: p.average_price ?? p.average_price_dollars ?? null,
        reason: 'live_position',
      }));
    console.log(`Manage: no DB rows, tracking ${rows.length} live Kalshi positions`);
  }
  if (!rows.length && !flatten) {
    console.log('Manage: no open candidates');
    return;
  }

  for (const row of rows) {
    const market = await getMarket(row.market_ticker);
    const bid = dollars(market?.yes_bid_dollars ?? market?.yes_bid);
    const entry = dollars(row.entry_yes_ask ?? row.yes_ask);
    if (Number.isFinite(bid)) {
      await updateCandidate(row.id, { latest_yes_bid: bid });
    }
    const decision = exitDecision({ reason: row.reason, entry, bid, flatten });
    if (!decision.sell) {
      console.log(`Manage hold ${row.market_ticker} ${row.reason || ''} entry=${entry} bid=${bid} sl=${decision.sl} (${decision.why})`);
      continue;
    }
    const count = positionCount(positions, row.market_ticker);
    if (count <= 0) {
      await updateCandidate(row.id, {
        action: decision.why,
        latest_yes_bid: bid,
        reason: `${row.reason || ''}|${decision.why}`,
      });
      console.log(`Manage mark ${row.market_ticker} ${decision.why} but no live position`);
      continue;
    }
    try {
      console.log(`Selling YES ${row.market_ticker} count=${count} @ ${bid} (${decision.why})`);
      await submitSellYes(row.market_ticker, count, bid || TAKE_PROFIT_CAP);
      await updateCandidate(row.id, {
        action: decision.why,
        latest_yes_bid: bid,
        reason: `${row.reason || ''}|${decision.why}`,
      });
    } catch (err) {
      console.error(`Sell failed ${row.market_ticker}:`, err.data || err.message);
    }
  }
}
