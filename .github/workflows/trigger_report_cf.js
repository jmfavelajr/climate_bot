export default {
  async fetch(request, env) {
    //ONLY ALLOW POST REQUESTS
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed:' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' }
      });
    }

     //secrets stored in cf
    const GITHUB_TOKEN = env.GITHUB_TOKEN;
    const OWNER = env.GITHUB_USER;
    const REPO = env.GITHUB_REPO;
    const WORKFLOW_FILE = env.GITHUB_WF;
    const API_URL = env.GITHUB_APIURL;

  try{
    const response = await fetch(`${API_URL}/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
      {
            method: 'POST',
            headers: {
              'Accept': 'application/vnd.github+json',
              'Authorization': `Bearer ${GITHUB_TOKEN}`,
              'X-GitHub-Api-Version': '2022-11-28',
              'User-Agent': 'Climate-Report-Trigger'
        },
        body: JSON.stringify({
            ref: 'main' //change to 'master' if needed
        })
      }
    );

    if (response.status === 204){
      return new Response(JSON.stringify({ message: 'Workflow triggered successfully' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json'}
      });
    } else {
      const errorText = await response.text();
      return new Response(JSON.stringify({ error: errorText }), {
        status: response.status,
        headers: { 'Content-Type': 'application/json'}
      });
    }
  } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
};
