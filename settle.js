import { listUnscoredCandidates, scoreCandidate } from './persist.js';

const STATIONS = {
  CHI: 'KMDW',
  DEN: 'KDEN',
  LAX: 'KLAX',
  PHIL: 'KPHL',
  TSFO: 'KSFO',
  SFO: 'KSFO',
  TLV: 'KLAS',
  LV: 'KLAS',
};

function chicagoNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
}

function parseEventDate(eventTicker = '') {
  const m = String(eventTicker).match(/-(\d{2})([A-Z]{3})(\d{2})$/);
  if (!m) return null;
  const months = { JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11 };
  const year = 2000 + Number(m[1]);
  const month = months[m[2]];
  const day = Number(m[3]);
  if (month == null || !day) return null;
  return new Date(year, month, day);
}

function cityKey(eventTicker = '') {
  const base = String(eventTicker).split('-')[0] || '';
  return base.replace(/^KXHIGH/, '').replace(/^KXLOWT/, '').replace(/^KXLOW/, '');
}

function parseStrike(marketTicker = '') {
  const m = String(marketTicker).match(/-B(\d+(?:\.\d+)?)$/i);
  if (!m) return null;
  const mid = Number(m[1]);
  return { low: mid - 0.5, high: mid + 0.5, mid };
}

function dayIsSettled(eventDate) {
  if (!eventDate) return false;
  const now = chicagoNow();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return eventDate < today;
}

async function fetchKalshiMarket(ticker) {
  const res = await fetch(`https://api.elections.kalshi.com/trade-api/v2/markets/${encodeURIComponent(ticker)}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.market || data;
}

async function fetchStationExtremes(station, eventDate) {
  const start = new Date(Date.UTC(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate(), 5, 0, 0));
  const end = new Date(start.getTime() + 36 * 3600 * 1000);
  const url = `https://api.weather.gov/stations/${station}/observations?start=${start.toISOString()}&end=${end.toISOString()}&limit=200`;
  const res = await fetch(url, { headers: { 'User-Agent': 'climate-bot (github.com/jmfavelajr/climate_bot)', Accept: 'application/geo+json' } });
  if (!res.ok) return null;
  const data = await res.json();
  const temps = (data.features || [])
    .map((f) => f?.properties?.temperature?.value)
    .filter((v) => Number.isFinite(v))
    .map((c) => (c * 9) / 5 + 32);
  if (!temps.length) return null;
  return { high: Math.max(...temps), low: Math.min(...temps) };
}

function paperPnl(row, wonYes) {
  const ask = Number(row.yes_ask);
  const price = Number.isFinite(ask) ? (ask > 1 ? ask / 100 : ask) : 0.5;
  return Number((wonYes ? 1 - price : -price).toFixed(4));
}

export async function settlePaperTrades() {
  const rows = await listUnscoredCandidates();
  if (!rows || !rows.length) {
    console.log('Settlement: no unscored paper trades');
    return;
  }
  console.log(`Settlement: scoring ${rows.length} paper trade(s)`);

  for (const row of rows) {
    const eventDate = parseEventDate(row.event_ticker);
    if (!dayIsSettled(eventDate)) {
      console.log(`Settlement skip (not official yet): ${row.market_ticker}`);
      continue;
    }

    let result = null;
    let settledTemp = null;
    try {
      const market = await fetchKalshiMarket(row.market_ticker);
      if (market?.result === 'yes' || market?.result === 'no') {
        result = market.result;
      }
      if (Number.isFinite(Number(market?.expiration_value))) {
        settledTemp = Number(market.expiration_value);
      }
    } catch (err) {
      console.error('Kalshi market lookup failed', row.market_ticker, err.message);
    }

    if (settledTemp == null) {
      const station = STATIONS[cityKey(row.event_ticker)];
      if (station) {
        try {
          const extremes = await fetchStationExtremes(station, eventDate);
          const isLow = String(row.event_ticker).includes('LOW');
          settledTemp = isLow ? extremes?.low : extremes?.high;
        } catch (err) {
          console.error('NWS observation lookup failed', row.event_ticker, err.message);
        }
      }
    }

    if (result == null && Number.isFinite(settledTemp)) {
      const strike = parseStrike(row.market_ticker);
      if (strike) {
        result = settledTemp >= strike.low && settledTemp < strike.high ? 'yes' : 'no';
      }
    }

    if (result == null) {
      console.log(`Settlement pending official reading: ${row.market_ticker}`);
      continue;
    }

    const won = result === 'yes';
    const pnl = paperPnl(row, won);
    await scoreCandidate(row.id, {
      settled_temp: Number.isFinite(settledTemp) ? Number(settledTemp.toFixed(2)) : null,
      pnl,
      action: won ? 'scored_win' : 'scored_loss',
      reason: `${row.reason || 'paper'}|settle=${result}`,
    });
    console.log(`Settled ${row.market_ticker}: ${result} temp=${settledTemp} pnl=${pnl}`);
  }
}
