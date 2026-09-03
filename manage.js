import kalshiPkg from 'kalshi-typescript';
import { listOpenCandidates, updateCandidate } from './persist.js';
import { sellYes as submitSellYes } from './kalshi_orders.js';
import { exitDecision } from './entry_policy.js';

const MAX_ENTRY = 0.50;
const TAKE_PROFIT_MULT = 2;
const TAKE_PROFIT_CAP = 0.99;

const Configuration = kalshiPkg.Configuration;
const MarketsApi = kalshiPkg.MarketApi;
const PortfolioApi = kalshiPkg.PortfolioApi;
const OrdersApi = kalshiPkg.OrdersApi;

function dollars(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return n > 1 ? n / 100 : n;
}

function client() {
  const config = new Configuration({
    apiKey: process.env.KALSHI_API_KEY_ID,
    privateKeyPem: process.env.KALSHI_PRIVATE_KEY,
    basePath: 'https://api.elections.kalshi.com/trade-api/v2',
  });
  return {
    marketsApi: new MarketsApi(config),
    portfolioApi: new PortfolioApi(config),
    ordersApi: new OrdersApi(config),
  };
}

async function fetchMarket(marketsApi, ticker) {
  try {
    const res = await marketsApi.getMarket(ticker);
    return res?.data?.market || res?.data || null;
  } catch (err) {
    try {
      const res = await fetch(`https://api.elections.kalshi.com/trade-api/v2/markets/${encodeURIComponent(ticker)}`);
      if (!res.ok) return null;
      const data = await res.json();
      return data.market || data;
    } catch {
      console.error('market lookup failed', ticker, err.message);
      return null;
    }
  }
}

function positionCount(positions, ticker) {
  const list = positions?.market_positions || positions?.marketPositions || [];
  const row = list.find((p) => (p.ticker || p.market_ticker) === ticker);
  if (!row) return 0;
  return Math.abs(Number(row.position_fp ?? row.position ?? row.yes_count ?? 0));
}

async function sellYes(_ordersApi, ticker, count, bid) {
  const price = Math.max(0.01, Number((bid ?? TAKE_PROFIT_CAP).toFixed(4)));
  console.log(`Selling YES ${ticker} count=${Math.max(1, Math.floor(count) || 1)} @ ${price}`);
  return submitSellYes(ticker, Math.max(1, Math.floor(count) || 1), price);
}

export function allowNewEntry(market) {
  if (process.env.FLATTEN_EOD === '1') return { ok: false, ask: null, reason: 'eod_flatten' };
  const ask = dollars(market.yes_ask_dollars ?? market.yes_ask);
  if (!Number.isFinite(ask)) return { ok: false, ask, reason: 'no_ask' };
  if (ask < 0.02) return { ok: false, ask, reason: 'ask_too_thin' };
  return { ok: true, ask };
}

export async function manageOpenTrades({ flatten = false } = {}) {
  const api = client();
  let positions = null;
  try {
    const posRes = await api.portfolioApi.getPositions();
    positions = posRes?.data || posRes;
  } catch (err) {
    console.error('Manage: positions failed', err.message);
  }

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
    const market = await fetchMarket(api.marketsApi, row.market_ticker);
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
    const hitTp = decision.why === 'runner_cover_cost';
    const count = positionCount(positions, row.market_ticker);
    if (count <= 0) {
      await updateCandidate(row.id, {
        action: decision.why === 'stop_50pct' ? 'stopped' : 'tp_no_pos',
        latest_yes_bid: bid,
        reason: `${row.reason || ''}|${decision.why}`,
      });
      console.log(`Manage mark ${row.market_ticker} ${decision.why} but no live position`);
      continue;
    }
    try {
      await sellYes(api.ordersApi, row.market_ticker, count, bid || TAKE_PROFIT_CAP);
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

export { MAX_ENTRY, TAKE_PROFIT_MULT };
