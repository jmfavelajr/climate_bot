const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

function dbEnabled() {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

async function rest(path, { method = 'GET', body, query = '' } = {}) {
  if (!dbEnabled()) return null;
  const url = `${SUPABASE_URL}/rest/v1/${path}${query}`;
  const res = await fetch(url, {
    method,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`Supabase ${method} ${path} failed ${res.status}: ${text.slice(0, 300)}`);
    return null;
  }
  const raw = await res.text();
  return raw ? JSON.parse(raw) : null;
}

export async function loadLatestSnapshot(eventTicker) {
  const rows = await rest(
    'forecast_snapshots',
    { query: `?event_ticker=eq.${encodeURIComponent(eventTicker)}&order=observed_at.desc&limit=1` }
  );
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

export async function persistForecast(forecast) {
  if (!forecast) return;
  const om = Number(forecast.getForecastTemperature?.() ?? forecast.forecastTemperature);
  const nws = Number(forecast.getNWSForecastTemperature?.() ?? forecast.nwsForecastTemperature);
  if (!Number.isFinite(om) || !Number.isFinite(nws) || om === 0 || nws === 0) return;
  const row = {
    event_ticker: forecast.name,
    location: forecast.location || null,
    forecast_date: forecast.date || null,
    om_temp: om,
    nws_temp: nws,
    live_sigma: forecast.liveSigma ?? null,
    confidence: forecast.getConfidence?.() ?? forecast.forecastConfidence ?? null,
    disagreement: forecast.sourceDisagreement ?? null,
    revision_delta: forecast.revision?.deltaF ?? 0,
    revision_flagged: Boolean(forecast.revision?.flagged),
  };
  return rest('forecast_snapshots', { method: 'POST', body: row });
}

function askDollars(market) {
  const n = Number(market?.yes_ask_dollars ?? market?.yes_ask);
  if (!Number.isFinite(n)) return null;
  return n > 1 ? n / 100 : n;
}

export async function persistCandidate(market, forecast, extras = {}) {
  if (!market) return;
  const ask = extras.entry_yes_ask ?? askDollars(market);
  const row = {
    market_ticker: market.ticker,
    event_ticker: market.event_ticker,
    confidence: extras.confidence ?? forecast?.getConfidence?.() ?? null,
    revision_flagged: Boolean(forecast?.revision?.flagged),
    revision_delta: forecast?.revision?.deltaF ?? 0,
    action: extras.action || 'live',
    reason: extras.reason || null,
    yes_ask: ask,
    entry_yes_ask: ask,
    latest_yes_bid: extras.latest_yes_bid ?? null,
    om_temp: Number(forecast?.getForecastTemperature?.()) || null,
    nws_temp: Number(forecast?.getNWSForecastTemperature?.()) || null,
    live_sigma: forecast?.liveSigma ?? null,
  };
  return rest('trade_candidates', { method: 'POST', body: row });
}

export async function listOpenCandidates() {
  const rows = await rest(
    'trade_candidates',
    { query: '?action=in.(paper,live,open)&order=run_at.asc' }
  );
  return Array.isArray(rows) ? rows : [];
}

export async function updateCandidate(id, fields) {
  if (!id) return null;
  return rest('trade_candidates', {
    method: 'PATCH',
    query: `?id=eq.${id}`,
    body: fields,
  });
}

export async function listUnscoredCandidates() {
  const rows = await rest(
    'trade_candidates',
    { query: '?or=(settled_temp.is.null,action.eq.paper)&order=run_at.asc' }
  );
  return Array.isArray(rows) ? rows : [];
}

export async function scoreCandidate(id, fields) {
  if (!id) return null;
  return rest('trade_candidates', {
    method: 'PATCH',
    query: `?id=eq.${id}`,
    body: fields,
  });
}

export { dbEnabled };
