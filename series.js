/** Kalshi climate series only — no NWS / Open-Meteo fields. */
export const CLIMATE_SERIES = [
  { series: 'KXHIGHCHI', city: 'Chicago', kind: 'high' },
  { series: 'KXHIGHDEN', city: 'Denver', kind: 'high' },
  { series: 'KXHIGHLAX', city: 'Los Angeles', kind: 'high' },
  { series: 'KXHIGHPHIL', city: 'Philadelphia', kind: 'high' },
  { series: 'KXHIGHTSFO', city: 'San Francisco', kind: 'high' },
  { series: 'KXHIGHTLV', city: 'Las Vegas', kind: 'high' },
  { series: 'KXLOWTCHI', city: 'Chicago', kind: 'low' },
  { series: 'KXLOWTDEN', city: 'Denver', kind: 'low' },
  { series: 'KXLOWTLAX', city: 'Los Angeles', kind: 'low' },
  { series: 'KXLOWTPHIL', city: 'Philadelphia', kind: 'low' },
];

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export function chicagoYmd(offsetDays = 0) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const [y, m, d] = fmt.format(new Date()).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + offsetDays));
  return {
    year: dt.getUTCFullYear(),
    month: dt.getUTCMonth(),
    day: dt.getUTCDate(),
  };
}

export function chicagoHourMinute() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value);
  return { hour, minute, hhmm: hour * 100 + minute };
}

/** Kalshi date token, e.g. 26SEP04 */
export function kalshiDay(offsetDays = 0) {
  const { year, month, day } = chicagoYmd(offsetDays);
  return `${String(year).slice(-2)}${MONTHS[month]}${String(day).padStart(2, '0')}`;
}

export function eventTicker(series, offsetDays = 0) {
  return `${series}-${kalshiDay(offsetDays)}`;
}
