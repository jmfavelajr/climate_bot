const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const LAST_TICK = new Request('https://climate-bot.tick/last');

function dispatchUrl(env) {
  const owner = env.GITHUB_USER;
  const repo = env.GITHUB_REPO;
  const workflow = env.GITHUB_WF || 'climate_bot.yml';
  const base = (env.GITHUB_APIURL || 'https://api.github.com/repos').replace(/\/$/, '');
  if (base.includes(owner) && base.includes(repo)) {
    return `${base}/actions/workflows/${workflow}/dispatches`;
  }
  return `${base}/${owner}/${repo}/actions/workflows/${workflow}/dispatches`;
}

function varsUrl(env) {
  const owner = env.GITHUB_USER;
  const repo = env.GITHUB_REPO;
  return `https://api.github.com/repos/${owner}/${repo}/actions/variables/check_interval`;
}

async function getCheckInterval(env) {
  const fallback = Math.max(60, Number(env.CHECK_INTERVAL || 300) || 300);
  const token = env.GITHUB_TOKEN;
  if (!token || !env.GITHUB_USER || !env.GITHUB_REPO) return fallback;
  try {
    const res = await fetch(varsUrl(env), {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'climate-bot-tick',
      },
    });
    if (!res.ok) {
      console.log('check_interval fetch', res.status);
      return fallback;
    }
    const body = await res.json();
    const n = Number(body.value);
    if (!Number.isFinite(n) || n < 60) return fallback;
    return Math.floor(n);
  } catch (err) {
    console.log('check_interval error', err.message);
    return fallback;
  }
}

async function lastTickMs() {
  const hit = await caches.default.match(LAST_TICK);
  if (!hit) return 0;
  const n = Number(await hit.text());
  return Number.isFinite(n) ? n : 0;
}

async function setLastTickMs(ms) {
  await caches.default.put(
    LAST_TICK,
    new Response(String(ms), { headers: { 'Cache-Control': 'max-age=86400' } })
  );
}

async function triggerWorkflow(env) {
  const token = env.GITHUB_TOKEN;
  if (!token) throw new Error('Missing GITHUB_TOKEN');
  const res = await fetch(dispatchUrl(env), {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'climate-bot-tick',
    },
    body: JSON.stringify({ ref: env.GITHUB_REF || 'main' }),
  });
  const text = await res.text();
  return { status: res.status, text };
}

async function maybeDispatch(env, force = false) {
  const interval = await getCheckInterval(env);
  const now = Date.now();
  const last = await lastTickMs();
  const elapsed = (now - last) / 1000;
  if (!force && last && elapsed < interval) {
    return { skipped: true, interval, elapsed: Math.round(elapsed) };
  }
  const r = await triggerWorkflow(env);
  if (r.status === 204) await setLastTickMs(now);
  return { skipped: false, interval, github_status: r.status, body: r.text };
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      maybeDispatch(env, false).then((r) => console.log('cron tick', JSON.stringify(r)))
    );
  },

  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    if (request.method === 'POST' || request.method === 'GET') {
      try {
        const force = new URL(request.url).searchParams.get('force') === '1';
        const r = await maybeDispatch(env, force || request.method === 'POST');
        return new Response(JSON.stringify(r), {
          status: r.github_status && r.github_status !== 204 ? r.github_status : 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  },
};
