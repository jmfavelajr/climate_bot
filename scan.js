import { SEED_VALUE as FIXED_DOLLARS } from './config.js';
import { CLIMATE_SERIES, eventTicker, kalshiDay, chicagoHourMinute, inKindWindow } from './series.js';
import {
  eventPicks,
  impliedYes,
  dollars,
  eventFromMarketTicker,
  seriesFromTicker,
  isBetweenTicker,
  isThresholdTicker,
} from './entry_policy.js';
import { buyYes, getBalance, getPositions, getSeriesMarkets } from './kalshi_orders.js';
import { persistCandidate } from './persist.js';
import { manageOpenTrades } from './manage.js';

const MIN_MULT = Number(process.env.MIN_PROFIT_MULT || 2);
const MAX_ASK = Number((1 / MIN_MULT).toFixed(4));
const MIN_ASK = 0.15;
const PAY_THROUGH = Number(process.env.PAY_THROUGH || 0.02);
const MAX_CONTRACTS = Number(process.env.MAX_CONTRACTS || 25);
const BUY_RETRIES = Number(process.env.BUY_RETRIES || 3);

function askOf(market) {
  return dollars(market.yes_ask_dollars ?? market.yes_ask);
}

function askSize(market) {
  const n = Number(
    market?.yes_ask_size_fp ?? market?.yes_ask_size ?? market?.volume_fp ?? market?.volume ?? 0
  );
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function limitPrice(ask) {
  if (!Number.isFinite(ask) || ask <= 0) return null;
  return Number(Math.min(0.99, ask + PAY_THROUGH).toFixed(4));
}

function profitMultiple(ask) {
  if (!Number.isFinite(ask) || ask <= 0) return 0;
  return Number((1 / ask).toFixed(4));
}

function clears2x(ask) {
  return Number.isFinite(ask) && ask >= MIN_ASK && ask <= MAX_ASK && profitMultiple(ask) >= MIN_MULT;
}

function heldSeries(positions) {
  const list = positions?.market_positions || positions?.marketPositions || [];
  const tickers = new Set();
  const series = new Set();
  for (const p of list) {
    if (Math.abs(Number(p.position_fp ?? p.position ?? 0)) <= 0) continue;
    const ticker = p.ticker || p.market_ticker;
    tickers.add(ticker);
    series.add(seriesFromTicker(ticker));
  }
  return { tickers, series };
}

function contractCount(px) {
  if (!Number.isFinite(px) || px <= 0) return 1;
  return Math.max(1, Math.min(MAX_CONTRACTS, Math.ceil(FIXED_DOLLARS / px)));
}

async function fillToSeed(ticker, px, reason) {
  let filled = 0;
  for (let attempt = 1; attempt <= BUY_RETRIES; attempt += 1) {
    const notional = filled * px;
    if (notional + 0.005 >= FIXED_DOLLARS) break;
    const remain = contractCount(px) - filled;
    if (remain <= 0) break;
    console.log(`BUY IOC YES ${ticker} try=${attempt} remain=${remain} filled=${filled} limit=${px} (${reason})`);
    const result = await buyYes(ticker, remain, px);
    const got = Number(result?.fills || 0);
    filled += got;
    console.log(`FILL ${ticker} try=${attempt} got=${got} total=${filled} notional=${(filled * px).toFixed(2)}`);
    if (got <= 0) break;
  }
  return filled;
}

async function main() {
  const today = kalshiDay(0);
  const tomorrow = kalshiDay(1);
  const ct = chicagoHourMinute();
  const openedAt = new Date().toISOString();
  console.log(
    `HIGH scan ${today} / ${tomorrow} CT=${String(ct.hhmm).padStart(4, '0')} localWin=0900-1400 seed=${FIXED_DOLLARS} minMult=${MIN_MULT} maxAsk=${MAX_ASK}`
  );

  await manageOpenTrades();

  let balance = null;
  try {
    balance = await getBalance();
    console.log(`Connected to Kalshi. Balance: ${balance}`);
  } catch (err) {
    console.error('Balance read failed', err.data || err.message);
  }

  const positions = await getPositions();
  const held = heldSeries(positions);

  const bySeries = new Map();
  for (const row of CLIMATE_SERIES) {
    const markets = await getSeriesMarkets(row.series);
    const todayEvent = eventTicker(row.series, 0);
    const tomorrowEvent = eventTicker(row.series, 1);
    const chosen = eventPicks(markets, todayEvent, tomorrowEvent);
    const scored = [];
    for (const pick of chosen) {
      const ask = askOf(pick.market);
      const px = limitPrice(ask);
      const pot = profitMultiple(ask);
      scored.push({
        ...pick,
        city: row.city,
        series: row.series,
        tz: row.tz,
        ask,
        px,
        book: askSize(pick.market),
        implied: impliedYes(pick.market),
        isT: isThresholdTicker(pick.market?.ticker) ? 1 : 0,
        ok2x: clears2x(ask) ? 1 : 0,
        potential: pot,
      });
    }
    bySeries.set(row.series, { row, scored });
    for (const p of scored) {
      console.log(
        `RANK ${p.horizon} ${p.role} ${p.city} ${p.market.ticker} ask=${p.ask} pot=${p.potential} 2x=${p.ok2x} implied=${p.implied}`
      );
    }
  }

  const batch = [];
  for (const { row, scored } of bySeries.values()) {
    const local = inKindWindow(row.kind, row.tz);
    if (!local) {
      console.log(`SKIP ${row.city} outside 09:00-14:00 ${row.tz}`);
      continue;
    }
    if (held.series.has(row.series)) {
      console.log(`SKIP ${row.city} series ${row.series} already has a ticket`);
      continue;
    }
    const eligible = scored.filter((p) => {
      const okStrike = isBetweenTicker(p.market.ticker) || isThresholdTicker(p.market.ticker);
      return okStrike && p.ok2x && !held.tickers.has(p.market.ticker);
    });
    eligible.sort((a, b) => b.potential - a.potential);
    const pick = eligible[0];
    if (!pick) {
      console.log(`SKIP ${row.city} no 2x favorite/runner`);
      continue;
    }
    const count = contractCount(pick.px || pick.ask);
    const cost = count * (pick.px || pick.ask);
    console.log(
      `MARKET PICK ${pick.horizon} ${pick.role} ${pick.market.ticker} ${pick.city} pot=${pick.potential} ask=${pick.ask} px=${pick.px} count=${count} cost=${cost.toFixed(2)}`
    );
    if (Number.isFinite(balance) && cost > balance * 0.35) {
      console.log(`SKIP size ${cost} too large vs balance ${balance}`);
      continue;
    }
    held.tickers.add(pick.market.ticker);
    held.series.add(row.series);
    if (Number.isFinite(balance)) balance -= cost;
    batch.push({ pick, market: pick.market, ask: pick.ask, px: pick.px, count, cost });
  }

  const results = await Promise.all(
    batch.map(async ({ pick, market, ask, px }) => {
      try {
        const fills = await fillToSeed(market.ticker, px || ask, pick.reason);
        const notional = fills * (px || ask);
        if (fills <= 0) {
          console.log(`NO FILL ${market.ticker} — not persisted`);
          return false;
        }
        if (notional + 0.005 < FIXED_DOLLARS) {
          console.log(`UNDERSEED ${market.ticker} fills=${fills} notional=${notional.toFixed(2)} seed=${FIXED_DOLLARS}`);
        }
        await persistCandidate(market, null, {
          action: 'live',
          reason: pick.reason,
          entry_yes_ask: px || ask,
          confidence: Math.round(pick.implied * 100),
        });
        console.log(`FILLED ${market.ticker} fills=${fills} notional=${notional.toFixed(2)} @ ${px} opened=${openedAt}`);
        return true;
      } catch (err) {
        console.error(`Buy failed ${market.ticker}:`, err.data || err.message);
        return false;
      }
    })
  );
  const placed = results.filter(Boolean).length;
  console.log(`New orders this run: ${placed} (batch=${batch.length})`);

  await manageOpenTrades();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
