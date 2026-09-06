import { listOpenCandidates, updateCandidate, persistCandidate } from './persist.js';
import { sellYes as submitSellYes, getPositions, getMarket, getSeriesMarkets } from './kalshi_orders.js';
import {
  exitDecision,
  dollars,
  impliedYes,
  pickByImplied,
  parseRole,
  eventFromMarketTicker,
  seriesFromEvent,
  pnlPct,
} from './entry_policy.js';

const TAKE_PROFIT_CAP = 0.99;

function liveList(positions) {
  return positions?.market_positions || positions?.marketPositions || [];
}

function positionCount(positions, ticker) {
  const row = liveList(positions).find((p) => (p.ticker || p.market_ticker) === ticker);
  if (!row) return 0;
  return Math.abs(Number(row.position_fp ?? row.position ?? row.yes_count ?? 0));
}

function liveRows(positions) {
  return liveList(positions)
    .filter((p) => Math.abs(Number(p.position_fp ?? p.position ?? 0)) > 0)
    .map((p) => {
      const ticker = p.ticker || p.market_ticker;
      const avg = dollars(p.average_price ?? p.average_price_dollars);
      return {
        id: null,
        market_ticker: ticker,
        event_ticker: eventFromMarketTicker(ticker),
        entry_yes_ask: avg,
        yes_ask: avg,
        reason: 'live_position',
        run_at: p.created_time || p.ts || null,
        from_live: true,
      };
    });
}

function mergeRows(dbRows, positions) {
  const live = liveRows(positions);
  const byTicker = new Map();
  for (const row of dbRows || []) {
    if (!row?.market_ticker) continue;
    byTicker.set(row.market_ticker, {
      ...row,
      event_ticker: row.event_ticker || eventFromMarketTicker(row.market_ticker),
    });
  }
  for (const row of live) {
    if (!byTicker.has(row.market_ticker)) {
      byTicker.set(row.market_ticker, row);
      console.log(`Manage union live orphan ${row.market_ticker} event=${row.event_ticker}`);
    }
  }
  return [...byTicker.values()];
}

async function liveFavoriteTicker(eventTicker) {
  if (!eventTicker) return null;
  const markets = await getSeriesMarkets(seriesFromEvent(eventTicker));
  const top = pickByImplied(
    (markets || []).filter((m) => m.event_ticker === eventTicker),
    1
  )[0];
  return top?.ticker || null;
}

export async function manageOpenTrades({ flatten = false } = {}) {
  const positions = await getPositions();
  const dbRows = await listOpenCandidates();
  const rows = mergeRows(dbRows, positions);
  if (!rows.length && !flatten) {
    console.log('Manage: no open candidates or live positions');
    return;
  }

  const favCache = new Map();
  async function favoriteOf(eventTicker) {
    if (!eventTicker) return null;
    if (!favCache.has(eventTicker)) {
      favCache.set(eventTicker, await liveFavoriteTicker(eventTicker));
    }
    return favCache.get(eventTicker);
  }

  for (const row of rows) {
    const eventTicker = row.event_ticker || eventFromMarketTicker(row.market_ticker);
    const opened = row.run_at || 'unknown';
    const market = await getMarket(row.market_ticker);
    const status = String(market?.status || '').toLowerCase();
    const bid = dollars(market?.yes_bid_dollars ?? market?.yes_bid);
    const entry = dollars(row.entry_yes_ask ?? row.yes_ask);
    const storedPeak = dollars(row.live_sigma);
    const peak = [storedPeak, bid, entry].filter(Number.isFinite).reduce((a, b) => Math.max(a, b), 0);
    const pnl = pnlPct(entry, bid);
    const implied = market ? impliedYes(market) : bid;
    const liveFav = await favoriteOf(eventTicker);
    const { role } = parseRole(row.reason);
    let reason = row.reason || 'live_position';

    if (liveFav && row.market_ticker === liveFav && role === 'runner') {
      reason = reason.includes('today') ? 'today_favorite|promoted' : 'tomorrow_favorite|promoted';
      console.log(`PROMOTE ${row.market_ticker} runner -> favorite opened=${opened} implied=${implied}`);
      row.reason = reason;
    } else if (liveFav && row.market_ticker !== liveFav && role === 'favorite') {
      reason = reason.includes('today') ? 'today_runner|demoted' : 'tomorrow_runner|demoted';
      console.log(`DEMOTE ${row.market_ticker} favorite -> runner liveFav=${liveFav} opened=${opened}`);
      row.reason = reason;
    }

    if (row.id) {
      await updateCandidate(row.id, {
        reason,
        latest_yes_bid: Number.isFinite(bid) ? bid : undefined,
        live_sigma: Number.isFinite(peak) ? peak : undefined,
        pnl: Number.isFinite(pnl) ? pnl : undefined,
      });
    }
    if (row.from_live && !row.id) {
      await persistCandidate(
        { ticker: row.market_ticker, event_ticker: eventTicker },
        null,
        { action: 'live', reason, entry_yes_ask: entry }
      );
    }

    if (status.includes('close') || status.includes('settled')) {
      await updateCandidate(row.id, { action: 'settled_or_closed', reason: `${reason}|market_${status}` });
      console.log(`Manage skip closed ${row.market_ticker} status=${status}`);
      continue;
    }

    const decision = exitDecision({ reason, entry, bid, peak, flatten });
    const count = positionCount(positions, row.market_ticker);
    if (!decision.sell) {
      console.log(
        `Manage hold ${row.market_ticker} ${reason} opened=${opened} entry=${entry} bid=${bid} peak=${peak} pnl=${pnl}% trail=${decision.trail} armed=${decision.armed} liveFav=${liveFav} (${decision.why})`
      );
      continue;
    }
    if (count <= 0) {
      await updateCandidate(row.id, { action: decision.why, latest_yes_bid: bid, reason: `${reason}|${decision.why}`, pnl });
      console.log(`Manage mark ${row.market_ticker} ${decision.why} but no live position`);
      continue;
    }
    try {
      console.log(`Selling YES ${row.market_ticker} count=${count} @ ${bid} (${decision.why}) peak=${peak} pnl=${pnl}% opened=${opened}`);
      await submitSellYes(row.market_ticker, count, bid || TAKE_PROFIT_CAP);
      await updateCandidate(row.id, {
        action: decision.why,
        latest_yes_bid: bid,
        live_sigma: peak,
        pnl,
        reason: `${reason}|${decision.why}`,
      });
    } catch (err) {
      const code = err.data?.error?.code || err.message;
      if (String(code).includes('market_closed')) {
        await updateCandidate(row.id, { action: 'market_closed', reason: `${reason}|market_closed` });
      }
      console.error(`Sell failed ${row.market_ticker}:`, err.data || err.message);
    }
  }
}
