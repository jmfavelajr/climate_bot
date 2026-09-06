/** Kalshi climate series only — no NWS / Open-Meteo fields. */
export const CLIMATE_SERIES = [
  { series: 'KXHIGHCHI', city: 'Chicago', kind: 'high', tz: 'America/Chicago' },
  { series: 'KXHIGHDEN', city: 'Denver', kind: 'high', tz: 'America/Denver' },
  { series: 'KXHIGHLAX', city: 'Los Angeles', kind: 'high', tz: 'America/Los_Angeles' },
  { series: 'KXHIGHPHIL', city: 'Philadelphia', kind: 'high', tz: 'America/New_York' },
  { series: 'KXHIGHTSFO', city: 'San Francisco', kind: 'high', tz: 'America/Los_Angeles' },
  { series: 'KXHIGHTLV', city: 'Las Vegas', kind: 'high', tz: 'America/Los_Angeles' },
  { series: 'KXLOWTCHI', city: 'Chicago', kind: 'low', tz: 'America/Chicago' },
  { series: 'KXLOWTDEN', city: 'Denver', kind: 'low', tz: 'America/Denver' },
  { series: 'KXLOWTLAX', city: 'Los Angeles', kind: 'low', tz: 'America/Los_Angeles' },
  { series: 'KXLOWTPHIL', city: 'Philadelphia', kind: 'low', tz: 'America/New_York' },
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

/**
 * HIGH today+tomorrow: 08:00-14:00 local
 * LOW today: 04:00-08:00 local (pre-sunrise)
 * LOW tomorrow: 20:00-08:00 local (evening through next sunrise)
 */
export function inKindWindow(kind, timeZone, horizon = 'today') {
  const { hhmm } = localHourMinute(timeZone || 'America/Chicago');
  if (kind === 'low') {
    const todayStart = Number(process.env.LOW_TODAY_START_HHMM || 400);
    const todayEnd = Number(process.env.LOW_TODAY_END_HHMM || 800);
    const tmStart = Number(process.env.LOW_TM_START_HHMM || 2000);
    const tmEnd = Number(process.env.LOW_TM_END_HHMM || 800);
    if (horizon === 'tomorrow') {
      return hhmm >= tmStart || hhmm < tmEnd;
    }
    return hhmm >= todayStart && hhmm < todayEnd;
  }
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
