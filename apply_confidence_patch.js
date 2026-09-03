import fs from 'fs';

const target = new URL('./climate_bot.js', import.meta.url);
let src = fs.readFileSync(target, 'utf8');

if (src.includes('liveCalculateConfidences')) {
  console.log('confidence patch already applied');
  process.exit(0);
}

const importNeedle = "import {fileURLToPath} from 'url';";
if (!src.includes(importNeedle)) {
  console.error('unexpected climate_bot.js layout; aborting patch');
  process.exit(1);
}

src = src.replace(
  importNeedle,
  `${importNeedle}\nimport { calculateConfidences as liveCalculateConfidences, MIN_LIVE_CONFIDENCE } from './confidence.js';\nimport { persistCandidate } from './persist.js';`
);

src = src.replace(
  'const std = dailyForecastMap.get(seriesForecast).deviation;',
  'const std = dailyForecastMap.get(seriesForecast).liveSigma || dailyForecastMap.get(seriesForecast).deviation;'
);

src = src.replaceAll('calculateConfidences(forecast);', 'await calculateConfidences(forecast);');

src = src.replace(
  '    if(forecastConfidence >= 65){',
  `    const fc = dailyForecastMap.get(market.event_ticker);
    const revisionFlagged = Boolean(fc && fc.revision && fc.revision.flagged);
    if(forecastConfidence >= MIN_LIVE_CONFIDENCE || revisionFlagged){`
);

src = src.replace(
  '        await Promise.all([executeTrade(market, forecastConfidence)]);',
  `        persistCandidate(market, fc, { confidence: forecastConfidence, action: 'paper', reason: revisionFlagged ? 'revision' : 'live_conf' }).catch((err) => console.error(err.message));
        await Promise.all([executeTrade(market, forecastConfidence)]);`
);

const start = src.indexOf('function calculateConfidences(forecast){');
const end = src.indexOf('async function scanAndSelectMarkets(market, forecastConfidence){');
if (start < 0 || end < 0 || end <= start) {
  console.error('could not locate calculateConfidences(); aborting patch');
  process.exit(1);
}

src = src.slice(0, start) + `async function calculateConfidences(forecast){
    return liveCalculateConfidences(forecast);
}

` + src.slice(end);

fs.writeFileSync(target, src);
console.log('applied live-sigma confidence patch to climate_bot.js');
