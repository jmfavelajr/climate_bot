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

export async function persistCandidate(market, forecast, extras = {}) {
  if (!market) return;
  const n = Number(market?.yes_ask_dollars ?? market?.yes_ask ?? extras.entry_yes_ask);
  const ask = Number.isFinite(n) ? (n > 1 ? n / 100 : n) : extras.entry_yes_ask;
  const opened = extras.opened_at || new Date().toISOString();
  const row = {
    market_ticker: market.ticker,
    event_ticker: market.event_ticker || extras.event_ticker || null,
    confidence: extras.confidence ?? null,
    revision_flagged: false,
    revision_delta: 0,
    action: extras.action || 'live',
    reason: extras.reason || null,
    yes_ask: ask,
    entry_yes_ask: ask,
    latest_yes_bid: extras.latest_yes_bid ?? null,
  };
  const first = await rest('trade_candidates', { method: 'POST', body: { ...row, opened_at: opened } });
  if (first) return first;
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
