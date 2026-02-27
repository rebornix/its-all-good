// GitHub Device Flow OAuth
//
// To use device flow, create a GitHub OAuth App:
//   1. Go to https://github.com/settings/developers → "New OAuth App"
//   2. Set "Authorization callback URL" to https://github.com (unused for device flow)
//   3. Enable "Device Flow" in the app settings
//   4. Copy the Client ID and set it below
//
// Alternatively, you can paste a Personal Access Token (PAT) directly.
// The PAT needs: repo, read:org scopes.

const AUTH = {
    clientId: '', // Set your OAuth App Client ID here
    scopes: 'repo read:org',
    deviceCodeUrl: 'https://github.com/login/device/code',
    tokenUrl: 'https://github.com/login/oauth/access_token',
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

async function startDeviceFlow() {
    const resp = await fetch(AUTH.deviceCodeUrl, {
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

        const resp = await fetch(AUTH.tokenUrl, {
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
            // Fetch user info
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
