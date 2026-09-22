import { SEED_VALUE as FIXED_DOLLARS } from './config.js';
import { CLIMATE_SERIES, eventTicker, kalshiDay, chicagoHourMinute, inKindWindow } from './series.js';
import { eventPicks, impliedYes, dollars, eventFromMarketTicker, isBetweenTicker, isThresholdTicker } from './entry_policy.js';
import { buyYes, getBalance, getPositions, getSeriesMarkets } from './kalshi_orders.js';
import { persistCandidate } from './persist.js';
import { manageOpenTrades } from './manage.js';

const MAX_TODAY = Number(process.env.MAX_TODAY_PICKS || 4);
const MAX_TOMORROW = Number(process.env.MAX_TOMORROW_PICKS || 4);
const MAX_NEW_PER_RUN = MAX_TODAY + MAX_TOMORROW;
const MAX_PER_EVENT = 1;
const MIN_ASK = 0.15;
const MAX_ASK_FAVORITE = Number(process.env.MAX_ASK_FAVORITE || 0.55);
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
  const canEnter = inKindWindow();
  console.log(
    `HIGH favorite-only scan ${today} / ${tomorrow} CT=${String(ct.hhmm).padStart(4, '0')} buyWin=1200-1300CT enter=${canEnter} seed=${FIXED_DOLLARS} cap=${MAX_TODAY}+${MAX_TOMORROW} ioc +${PAY_THROUGH}`
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
        book: askSize(pick.market),
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
    console.log(`RANK today ${p.city} ${p.market.ticker} T=${p.isT} ok=${p.okProfit} pot=${p.potential} ask=${p.ask} book=${p.book}`);
  }
  for (const p of tomorrowRanked) {
    console.log(`RANK tomorrow ${p.city} ${p.market.ticker} T=${p.isT} ok=${p.okProfit} pot=${p.potential} ask=${p.ask} book=${p.book}`);
  }

  const batch = [];
  for (const pick of selected) {
    const market = pick.market;
    const ask = pick.ask;
    const event = market.event_ticker || eventFromMarketTicker(market.ticker);
    const eventHeld = held.eventCounts.get(event) || 0;
    const okStrike = isBetweenTicker(market.ticker) || isThresholdTicker(market.ticker);
    const px = limitPrice(ask);
    const count = contractCount(px || ask);
    const cost = count * (px || ask);
    console.log(
      `MARKET PICK ${pick.horizon} ${pick.role} ${market.ticker} ${pick.city} CT=${String(ct.hhmm).padStart(4, '0')} enter=${canEnter} implied=${pick.implied} ask=${ask} px=${px} count=${count} cost=${cost.toFixed(2)} book=${pick.book} pot=${pick.potential}`
    );
    if (!canEnter) {
      console.log(`SKIP outside 12:00-13:00 CT now=${String(ct.hhmm).padStart(4, '0')}`);
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
    if (batch.length >= MAX_NEW_PER_RUN) {
      console.log(`SKIP cap ${MAX_NEW_PER_RUN}`);
      continue;
    }
    if (Number.isFinite(balance) && cost > balance * 0.35) {
      console.log(`SKIP size ${cost} too large vs balance ${balance}`);
      continue;
    }
    held.tickers.add(market.ticker);
    held.eventCounts.set(event, eventHeld + 1);
    if (Number.isFinite(balance)) balance -= cost;
    batch.push({ pick, market, ask, px, count, cost });
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
