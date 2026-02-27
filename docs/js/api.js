// GitHub Actions API client
const ENGINEERING_REPO = 'microsoft/vscode-engineering';
const WORKFLOW_FILE = 'triage-agent.yml';

function authHeaders() {
    return {
        'Authorization': `token ${getToken()}`,
        'Accept': 'application/vnd.github+json',
    };
}

async function fetchTriageRuns(hoursBack = 6, status = 'all') {
    const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();
    let url = `https://api.github.com/repos/${ENGINEERING_REPO}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=100&created=>${since}`;
    if (status === 'success' || status === 'failure') {
        url += `&conclusion=${status}`;
    }

    const resp = await fetch(url, { headers: authHeaders() });
    if (resp.status === 401) {
        clearAuth();
        location.reload();
        return [];
    }
    if (!resp.ok) throw new Error(`API error: ${resp.status}`);

    const data = await resp.json();
    return data.workflow_runs.map(parseRun);
}

function parseRun(run) {
    // Extract issue number and repo from display_title like "Triage Agent -- microsoft/vscode#298029"
    const match = run.display_title.match(/--\s*(.+?)#(\d+)/);
    const repo = match ? match[1].trim() : '';
    const issue = match ? parseInt(match[2]) : null;

    const startedAt = new Date(run.run_started_at || run.created_at);
    const updatedAt = new Date(run.updated_at);
    const durationSec = run.status === 'completed'
        ? Math.round((updatedAt - startedAt) / 1000)
        : null;

    return {
        id: run.id,
        issue,
        repo,
        status: run.conclusion || run.status,
        startedAt,
        durationSec,
        htmlUrl: run.html_url,
        displayTitle: run.display_title,
    };
}

async function fetchRunArtifacts(runId) {
    const resp = await fetch(
        `https://api.github.com/repos/${ENGINEERING_REPO}/actions/runs/${runId}/artifacts`,
        { headers: authHeaders() }
    );
    if (!resp.ok) return [];
    const data = await resp.json();
    return data.artifacts;
}

async function downloadArtifact(artifactId) {
    // GitHub returns a 302 redirect to Azure Blob Storage.
    // The browser Fetch API automatically strips Authorization headers on
    // cross-origin redirects, so this works correctly with redirect: 'follow'.
    const resp = await fetch(
        `https://api.github.com/repos/${ENGINEERING_REPO}/actions/artifacts/${artifactId}/zip`,
        { headers: authHeaders() }
    );
    if (!resp.ok) throw new Error(`Failed to download artifact: ${resp.status}`);
    return await resp.blob();
}

async function fetchSessionJSONL(runId, issueNumber) {
    const artifacts = await fetchRunArtifacts(runId);

    // Look for the session artifact first, fall back to logs artifact
    let artifact = artifacts.find(a => a.name.startsWith('triage-agent-session-'));
    if (!artifact) {
        artifact = artifacts.find(a => a.name.startsWith('triage-agent-logs-'));
    }
    if (!artifact) return null;

    const blob = await downloadArtifact(artifact.id);

    // Unzip using JSZip (loaded from CDN)
    const zip = await JSZip.loadAsync(blob);
    const jsonlFile = Object.keys(zip.files).find(name => name.endsWith('.jsonl'));
    if (!jsonlFile) return null;

    return await zip.files[jsonlFile].async('string');
}
