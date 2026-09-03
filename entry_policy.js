export function dollars(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return n > 1 ? n / 100 : n;
}

export function impliedYes(market) {
  const last = dollars(market?.last_price_dollars ?? market?.last_price);
  const bid = dollars(market?.yes_bid_dollars ?? market?.yes_bid);
  const ask = dollars(market?.yes_ask_dollars ?? market?.yes_ask);
  if (Number.isFinite(last) && last > 0) return last;
  if (Number.isFinite(bid) && Number.isFinite(ask)) return (bid + ask) / 2;
  return bid ?? ask ?? 0;
}

export function pickByImplied(markets, count) {
  return [...(markets || [])]
    .filter((m) => m && m.ticker)
    .sort((a, b) => impliedYes(b) - impliedYes(a))
    .slice(0, count);
}

export function eventPicks(markets, todayEvent, tomorrowEvent) {
  const open = (markets || []).filter((m) => m.strike_type === 'between' || !m.strike_type);
  const today = pickByImplied(open.filter((m) => m.event_ticker === todayEvent), 1).map((market) => ({
    market,
    role: 'favorite',
    horizon: 'today',
    reason: 'today_favorite',
  }));
  const tomorrow = pickByImplied(open.filter((m) => m.event_ticker === tomorrowEvent), 2).map((market, i) => ({
    market,
    role: i === 0 ? 'favorite' : 'runner',
    horizon: 'tomorrow',
    reason: i === 0 ? 'tomorrow_favorite' : 'tomorrow_runner',
  }));
  return [...today, ...tomorrow];
}

export function parseRole(reason = '') {
  const r = String(reason);
  if (r.includes('runner')) return { role: 'runner', horizon: r.includes('today') ? 'today' : 'tomorrow' };
  if (r.includes('tomorrow')) return { role: 'favorite', horizon: 'tomorrow' };
  if (r.includes('today')) return { role: 'favorite', horizon: 'today' };
  return { role: 'favorite', horizon: 'today' };
}

export function runnerTakeProfit(entry) {
  if (!Number.isFinite(entry) || entry <= 0) return null;
  return Math.min(0.99, Number((entry * 2).toFixed(4)));
}

export function stopLoss(entry) {
  if (!Number.isFinite(entry) || entry <= 0) return null;
  return Number((entry * 0.5).toFixed(4));
}

export function exitDecision({ reason, entry, bid, flatten }) {
  const { role, horizon } = parseRole(reason);
  const sl = stopLoss(entry);
  const tp = runnerTakeProfit(entry);
  if (Number.isFinite(bid) && Number.isFinite(sl) && bid <= sl) {
    return { sell: true, why: 'stop_50pct' };
  }
  if (role === 'runner' && Number.isFinite(bid) && Number.isFinite(tp) && bid >= tp) {
    return { sell: true, why: 'runner_cover_cost' };
  }
  if (flatten && role === 'runner') {
    return { sell: true, why: 'eod_runner' };
  }
  return { sell: false, why: 'hold_settlement', role, horizon, sl, tp };
}
