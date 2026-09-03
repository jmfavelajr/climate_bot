import kalshiPkg from 'kalshi-typescript';
import { listOpenCandidates, updateCandidate } from './persist.js';

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

function targetBid(entry) {
  if (!Number.isFinite(entry) || entry <= 0) return null;
  return Math.min(TAKE_PROFIT_CAP, Number((entry * TAKE_PROFIT_MULT).toFixed(2)));
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

async function sellYes(ordersApi, ticker, count, bid) {
  const price = Math.max(0.01, Number((bid ?? TAKE_PROFIT_CAP).toFixed(2)));
  const postOrder = {
    ticker,
    side: 'yes',
    action: 'sell',
    count: Math.max(1, Math.floor(count) || 1),
    type: 'limit',
    yes_price_dollars: price.toFixed(2),
    time_in_force: 'immediate_or_cancel',
  };
  console.log(`Selling YES ${ticker} count=${postOrder.count} @ ${postOrder.yes_price_dollars}`);
  const tradeResponse = await ordersApi.createOrder(postOrder);
  console.log(`Sell response ${tradeResponse?.status}:`, tradeResponse?.data || tradeResponse);
  return tradeResponse;
}

export function allowNewEntry(market) {
  const ask = dollars(market.yes_ask_dollars ?? market.yes_ask);
  if (!Number.isFinite(ask)) return { ok: false, ask, reason: 'no_ask' };
  if (ask > MAX_ENTRY) return { ok: false, ask, reason: 'ask_above_50c' };
  if (ask < 0.02) return { ok: false, ask, reason: 'ask_too_thin' };
  return { ok: true, ask };
}

export async function manageOpenTrades({ flatten = false } = {}) {
  const rows = await listOpenCandidates();
  if (!rows.length && !flatten) {
    console.log('Manage: no open candidates');
    return;
  }
  const api = client();
  let positions = null;
  try {
    const posRes = await api.portfolioApi.getPositions();
    positions = posRes?.data || posRes;
  } catch (err) {
    console.error('Manage: positions failed', err.message);
  }

  for (const row of rows) {
    const market = await fetchMarket(api.marketsApi, row.market_ticker);
    const bid = dollars(market?.yes_bid_dollars ?? market?.yes_bid);
    const entry = dollars(row.entry_yes_ask ?? row.yes_ask);
    if (Number.isFinite(bid)) {
      await updateCandidate(row.id, { latest_yes_bid: bid });
    }
    const tgt = targetBid(entry);
    const hitTp = Number.isFinite(bid) && Number.isFinite(tgt) && bid >= tgt;
    const shouldFlat = flatten || hitTp;
    if (!shouldFlat) {
      console.log(`Manage hold ${row.market_ticker} entry=${entry} bid=${bid} target=${tgt}`);
      continue;
    }
    const count = positionCount(positions, row.market_ticker);
    if (count <= 0) {
      await updateCandidate(row.id, {
        action: flatten ? 'eod_flat_no_pos' : 'tp_no_pos',
        latest_yes_bid: bid,
        reason: `${row.reason || ''}|${flatten ? 'eod' : '2x'}`,
      });
      console.log(`Manage mark ${row.market_ticker} ${flatten ? 'eod' : '2x'} but no live position`);
      continue;
    }
    try {
      await sellYes(api.ordersApi, row.market_ticker, count, hitTp ? bid : bid || TAKE_PROFIT_CAP);
      await updateCandidate(row.id, {
        action: flatten && !hitTp ? 'eod_flat' : 'take_profit',
        latest_yes_bid: bid,
        reason: `${row.reason || ''}|${hitTp ? '2x' : 'eod_flat'}`,
      });
    } catch (err) {
      console.error(`Sell failed ${row.market_ticker}:`, err.response?.data || err.message);
    }
  }
}

export { MAX_ENTRY, TAKE_PROFIT_MULT };
