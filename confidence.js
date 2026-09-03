// Drop-in live-sigma + revision helpers for climate_bot.js
// Replace calculateConfidences() with these functions.

const forecastSnapshots = new Map();
const REVISION_THRESHOLD_F = 1.5;
const REVISION_THRESHOLD_SAME_DAY_F = 1.0;
const MIN_LIVE_CONFIDENCE = 55;

function horizonMultiplier(forecast){
    if(forecast.isToday && forecast.isToday()){
        const hour = Number(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }));
        if(hour >= 15) return 0.75;
        if(hour >= 12) return 0.9;
        return 1.0;
    }
    if(forecast.isTomorrow && forecast.isTomorrow()) return 1.35;
    return 1.6;
}

function liveSigma(forecast){
    const hist = Number(forecast.deviation) || 3.5;
    const om = Number(forecast.getForecastTemperature());
    const nws = Number(forecast.getNWSForecastTemperature());
    let disagreement = 0;
    if(Number.isFinite(om) && Number.isFinite(nws)){
        disagreement = Math.abs(om - nws) / Math.SQRT2;
    }
    const blended = Math.sqrt(0.5 * disagreement * disagreement + 0.5 * hist * hist);
    const sigma = Math.min(10, Math.max(0.8, blended * horizonMultiplier(forecast)));
    forecast.liveSigma = Number(sigma.toFixed(3));
    forecast.sourceDisagreement = Number(disagreement.toFixed(3));
    return forecast.liveSigma;
}

function detectForecastRevision(forecast){
    const mu = Number(forecast.getForecastTemperature());
    const nwsMu = Number(forecast.getNWSForecastTemperature());
    const nowMu = Number.isFinite(mu) ? mu : nwsMu;
    const prev = forecastSnapshots.get(forecast.name);
    const threshold = (forecast.isToday && forecast.isToday()) ? REVISION_THRESHOLD_SAME_DAY_F : REVISION_THRESHOLD_F;
    let revision = { deltaF: 0, flagged: false, prevMu: null, nowMu };
    if(prev && Number.isFinite(prev.mu) && Number.isFinite(nowMu)){
        revision.deltaF = Number((nowMu - prev.mu).toFixed(2));
        revision.prevMu = prev.mu;
        revision.flagged = Math.abs(revision.deltaF) >= threshold;
    }
    forecast.revision = revision;
    forecastSnapshots.set(forecast.name, { mu: nowMu, nwsMu, sigma: forecast.liveSigma, ts: Date.now() });
    if(revision.flagged){
        console.log(`REVISION ${forecast.name} ${forecast.location}: ${revision.prevMu} -> ${nowMu} (dT=${revision.deltaF}F)`);
    }
    return revision;
}

function calculateConfidences(forecast){
    const t50 = forecast.getForecastTemperature();
    const nwsT50 = forecast.getNWSForecastTemperature();
    const sigma = liveSigma(forecast);
    detectForecastRevision(forecast);
    const omConf = Math.max(0, Math.min(95, Math.round(100 - (sigma * 12))));
    const agreeBump = (Number.isFinite(t50) && Number.isFinite(nwsT50) && Math.abs(t50 - nwsT50) <= 1.0) ? 5 : 0;
    const confidencePct = Math.max(0, Math.min(95, omConf + agreeBump));
    forecast.setConfidence(confidencePct);
    if(forecast.setNWSConfidence) forecast.setNWSConfidence(omConf);
    let confidenceLevel = sigma <= 1.6 ? 'Very High' : sigma <= 2.4 ? 'High' : sigma <= 3.5 ? 'Moderate' : 'Low';
    console.log(`Live confidence ${forecast.name} ${forecast.location}: sigma=${sigma} disagree=${forecast.sourceDisagreement} conf=${confidencePct} (${confidenceLevel}) rev=${forecast.revision?.deltaF ?? 0}`);
    return `${confidenceLevel}, ${confidencePct}%`;
}

export { forecastSnapshots, MIN_LIVE_CONFIDENCE, liveSigma, detectForecastRevision, calculateConfidences, horizonMultiplier };
