//const WORKER_URL = 'https://clima-markets-report-fetch.jfavela.workers.dev';
const WORKER_URL = 'https://kalshi-climate.wtfdis.com';

// Use relative paths because the page and API are on the same Worker
const TRIGGER_URL = '/api/trigger';
const REPORT_URL = '/api/report';

const reportEl = document.getElementById('report');
const statusEl = document.getElementById('status');
const button = document.getElementById('generate-btn');

//Load the latest report when the page opens
loadReport();

//Attach click event
button.addEventListener('click', triggerReport);

async function triggerReport() {
  button.disabled = true;
  button.textContent = 'Triggering...';
  setStatus('Sending request to generate a new report...', '');

  try {
    const res = await fetch(TRIGGER_URL, { method: 'POST' });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to trigger workflow');
    }

    setStatus('Workflow started. Waiting for the new report (this can take 30–60 seconds)...', 'success');
    button.textContent = 'Generating...';

    pollForNewReport();
  } catch (err) {
    setStatus('Error: ' + err.message, 'error');
    button.disabled = false;
    button.textContent = 'Generate Fresh Report';
  }
}

async function pollForNewReport() {
  const maxAttempts = 20;
  const interval = 6000;
  let attempts = 0;
  let lastContent = null;

  try {
    const initial = await fetch(REPORT_URL);
    lastContent = await initial.text();
  } catch (e) {}

  const poll = async () => {
    attempts++;

    try {
      const res = await fetch(REPORT_URL);
      const text = await res.text();

      if (res.ok && text && text !== lastContent && !text.includes('Report not found')) {
        reportEl.textContent = text;
        reportEl.classList.remove('loading-text');
        setStatus('New report loaded successfully.', 'success');
        button.disabled = false;
        button.textContent = 'Generate Fresh Report';
        return;
      }
    } catch (err) {}

    if (attempts >= maxAttempts) {
      setStatus('Timed out waiting for the new report. Try again later.', 'error');
      button.disabled = false;
      button.textContent = 'Generate Fresh Report';
      return;
    }

    setTimeout(poll, interval);
  };

  setTimeout(poll, interval);
}

async function loadReport() {
  try {
    const res = await fetch(REPORT_URL);
    const text = await res.text();

    if (res.ok && !text.includes('Report not found')) {
      reportEl.textContent = text;
      reportEl.classList.remove('loading-text');
    } else {
      reportEl.textContent = 'No report available yet.\n\nClick "Generate Fresh Report" to create the first one.';
    }
  } catch (err) {
    reportEl.textContent = 'Could not load report. Please try again later.';
  }
}

function setStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = 'status visible';
  if (type) statusEl.classList.add(type);
}
