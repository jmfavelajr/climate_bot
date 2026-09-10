import { listOpenCandidates, updateCandidate, persistCandidate } from './persist.js';
import { sellYes as submitSellYes, buyYes, getPositions, getMarket, getSeriesMarkets } from './kalshi_orders.js';
import {
  exitDecision,
  dollars,
  impliedYes,
  parseRole,
  eventFromMarketTicker,
  seriesFromEvent,
  pnlPct,
  resolveEntry,
  positionAvgPrice,
  isThresholdTicker,
} from './entry_policy.js';

const FIXED_DOLLARS = Number(process.env.FIXED_BET_DOLLARS || 4);
const MIN_ASK = 0.15;
const MAX_ASK = Number(process.env.MAX_ASK_FAVORITE || 0.55);

function liveList(positions) {
  return positions?.market_positions || positions?.marketPositions || [];
}

function positionByTicker(positions, ticker) {
  return liveList(positions).find((p) => (p.ticker || p.market_ticker) === ticker) || null;
}

function positionCount(positions, ticker) {
  const row = positionByTicker(positions, ticker);
  if (!row) return 0;
  return Math.abs(Number(row.position_fp ?? row.position ?? row.yes_count ?? 0));
}

function contractCount(ask) {
  if (!Number.isFinite(ask) || ask <= 0) return 1;
  return Math.max(1, Math.min(20, Math.round(FIXED_DOLLARS / ask)));
}

function liveRows(positions) {
  return liveList(positions)
    .filter((p) => Math.abs(Number(p.position_fp ?? p.position ?? 0)) > 0)
    .map((p) => {
      const ticker = p.ticker || p.market_ticker;
      const avg = positionAvgPrice(p);
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
    const existing = byTicker.get(row.market_ticker);
    if (!existing) {
      byTicker.set(row.market_ticker, row);
      console.log(`Manage union live orphan ${row.market_ticker} event=${row.event_ticker} avg=${row.entry_yes_ask}`);
      continue;
    }
    const dbEntry = resolveEntry(existing.entry_yes_ask, existing.yes_ask);
    if (!dbEntry && row.entry_yes_ask) {
      existing.entry_yes_ask = row.entry_yes_ask;
      existing.yes_ask = row.entry_yes_ask;
      console.log(`Manage backfill entry ${row.market_ticker} from Kalshi avg=${row.entry_yes_ask}`);
    }
  }
  return [...byTicker.values()];
}

async function liveFavoriteTicker(eventTicker) {
  if (!eventTicker) return null;
  const markets = await getSeriesMarkets(seriesFromEvent(eventTicker));
  const top = [...(markets || [])]
    .filter((m) => m.event_ticker === eventTicker)
    .sort((a, b) => impliedYes(b) - impliedYes(a))[0];
  return top?.ticker || null;
}

async function buyFavoriteT(liveFav, eventTicker) {
  if (!isThresholdTicker(liveFav)) return;
  const tMarket = await getMarket(liveFav);
  const ask = dollars(tMarket?.yes_ask_dollars ?? tMarket?.yes_ask);
  if (!Number.isFinite(ask) || ask < MIN_ASK || ask > MAX_ASK) {
    console.log(`FLIP skip buy ${liveFav} ask=${ask}`);
    return;
  }
  const count = contractCount(ask);
  try {
    await persistCandidate(tMarket || { ticker: liveFav, event_ticker: eventTicker }, null, {
      action: 'live',
      reason: 'flip_to_T_favorite',
      entry_yes_ask: ask,
    });
    console.log(`FLIP BUY YES ${liveFav} count=${count} @ ${ask}`);
    await buyYes(liveFav, count, ask);
  } catch (err) {
    console.error(`FLIP buy failed ${liveFav}:`, err.data || err.message);
  }
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

  const flippedEvents = new Set();

  for (const row of rows) {
    const eventTicker = row.event_ticker || eventFromMarketTicker(row.market_ticker);
    const opened = row.run_at || 'unknown';
    const livePos = positionByTicker(positions, row.market_ticker);
    const market = await getMarket(row.market_ticker);
    const status = String(market?.status || '').toLowerCase();
    const bid = dollars(market?.yes_bid_dollars ?? market?.yes_bid);
    const entry = resolveEntry(row.entry_yes_ask, row.yes_ask, positionAvgPrice(livePos));
    const storedPeak = resolveEntry(row.live_sigma);
    const peak = [storedPeak, bid, entry].filter((n) => Number.isFinite(n) && n > 0).reduce((a, b) => Math.max(a, b), entry || 0);
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

    if (row.id && Number.isFinite(entry) && entry > 0) {
      await updateCandidate(row.id, {
        reason,
        entry_yes_ask: entry,
        yes_ask: row.yes_ask || entry,
        latest_yes_bid: Number.isFinite(bid) ? bid : undefined,
        live_sigma: Number.isFinite(peak) && peak > 0 ? peak : undefined,
        pnl: Number.isFinite(pnl) ? pnl : undefined,
      });
    } else if (row.id) {
      await updateCandidate(row.id, {
        reason,
        latest_yes_bid: Number.isFinite(bid) ? bid : undefined,
        live_sigma: Number.isFinite(peak) && peak > 0 ? peak : undefined,
        pnl: Number.isFinite(pnl) ? pnl : undefined,
      });
    }
    if (row.from_live && !row.id && entry) {
      await persistCandidate(
        { ticker: row.market_ticker, event_ticker: eventTicker },
        null,
        { action: 'live', reason, entry_yes_ask: entry }
      );
    }

    if (status.includes('close') || status.includes('settled')) {
      await updateCandidate(row.id, {
        action: 'settled',
        latest_yes_bid: bid,
        live_sigma: peak,
        pnl,
        reason: `${reason}|settled_${status}`,
      });
      console.log(`SETTLED ${row.market_ticker} opened=${opened} entry=${entry} lastBid=${bid} peak=${peak} pnl=${pnl}% status=${status}`);
      continue;
    }

    const decision = exitDecision({ reason, entry, bid, peak, liveFav, ticker: row.market_ticker });
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
    const sellPx = Number.isFinite(bid) && bid > 0 ? bid : 0.01;
    try {
      console.log(`Selling YES ${row.market_ticker} count=${count} @ ${sellPx} (${decision.why}) entry=${entry} peak=${peak} pnl=${pnl}% opened=${opened}`);
      await submitSellYes(row.market_ticker, count, sellPx);
      await updateCandidate(row.id, {
        action: decision.why,
        latest_yes_bid: bid,
        live_sigma: peak,
        pnl,
        reason: `${reason}|${decision.why}`,
      });
      if (decision.why === 'flip_B_to_T' && liveFav && !flippedEvents.has(eventTicker)) {
        flippedEvents.add(eventTicker);
        await buyFavoriteT(liveFav, eventTicker);
      }
    } catch (err) {
      const code = err.data?.error?.code || err.message;
      if (String(code).includes('market_closed')) {
        await updateCandidate(row.id, { action: 'settled', reason: `${reason}|market_closed`, latest_yes_bid: bid, pnl });
      }
      console.error(`Sell failed ${row.market_ticker}:`, err.data || err.message);
    }
  }
}
