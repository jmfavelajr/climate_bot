export function dollars(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return n > 1 ? n / 100 : n;
}

export function resolveEntry(...vals) {
  for (const v of vals) {
    const d = dollars(v);
    if (Number.isFinite(d) && d > 0) return d;
  }
  return null;
}

export function positionAvgPrice(p) {
  if (!p) return null;
  return resolveEntry(
    p.average_price_dollars,
    p.avg_price_dollars,
    p.average_fill_price,
    p.average_price,
    p.avg_price,
    p.yes_average_price,
    p.market_exposure_dollars && p.position_fp
      ? Number(p.market_exposure_dollars) / Math.abs(Number(p.position_fp))
      : null
  );
}

export function impliedYes(market) {
  const last = dollars(market?.last_price_dollars ?? market?.last_price);
  const bid = dollars(market?.yes_bid_dollars ?? market?.yes_bid);
  const ask = dollars(market?.yes_ask_dollars ?? market?.yes_ask);
  if (Number.isFinite(last) && last > 0) return last;
  if (Number.isFinite(bid) && Number.isFinite(ask)) return (bid + ask) / 2;
  return bid ?? ask ?? 0;
}

export function isBetweenTicker(ticker) {
  return /-[0-9]{2}[A-Z]{3}[0-9]{2}-B\d/.test(String(ticker || ''));
}

export function isThresholdTicker(ticker) {
  return /-[0-9]{2}[A-Z]{3}[0-9]{2}-T\d/.test(String(ticker || ''));
}

export function pickByImplied(markets, count) {
  return [...(markets || [])]
    .filter((m) => m && m.ticker && isBetweenTicker(m.ticker))
    .sort((a, b) => impliedYes(b) - impliedYes(a))
    .slice(0, count);
}

export function eventPicks(markets, todayEvent, tomorrowEvent) {
  const open = (markets || []).filter((m) => m.strike_type === 'between' || isBetweenTicker(m?.ticker));
  const today = pickByImplied(open.filter((m) => m.event_ticker === todayEvent), 1).map((market) => ({
    market,
    role: 'favorite',
    horizon: 'today',
    reason: 'today_favorite',
  }));
  const tomorrow = pickByImplied(open.filter((m) => m.event_ticker === tomorrowEvent), 1).map((market) => ({
    market,
    role: 'favorite',
    horizon: 'tomorrow',
    reason: 'tomorrow_favorite',
  }));
  return [...today, ...tomorrow];
}

export function eventFromMarketTicker(ticker) {
  const parts = String(ticker || '').split('-');
  if (parts.length < 2) return ticker || '';
  return `${parts[0]}-${parts[1]}`;
}

export function seriesFromEvent(eventTicker) {
  return String(eventTicker || '').split('-')[0] || '';
}

export function parseRole(reason = '') {
  const r = String(reason);
  const horizon = r.includes('today') && !r.includes('tomorrow') ? 'today' : (r.includes('tomorrow') ? 'tomorrow' : 'today');
  if (r.includes('promoted') || r.includes('favorite')) {
    return { role: 'favorite', horizon };
  }
  if (r.includes('runner')) {
    return { role: 'runner', horizon: r.includes('today') ? 'today' : 'tomorrow' };
  }
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

export function pnlPct(entry, bid) {
  if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(bid)) return null;
  return Number((((bid - entry) / entry) * 100).toFixed(1));
}

export function trailArmed(entry, peak) {
  return Number.isFinite(entry) && Number.isFinite(peak) && peak >= entry * 2;
}

export function trailTrigger(peak) {
  if (!Number.isFinite(peak) || peak <= 0) return null;
  return Number((peak * 0.75).toFixed(4));
}

export function trailFloor(entry) {
  if (!Number.isFinite(entry) || entry <= 0) return null;
  return Number((entry * 1.5).toFixed(4));
}

export function exitDecision({ reason, entry, bid, peak }) {
  const { role, horizon } = parseRole(reason);
  const sl = stopLoss(entry);
  const tp = runnerTakeProfit(entry);
  const trail = trailTrigger(peak);
  const floor = trailFloor(entry);
  const armed = trailArmed(entry, peak);
  const pnl = pnlPct(entry, bid);

  if (Number.isFinite(bid) && bid <= 0.02) {
    return { sell: true, why: 'dust_bid', role, horizon, sl, tp, trail, floor, peak, pnl, armed };
  }
  if (Number.isFinite(bid) && Number.isFinite(sl) && bid <= sl) {
    return { sell: true, why: 'stop_50pct', role, horizon, sl, tp, trail, floor, peak, pnl, armed };
  }
  if (
    armed &&
    Number.isFinite(bid) &&
    Number.isFinite(trail) &&
    bid <= trail &&
    Number.isFinite(floor) &&
    bid >= floor
  ) {
    return { sell: true, why: 'trail_25pct_off_peak', role, horizon, sl, tp, trail, floor, peak, pnl, armed };
  }
  return { sell: false, why: 'hold_settlement', role, horizon, sl, tp, trail, floor, peak, pnl, armed };
}
