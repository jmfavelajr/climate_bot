const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

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

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      triggerWorkflow(env).then((r) => console.log('cron dispatch', r.status, r.text))
    );
  },

  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    if (request.method === 'POST' || request.method === 'GET') {
      try {
        const r = await triggerWorkflow(env);
        const ok = r.status === 204;
        return new Response(
          JSON.stringify({
            ok,
            github_status: r.status,
            body: r.text || (ok ? 'Workflow triggered' : ''),
          }),
          {
            status: ok ? 200 : r.status,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
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
