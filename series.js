/** High temperature series only. No LOW markets. */
export const CLIMATE_SERIES = [
  { series: 'KXHIGHCHI', city: 'Chicago', kind: 'high', tz: 'America/Chicago' },
  { series: 'KXHIGHDEN', city: 'Denver', kind: 'high', tz: 'America/Denver' },
  { series: 'KXHIGHLAX', city: 'Los Angeles', kind: 'high', tz: 'America/Los_Angeles' },
  { series: 'KXHIGHPHIL', city: 'Philadelphia', kind: 'high', tz: 'America/New_York' },
  { series: 'KXHIGHTSFO', city: 'San Francisco', kind: 'high', tz: 'America/Los_Angeles' },
  { series: 'KXHIGHTLV', city: 'Las Vegas', kind: 'high', tz: 'America/Los_Angeles' },
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

export function localHourMinute(timeZone = 'America/Chicago') {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value);
  return { hour, minute, hhmm: hour * 100 + minute, tz: timeZone };
}

export function chicagoHourMinute() {
  return localHourMinute('America/Chicago');
}

export function isThresholdTicker(ticker) {
  return /-[0-9]{2}[A-Z]{3}[0-9]{2}-T\d/.test(String(ticker || ''));
}

/** HIGH today+tomorrow: 08:00-14:00 local */
export function inKindWindow(kind, timeZone, horizon = 'today') {
  const { hhmm } = localHourMinute(timeZone || 'America/Chicago');
  const start = Number(process.env.HIGH_ENTRY_START_HHMM || 800);
  const end = Number(process.env.HIGH_ENTRY_END_HHMM || 1400);
  return hhmm >= start && hhmm < end;
}

export function kalshiDay(offsetDays = 0) {
  const { year, month, day } = chicagoYmd(offsetDays);
  return `${String(year).slice(-2)}${MONTHS[month]}${String(day).padStart(2, '0')}`;
}

export function eventTicker(series, offsetDays = 0) {
  return `${series}-${kalshiDay(offsetDays)}`;
}
