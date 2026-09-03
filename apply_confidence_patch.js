import fs from 'fs';

const target = new URL('./climate_bot.js', import.meta.url);
let src = fs.readFileSync(target, 'utf8');

function injectHooks(source) {
  let out = source;
  if (!out.includes("from './settle.js'")) {
    if (out.includes("import { persistCandidate } from './persist.js';")) {
      out = out.replace(
        "import { persistCandidate } from './persist.js';",
        "import { persistCandidate } from './persist.js';\nimport { settlePaperTrades } from './settle.js';\nimport { allowNewEntry, manageOpenTrades } from './manage.js';"
      );
    } else if (out.includes("import {fileURLToPath} from 'url';")) {
      out = out.replace(
        "import {fileURLToPath} from 'url';",
        "import {fileURLToPath} from 'url';\nimport { settlePaperTrades } from './settle.js';\nimport { allowNewEntry, manageOpenTrades } from './manage.js';"
      );
    }
  } else if (!out.includes("from './manage.js'")) {
    out = out.replace(
      "import { settlePaperTrades } from './settle.js';",
      "import { settlePaperTrades } from './settle.js';\nimport { allowNewEntry, manageOpenTrades } from './manage.js';"
    );
  }
  if (!out.includes('manageOpenTrades')) {
    out = out.replace(
      'await runBot();',
      `await runBot();\nawait manageOpenTrades({ flatten: process.env.FLATTEN_EOD === '1' });\nawait settlePaperTrades();`
    );
  }
  if (!out.includes("from './kalshi_orders.js'")) {
    if (out.includes("from './manage.js';")) {
      out = out.replace(
        "from './manage.js';",
        "from './manage.js';\nimport { buyYes } from './kalshi_orders.js';"
      );
    }
  }
  if (out.includes('ordersApi.createOrder')) {
    out = out.replace(
      'const tradeResponse = await ordersApi.createOrder(postOrder);',
      'const tradeResponse = await buyYes(eventTicker, count, yes_price);'
    );
  }
  if (out.includes('const autoExecute = false')) {
    out = out.replace('const autoExecute = false', 'const autoExecute = true');
  }
  if (out.includes('yes_ask_size_fp / 100')) {
    out = out.replace(
      'const yes_price = ((market.yes_ask_size_fp / 100).toFixed(2));',
      `const _ask = Number(market.yes_ask_dollars ?? market.yes_ask);\n    const yes_price = ((_ask > 1 ? _ask / 100 : _ask) || 0).toFixed(2);`
    );
  }
  if (!out.includes('allowNewEntry(market)')) {
    out = out.replace(
      'if(forecastConfidence >= MIN_LIVE_CONFIDENCE || revisionFlagged){',
      `const entryGate = allowNewEntry(market);\n    if((forecastConfidence >= MIN_LIVE_CONFIDENCE || revisionFlagged) && entryGate.ok){`
    );
  }
  if (out.includes("action: 'paper'") && out.includes('persistCandidate(market, fc')) {
    out = out.replace(
      "action: 'paper', reason: revisionFlagged ? 'revision' : 'live_conf'",
      "action: 'live', reason: revisionFlagged ? 'revision' : 'live_conf', entry_yes_ask: entryGate.ask"
    );
  }
  return out;
}

if (src.includes('liveCalculateConfidences')) {
  const next = injectHooks(src);
  if (next !== src) {
    fs.writeFileSync(target, next);
    console.log('updated hooks on already-patched climate_bot.js');
  } else {
    console.log('confidence patch already applied');
  }
  process.exit(0);
}

const importNeedle = "import {fileURLToPath} from 'url';";
if (!src.includes(importNeedle)) {
  console.error('unexpected climate_bot.js layout; aborting patch');
  process.exit(1);
}

src = src.replace(
  importNeedle,
  `${importNeedle}\nimport { calculateConfidences as liveCalculateConfidences, MIN_LIVE_CONFIDENCE } from './confidence.js';\nimport { persistCandidate } from './persist.js';\nimport { settlePaperTrades } from './settle.js';\nimport { allowNewEntry, manageOpenTrades } from './manage.js';`
);

src = src.replace(
  'const std = dailyForecastMap.get(seriesForecast).deviation;',
  'const std = dailyForecastMap.get(seriesForecast).liveSigma || dailyForecastMap.get(seriesForecast).deviation;'
);

src = src.replaceAll('calculateConfidences(forecast);', 'await calculateConfidences(forecast);');

src = src.replace(
  '    if(forecastConfidence >= 65){',
  `    const fc = dailyForecastMap.get(market.event_ticker);\n    const revisionFlagged = Boolean(fc && fc.revision && fc.revision.flagged);\n    const entryGate = allowNewEntry(market);\n    if((forecastConfidence >= MIN_LIVE_CONFIDENCE || revisionFlagged) && entryGate.ok){`
);

src = src.replace(
  '        await Promise.all([executeTrade(market, forecastConfidence)]);',
  `        persistCandidate(market, fc, { confidence: forecastConfidence, action: 'live', reason: revisionFlagged ? 'revision' : 'live_conf', entry_yes_ask: entryGate.ask }).catch((err) => console.error(err.message));\n        await Promise.all([executeTrade(market, forecastConfidence)]);`
);

const start = src.indexOf('function calculateConfidences(forecast){');
const end = src.indexOf('async function scanAndSelectMarkets(market, forecastConfidence){');
if (start < 0 || end < 0 || end <= start) {
  console.error('could not locate calculateConfidences(); aborting patch');
  process.exit(1);
}

src = src.slice(0, start) + `async function calculateConfidences(forecast){\n    return liveCalculateConfidences(forecast);\n}\n\n` + src.slice(end);

src = injectHooks(src);

fs.writeFileSync(target, src);
console.log('applied live-sigma confidence patch to climate_bot.js');
