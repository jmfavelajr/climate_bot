import { CLIMATE_SERIES, eventTicker, kalshiDay } from './series.js';
import { eventPicks, impliedYes, dollars } from './entry_policy.js';
import { buyYes, getBalance, getPositions, getSeriesMarkets } from './kalshi_orders.js';
import { persistCandidate } from './persist.js';
import { manageOpenTrades } from './manage.js';

const FIXED_DOLLARS = Number(process.env.FIXED_BET_DOLLARS || 1);
const MAX_NEW_PER_RUN = Number(process.env.MAX_NEW_PER_RUN || 6);
const MIN_ASK = 0.02;

function askOf(market) {
  return dollars(market.yes_ask_dollars ?? market.yes_ask);
}

function positionTickers(positions) {
  const list = positions?.market_positions || positions?.marketPositions || [];
  const set = new Set();
  for (const p of list) {
    if (Math.abs(Number(p.position_fp ?? p.position ?? 0)) > 0) {
      set.add(p.ticker || p.market_ticker);
    }
  }
  return set;
}

function contractCount(ask) {
  if (!Number.isFinite(ask) || ask <= 0) return 1;
  return Math.max(1, Math.min(4, Math.round(FIXED_DOLLARS / ask)));
}

async function main() {
  const today = kalshiDay(0);
  const tomorrow = kalshiDay(1);
  console.log(`Kalshi-only scan ${today} / ${tomorrow} (no NWS, no Open-Meteo, no Kelly)`);

  let balance = null;
  try {
    balance = await getBalance();
    console.log(`Connected to Kalshi. Balance: ${balance}`);
  } catch (err) {
    console.error('Balance read failed', err.data || err.message);
  }

  const positions = await getPositions();
  const held = positionTickers(positions);

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

  if (process.env.FLATTEN_EOD === '1') {
    console.log('EOD flatten — no new entries');
  } else {
    let placed = 0;
    for (const pick of picks) {
      const market = pick.market;
      const implied = impliedYes(market);
      const ask = askOf(market);
      console.log(`MARKET PICK ${pick.horizon} ${pick.role} ${market.ticker} implied=${implied} ask=${ask}`);
      if (held.has(market.ticker)) {
        console.log(`SKIP already held ${market.ticker}`);
        continue;
      }
      if (!Number.isFinite(ask) || ask < MIN_ASK) {
        console.log(`SKIP thin/no ask ${market.ticker}`);
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
        console.log(`BUY YES ${market.ticker} count=${count} @ ${ask} (${pick.reason})`);
        await buyYes(market.ticker, count, ask);
        placed += 1;
        held.add(market.ticker);
        if (Number.isFinite(balance)) balance -= cost;
      } catch (err) {
        console.error(`Buy failed ${market.ticker}:`, err.data || err.message);
      }
    }
    console.log(`New orders this run: ${placed}`);
  }

  await manageOpenTrades({ flatten: process.env.FLATTEN_EOD === '1' });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
