function num(...keys) {
  for (const k of keys) {
    const n = Number(process.env[k]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

export const SEED_VALUE = num('SEED_VALUE', 'seed_value', 'FIXED_BET_DOLLARS') ?? 2;
export const EXIT_PCT = num('EXIT_PCT', 'exit_pct', 'SETTLE_TAKE_FRAC') ?? 0.8;
