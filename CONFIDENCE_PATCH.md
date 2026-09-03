Live-sigma + forecast-revision patch applied to climate_bot.js.

Confidence is no longer 100 - 5 * hardcoded city deviation.
See climate_bot.js: liveSigma(), detectForecastRevision(), MIN_LIVE_CONFIDENCE=55.
