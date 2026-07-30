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
    const REPORT_PATH = 'reports/latest.log';

    //CORS HEADERS
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET','POST','OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    //Handle preflight:
    if (request.method === 'OPTIONS'){
      return new Response(null, { headers: corsHeaders });
    }

  try{
    //TRIGGER THE WORKFLOW
    if(request.method === 'POST'){
      
      const response = await fetch(`${API_URL}/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`, {
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
        headers: { ...corsHeaders, 'Content-Type': 'application/json'}
      });
    } else {
      const errorText = await response.text();
      return new Response(JSON.stringify({ error: errorText }), {
        status: response.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json'}
      });
    }
  } 
  //GET THE LATEST REPORT
    if(request.method === 'GET') {
      const response = await fetch(`${API_URL}/${OWNER}/${REPO}/contents/${REPORT_PATH}`, 
          {
          headers: {
            'Accept': 'application/json',
            'Authorization': `Bearer ${GITHUB_TOKEN}`,
            'User-Agent': 'Climate-Report-Trigger',
            'X-GitHub-Api-Version': '2022-11-28'
            }
          }
    );
    if(!response.ok) {
      return new Response('Report not found yet. Please generate a new one.', {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'text/plain' }
      });
    }
    const text = await response.text();
    return new Response(text, {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'text/plain' }
    });
  }
      return new Response('Method not allowed', {
        status: 405,
        headers: corsHeaders
      });
  } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
};
