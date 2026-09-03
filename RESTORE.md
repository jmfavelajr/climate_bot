# Restore climate_bot.js

A connector size limit prevented rewriting the 55KB climate_bot.js in one API call. Two bad commits replaced it with placeholders.

## Fix in one command

```bash
cd climate_bot
git checkout ca4480bc483b16044dd154e1bde5ba80a942b646 -- climate_bot.js
```

That file is identical to samples/apps/bot_test/climate_bot_alpha_v2.js.

Then either:
1. Copy the downloaded patched climate_bot.js over it, or
2. Keep the restored original and paste the functions from confidence.js over calculateConfidences().

Also change the trade gate from `forecastConfidence >= 65` to:

```js
if(forecastConfidence >= 55 || (dailyForecastMap.get(market.event_ticker)?.revision?.flagged)){
```

And in estimateProbability use:

```js
const std = dailyForecastMap.get(seriesForecast).liveSigma || dailyForecastMap.get(seriesForecast).deviation;
```
