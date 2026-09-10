import { CLIMATE_SERIES, eventTicker, kalshiDay, chicagoHourMinute, localHourMinute, inKindWindow } from './series.js';
import { eventPicks, impliedYes, dollars, eventFromMarketTicker, isBetweenTicker, isThresholdTicker } from './entry_policy.js';
import { buyYes, getBalance, getPositions, getSeriesMarkets } from './kalshi_orders.js';
import { persistCandidate } from './persist.js';
import { manageOpenTrades } from './manage.js';

const FIXED_DOLLARS = Number(process.env.FIXED_BET_DOLLARS || 4);
const MAX_TODAY = Number(process.env.MAX_TODAY_PICKS || 4);
const MAX_TOMORROW = Number(process.env.MAX_TOMORROW_PICKS || 4);
const MAX_NEW_PER_RUN = MAX_TODAY + MAX_TOMORROW;
const MAX_PER_EVENT = 1;
const MIN_ASK = 0.15;
const MAX_ASK_FAVORITE = Number(process.env.MAX_ASK_FAVORITE || 0.55);

function askOf(market) {
  return dollars(market.yes_ask_dollars ?? market.yes_ask);
}

function profitMultiple(ask) {
  if (!Number.isFinite(ask) || ask <= 0) return 0;
  return Number((1 / ask).toFixed(4));
}

function clearsProfit(ask) {
  return Number.isFinite(ask) && ask >= MIN_ASK && ask <= MAX_ASK_FAVORITE;
}

function rankPicks(picks) {
  return [...picks].sort((a, b) => {
    if (b.isT !== a.isT) return b.isT - a.isT;
    if (b.okProfit !== a.okProfit) return b.okProfit - a.okProfit;
    return b.potential - a.potential;
  });
}

function heldByEvent(positions) {
  const list = positions?.market_positions || positions?.marketPositions || [];
  const tickers = new Set();
  const eventCounts = new Map();
  for (const p of list) {
    if (Math.abs(Number(p.position_fp ?? p.position ?? 0)) <= 0) continue;
    const ticker = p.ticker || p.market_ticker;
    tickers.add(ticker);
    const event = eventFromMarketTicker(ticker);
    eventCounts.set(event, (eventCounts.get(event) || 0) + 1);
  }
  return { tickers, eventCounts };
}

function contractCount(ask) {
  if (!Number.isFinite(ask) || ask <= 0) return 1;
  return Math.max(1, Math.min(20, Math.round(FIXED_DOLLARS / ask)));
}

async function main() {
  const today = kalshiDay(0);
  const tomorrow = kalshiDay(1);
  const ct = chicagoHourMinute();
  const openedAt = new Date().toISOString();
  console.log(`HIGH favorite-only scan ${today} / ${tomorrow} CT=${String(ct.hhmm).padStart(4, '0')} clip=${FIXED_DOLLARS} cap=${MAX_TODAY}+${MAX_TOMORROW}`);

  await manageOpenTrades();

  let balance = null;
  try {
    balance = await getBalance();
    console.log(`Connected to Kalshi. Balance: ${balance}`);
  } catch (err) {
    console.error('Balance read failed', err.data || err.message);
  }

  const positions = await getPositions();
  const held = heldByEvent(positions);

  const scored = [];
  for (const row of CLIMATE_SERIES) {
    const markets = await getSeriesMarkets(row.series);
    const todayEvent = eventTicker(row.series, 0);
    const tomorrowEvent = eventTicker(row.series, 1);
    const chosen = eventPicks(markets, todayEvent, tomorrowEvent);
    for (const pick of chosen) {
      const ask = askOf(pick.market);
      scored.push({
        ...pick,
        city: row.city,
        kind: row.kind,
        tz: row.tz,
        ask,
        implied: impliedYes(pick.market),
        isT: isThresholdTicker(pick.market?.ticker) ? 1 : 0,
        okProfit: clearsProfit(ask) ? 1 : 0,
        potential: clearsProfit(ask) ? profitMultiple(ask) : 0,
      });
    }
  }

  const todayRanked = rankPicks(scored.filter((p) => p.horizon === 'today'));
  const tomorrowRanked = rankPicks(scored.filter((p) => p.horizon === 'tomorrow'));
  const selected = [...todayRanked.slice(0, MAX_TODAY), ...tomorrowRanked.slice(0, MAX_TOMORROW)];

  for (const p of todayRanked) {
    console.log(`RANK today ${p.city} ${p.market.ticker} T=${p.isT} ok=${p.okProfit} pot=${p.potential} ask=${p.ask}`);
  }
  for (const p of tomorrowRanked) {
    console.log(`RANK tomorrow ${p.city} ${p.market.ticker} T=${p.isT} ok=${p.okProfit} pot=${p.potential} ask=${p.ask}`);
  }

  let placed = 0;
  for (const pick of selected) {
    const market = pick.market;
    const ask = pick.ask;
    const event = market.event_ticker || eventFromMarketTicker(market.ticker);
    const eventHeld = held.eventCounts.get(event) || 0;
    const local = localHourMinute(pick.tz);
    const canEnter = inKindWindow(pick.kind, pick.tz, pick.horizon);
    const okStrike = isBetweenTicker(market.ticker) || isThresholdTicker(market.ticker);
    console.log(
      `MARKET PICK ${pick.horizon} ${pick.role} ${market.ticker} ${pick.city} local=${String(local.hhmm).padStart(4, '0')} enter=${canEnter} implied=${pick.implied} ask=${ask} pot=${pick.potential}`
    );
    if (!canEnter) {
      console.log(`SKIP outside HIGH window ${pick.city} local=${String(local.hhmm).padStart(4, '0')}`);
      continue;
    }
    if (!okStrike) {
      console.log(`SKIP unsupported strike ${market.ticker}`);
      continue;
    }
    if (!pick.okProfit) {
      console.log(`SKIP profit band ${market.ticker} ask=${ask}`);
      continue;
    }
    if (held.tickers.has(market.ticker)) {
      console.log(`SKIP already held ticker ${market.ticker}`);
      continue;
    }
    if (eventHeld >= MAX_PER_EVENT) {
      console.log(`SKIP event ${event} already has a ticket`);
      continue;
    }
    if (placed >= MAX_NEW_PER_RUN) {
      console.log(`SKIP cap ${MAX_NEW_PER_RUN}`);
      continue;
    }
    const count = contractCount(ask);
    const cost = count * ask;
    if (Number.isFinite(balance) && cost > balance * 0.35) {
      console.log(`SKIP size ${cost} too large vs balance ${balance}`);
      continue;
    }
    try {
      await persistCandidate(market, null, {
        action: 'live',
        reason: pick.reason,
        entry_yes_ask: ask,
        confidence: Math.round(pick.implied * 100),
      });
      console.log(`BUY YES ${market.ticker} count=${count} @ ${ask} (${pick.reason}) pot=${pick.potential} opened=${openedAt}`);
      await buyYes(market.ticker, count, ask);
      placed += 1;
      held.tickers.add(market.ticker);
      held.eventCounts.set(event, eventHeld + 1);
      if (Number.isFinite(balance)) balance -= cost;
    } catch (err) {
      console.error(`Buy failed ${market.ticker}:`, err.data || err.message);
    }
  }
  console.log(`New orders this run: ${placed}`);

  await manageOpenTrades();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
