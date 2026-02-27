// Cloudflare Worker — CORS proxy for GitHub OAuth Device Flow
// Deploy: npx wrangler deploy
// Or paste into Cloudflare dashboard → Workers & Pages → Create → Quick Edit

const ALLOWED_ORIGINS = [
  'https://rebornix.github.io',
  'https://rebornix.com',
  'http://localhost:8090',
];

const GITHUB_ENDPOINTS = [
  'https://github.com/login/device/code',
  'https://github.com/login/oauth/access_token',
];

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Access-Control-Max-Age': '86400',
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = ALLOWED_ORIGINS.some(o => origin.startsWith(o));
    const headers = corsHeaders(allowed ? origin : ALLOWED_ORIGINS[0]);

    // Handle preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers });
    }

    // Extract target endpoint from path: /device/code or /access_token
    const url = new URL(request.url);
    let target;
    if (url.pathname === '/login/device/code') {
      target = GITHUB_ENDPOINTS[0];
    } else if (url.pathname === '/login/oauth/access_token') {
      target = GITHUB_ENDPOINTS[1];
    } else {
      return new Response('Not found', { status: 404, headers });
    }

    // Forward request to GitHub
    const body = await request.text();
    const resp = await fetch(target, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body,
    });

    const data = await resp.text();
    return new Response(data, {
      status: resp.status,
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
    });
  },
};
