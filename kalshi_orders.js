import crypto from 'crypto';

const BASE_URL = (process.env.KALSHI_BASE_URL || 'https://api.elections.kalshi.com').replace(/\/$/, '');
const ORDER_PATH = '/trade-api/v2/portfolio/events/orders';

function signPss(privateKeyPem, text) {
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(text);
  sign.end();
  return sign.sign(
    {
      key: privateKeyPem,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
    },
    'base64'
  );
}

function authHeaders(method, path) {
  const keyId = process.env.KALSHI_API_KEY_ID;
  const pem = process.env.KALSHI_PRIVATE_KEY;
  if (!keyId || !pem) throw new Error('Missing KALSHI_API_KEY_ID or KALSHI_PRIVATE_KEY');
  const timestamp = String(Date.now());
  const signature = signPss(pem, timestamp + method + path);
  return {
    'KALSHI-ACCESS-KEY': keyId,
    'KALSHI-ACCESS-SIGNATURE': signature,
    'KALSHI-ACCESS-TIMESTAMP': timestamp,
    'Content-Type': 'application/json',
  };
}

function dollars4(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return '0.0100';
  const d = n > 1 ? n / 100 : n;
  return Math.max(0.01, Math.min(0.99, d)).toFixed(4);
}

export async function createOrderV2({
  ticker,
  side,
  count,
  price,
  timeInForce = 'immediate_or_cancel',
}) {
  const body = {
    ticker,
    client_order_id: crypto.randomUUID(),
    side,
    count: Number(count).toFixed(2),
    price: dollars4(price),
    time_in_force: timeInForce,
    self_trade_prevention_type: 'taker_at_cross',
  };
  const res = await fetch(`${BASE_URL}${ORDER_PATH}`, {
    method: 'POST',
    headers: authHeaders('POST', ORDER_PATH),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`Kalshi v2 order failed ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  console.log(`Kalshi v2 ${side} ${ticker} count=${body.count} price=${body.price} status=${res.status}`, data);
  return { status: res.status, data };
}

export async function buyYes(ticker, count, price) {
  return createOrderV2({
    ticker,
    side: 'bid',
    count,
    price,
    timeInForce: 'fill_or_kill',
  });
}

export async function sellYes(ticker, count, price) {
  return createOrderV2({
    ticker,
    side: 'ask',
    count,
    price,
    timeInForce: 'immediate_or_cancel',
  });
}
