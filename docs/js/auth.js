// GitHub Device Flow OAuth via Cloudflare Worker CORS proxy
//
// The worker proxies requests to GitHub's device flow endpoints
// with proper CORS headers, since GitHub doesn't support CORS on those endpoints.
//
// Fallback: paste a Personal Access Token (PAT) directly.

const AUTH = {
    clientId: 'Ov23ctxqyUBplm3UrAGw',
    scopes: 'repo read:org',
    // Cloudflare Worker proxy — set this after deploying the worker
    proxyBase: 'https://its-all-good-proxy.penn-lv.workers.dev',
    storageKey: 'its-all-good-token',
    userKey: 'its-all-good-user',
};

function getToken() {
    return localStorage.getItem(AUTH.storageKey);
}

function getUser() {
    const u = localStorage.getItem(AUTH.userKey);
    return u ? JSON.parse(u) : null;
}

function clearAuth() {
    localStorage.removeItem(AUTH.storageKey);
    localStorage.removeItem(AUTH.userKey);
}

function hasDeviceFlow() {
    return !!AUTH.proxyBase && !!AUTH.clientId;
}

async function startDeviceFlow() {
    const resp = await fetch(`${AUTH.proxyBase}/login/device/code`, {
        method: 'POST',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            client_id: AUTH.clientId,
            scope: AUTH.scopes,
        }),
    });

    if (!resp.ok) throw new Error('Failed to start device flow');
    return await resp.json();
}

async function pollForToken(deviceCode, interval) {
    while (true) {
        await new Promise(r => setTimeout(r, interval * 1000));

        const resp = await fetch(`${AUTH.proxyBase}/login/oauth/access_token`, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                client_id: AUTH.clientId,
                device_code: deviceCode,
                grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
            }),
        });

        const data = await resp.json();

        if (data.access_token) {
            localStorage.setItem(AUTH.storageKey, data.access_token);
            const userResp = await fetch('https://api.github.com/user', {
                headers: { 'Authorization': `token ${data.access_token}` },
            });
            if (userResp.ok) {
                const user = await userResp.json();
                localStorage.setItem(AUTH.userKey, JSON.stringify({ login: user.login, avatar: user.avatar_url }));
            }
            return data.access_token;
        }

        if (data.error === 'authorization_pending') continue;
        if (data.error === 'slow_down') {
            interval += 5;
            continue;
        }
        throw new Error(data.error_description || data.error || 'Auth failed');
    }
}
