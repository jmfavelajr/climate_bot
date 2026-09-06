import { CLIMATE_SERIES, eventTicker, kalshiDay, chicagoHourMinute } from './series.js';
import { eventPicks, impliedYes, dollars, eventFromMarketTicker } from './entry_policy.js';
import { buyYes, getBalance, getPositions, getSeriesMarkets } from './kalshi_orders.js';
import { persistCandidate } from './persist.js';
import { manageOpenTrades } from './manage.js';

const FIXED_DOLLARS = Number(process.env.FIXED_BET_DOLLARS || 2);
const MAX_NEW_PER_RUN = Number(process.env.MAX_NEW_PER_RUN || 6);
const MAX_PER_EVENT = Number(process.env.MAX_PER_EVENT || 2);
const MIN_ASK = 0.02;
const MAX_ASK_FAVORITE = Number(process.env.MAX_ASK_FAVORITE || 0.55);
const MAX_ASK_RUNNER = Number(process.env.MAX_ASK_RUNNER || 0.40);
const ENTRY_START = Number(process.env.ENTRY_START_HHMM || 600);
const ENTRY_END = Number(process.env.ENTRY_END_HHMM || 1400);

function askOf(market) {
  return dollars(market.yes_ask_dollars ?? market.yes_ask);
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
  return Math.max(1, Math.min(8, Math.round(FIXED_DOLLARS / ask)));
}

function inEntryWindow(hhmm) {
  return hhmm >= ENTRY_START && hhmm < ENTRY_END;
}

async function main() {
  const today = kalshiDay(0);
  const tomorrow = kalshiDay(1);
  const clock = chicagoHourMinute();
  const openedAt = new Date().toISOString();
  const canEnter = inEntryWindow(clock.hhmm);
  console.log(`Kalshi-only scan ${today} / ${tomorrow} CT=${String(clock.hhmm).padStart(4, '0')} enter=${canEnter} clip=${FIXED_DOLLARS}`);

  let balance = null;
  try {
    balance = await getBalance();
    console.log(`Connected to Kalshi. Balance: ${balance}`);
  } catch (err) {
    console.error('Balance read failed', err.data || err.message);
  }

  const positions = await getPositions();
  const held = heldByEvent(positions);

  const picks = [];
  for (const row of CLIMATE_SERIES) {
    const markets = await getSeriesMarkets(row.series);
    const todayEvent = eventTicker(row.series, 0);
    const tomorrowEvent = eventTicker(row.series, 1);
    const chosen = eventPicks(markets, todayEvent, tomorrowEvent);
    for (const pick of chosen) {
      pick.city = row.city;
      pick.kind = row.kind;
      picks.push(pick);
    }
  }

  let placed = 0;
  if (!canEnter) {
    console.log(`SKIP all new entries outside ${ENTRY_START}-${ENTRY_END} CT`);
  } else {
    for (const pick of picks) {
      const market = pick.market;
      const implied = impliedYes(market);
      const ask = askOf(market);
      const event = market.event_ticker || eventFromMarketTicker(market.ticker);
      const eventHeld = held.eventCounts.get(event) || 0;
      const maxAsk = pick.role === 'runner' ? MAX_ASK_RUNNER : MAX_ASK_FAVORITE;
      console.log(`MARKET PICK ${pick.horizon} ${pick.role} ${market.ticker} implied=${implied} ask=${ask} maxAsk=${maxAsk}`);
      if (held.tickers.has(market.ticker)) {
        console.log(`SKIP already held ticker ${market.ticker}`);
        continue;
      }
      if (eventHeld >= MAX_PER_EVENT) {
        console.log(`SKIP event ${event} already has ${eventHeld} tickets`);
        continue;
      }
      if (!Number.isFinite(ask) || ask < MIN_ASK) {
        console.log(`SKIP thin/no ask ${market.ticker}`);
        continue;
      }
      if (ask > maxAsk) {
        console.log(`SKIP ask ${ask} above ${maxAsk} (${pick.role})`);
        continue;
      }
      if (placed >= MAX_NEW_PER_RUN) {
        console.log(`SKIP cap ${MAX_NEW_PER_RUN} new orders this run`);
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
          confidence: Math.round(implied * 100),
        });
        console.log(`BUY YES ${market.ticker} count=${count} @ ${ask} (${pick.reason}) opened=${openedAt}`);
        await buyYes(market.ticker, count, ask);
        placed += 1;
        held.tickers.add(market.ticker);
        held.eventCounts.set(event, eventHeld + 1);
        if (Number.isFinite(balance)) balance -= cost;
      } catch (err) {
        console.error(`Buy failed ${market.ticker}:`, err.data || err.message);
      }
    }
  }
  console.log(`New orders this run: ${placed}`);

  await manageOpenTrades();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
