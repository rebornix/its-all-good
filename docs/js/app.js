// Main app logic
let allRuns = [];

document.addEventListener('DOMContentLoaded', () => {
    if (getToken()) {
        showApp();
        loadRuns();
    } else {
        showAuth();
    }
});

function showAuth() {
    document.getElementById('auth-screen').style.display = 'flex';
    document.getElementById('app').style.display = 'none';

    // PAT login
    document.getElementById('pat-btn').addEventListener('click', async () => {
        const token = document.getElementById('pat-input').value.trim();
        if (!token) return;

        // Validate token
        try {
            const resp = await fetch('https://api.github.com/user', {
                headers: { 'Authorization': `token ${token}` },
            });
            if (!resp.ok) {
                alert('Invalid token or insufficient permissions');
                return;
            }
            const user = await resp.json();
            localStorage.setItem(AUTH.storageKey, token);
            localStorage.setItem(AUTH.userKey, JSON.stringify({ login: user.login, avatar: user.avatar_url }));
            showApp();
            loadRuns();
        } catch (err) {
            alert('Failed to validate token: ' + err.message);
        }
    });

    // Allow Enter key in PAT input
    document.getElementById('pat-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') document.getElementById('pat-btn').click();
    });
}

function showApp() {
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('app').style.display = 'block';

    const user = getUser();
    if (user) {
        document.getElementById('user-info').textContent = user.login;
    }

    document.getElementById('logout-btn').addEventListener('click', () => {
        clearAuth();
        location.reload();
    });

    document.getElementById('refresh-btn').addEventListener('click', loadRuns);
    document.getElementById('time-filter').addEventListener('change', loadRuns);
    document.getElementById('status-filter').addEventListener('change', loadRuns);
    document.getElementById('repo-filter').addEventListener('change', renderRuns);

    // Overlay close
    document.getElementById('close-overlay').addEventListener('click', closeOverlay);
    document.getElementById('session-overlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeOverlay();
    });

    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
        });
    });
}

async function loadRuns() {
    const hours = parseInt(document.getElementById('time-filter').value);
    const status = document.getElementById('status-filter').value;

    document.getElementById('runs-body').innerHTML =
        '<tr><td colspan="6"><span class="spinner"></span> Loading triage runs…</td></tr>';

    try {
        allRuns = await fetchTriageRuns(hours, status);
        populateRepoFilter();
        renderRuns();
    } catch (err) {
        document.getElementById('runs-body').innerHTML =
            `<tr><td colspan="6">Failed to load: ${escapeHtml(err.message)}</td></tr>`;
    }
}

function populateRepoFilter() {
    const select = document.getElementById('repo-filter');
    const current = select.value;
    const repos = [...new Set(allRuns.map(r => r.repo).filter(Boolean))].sort();

    select.innerHTML = '<option value="all">All Repos</option>';
    repos.forEach(repo => {
        const opt = document.createElement('option');
        opt.value = repo;
        opt.textContent = repo;
        select.appendChild(opt);
    });
    select.value = current;
}

function getFilteredRuns() {
    const repo = document.getElementById('repo-filter').value;
    let runs = allRuns;
    if (repo !== 'all') {
        runs = runs.filter(r => r.repo === repo);
    }
    return runs;
}

function renderRuns() {
    const runs = getFilteredRuns();

    // Stats
    const total = runs.length;
    const success = runs.filter(r => r.status === 'success').length;
    const failed = runs.filter(r => r.status === 'failure').length;
    const durations = runs.filter(r => r.durationSec).map(r => r.durationSec);
    const avgDuration = durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : null;

    document.getElementById('stat-total').textContent = total;
    document.getElementById('stat-success').textContent = success;
    document.getElementById('stat-failed').textContent = failed;
    document.getElementById('stat-duration').textContent = avgDuration ? formatDuration(avgDuration) : '-';

    // Table
    const tbody = document.getElementById('runs-body');
    if (runs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6">No triage runs found in this time range</td></tr>';
        return;
    }

    tbody.innerHTML = runs.map(run => {
        const issueLink = run.issue && run.repo
            ? `<a href="https://github.com/${run.repo}/issues/${run.issue}" target="_blank">${run.repo}#${run.issue}</a>`
            : escapeHtml(run.displayTitle);

        const statusClass = run.status === 'success' ? 'status-success'
            : run.status === 'failure' ? 'status-failure'
            : 'status-running';

        const duration = run.durationSec ? formatDuration(run.durationSec) : '-';
        const timeAgo = formatTimeAgo(run.startedAt);

        return `<tr>
            <td>${issueLink}</td>
            <td>${escapeHtml(run.repo)}</td>
            <td><span class="status-badge ${statusClass}">${run.status}</span></td>
            <td title="${run.startedAt.toISOString()}">${timeAgo}</td>
            <td>${duration}</td>
            <td><button class="session-btn" onclick="openSession(${run.id}, '${escapeHtml(run.displayTitle)}', ${run.issue})">View Session</button></td>
        </tr>`;
    }).join('');
}

async function openSession(runId, title, issueNumber) {
    const overlay = document.getElementById('session-overlay');
    overlay.style.display = 'block';
    document.body.style.overflow = 'hidden';

    document.getElementById('session-title').textContent = title;
    document.getElementById('session-meta').innerHTML = '';
    document.getElementById('session-timeline').innerHTML = '<div class="loading"><span class="spinner"></span> Downloading session data…</div>';
    document.getElementById('session-conversation').innerHTML = '';
    document.getElementById('session-raw').textContent = '';

    // Reset to timeline tab
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelector('.tab-btn[data-tab="timeline"]').classList.add('active');
    document.getElementById('tab-timeline').classList.add('active');

    try {
        const jsonlText = await fetchSessionJSONL(runId, issueNumber);
        if (!jsonlText) {
            document.getElementById('session-timeline').innerHTML =
                '<p class="muted">No session data available for this run. The events.jsonl artifact may not exist.</p>';
            return;
        }

        const events = parseEventsJSONL(jsonlText);
        const info = getSessionInfo(events);

        // Render meta
        document.getElementById('session-meta').innerHTML = `
            <span class="meta-item"><span class="meta-label">Model:</span> ${escapeHtml(info.model)}</span>
            <span class="meta-item"><span class="meta-label">Duration:</span> ${info.durationSec ? formatDuration(Math.round(info.durationSec)) : '-'}</span>
            <span class="meta-item"><span class="meta-label">Events:</span> ${info.eventCount}</span>
            <span class="meta-item"><span class="meta-label">Tool calls:</span> ${info.toolCalls}</span>
            <span class="meta-item"><span class="meta-label">Turns:</span> ${info.turns}</span>
            <span class="meta-item"><span class="meta-label">Copilot:</span> v${escapeHtml(info.copilotVersion)}</span>
        `;

        // Render views
        document.getElementById('session-timeline').innerHTML = renderTimeline(events);
        document.getElementById('session-conversation').innerHTML = renderConversation(events);
        document.getElementById('session-raw').textContent = jsonlText;
    } catch (err) {
        document.getElementById('session-timeline').innerHTML =
            `<p class="muted">Failed to load session: ${escapeHtml(err.message)}</p>`;
    }
}

function closeOverlay() {
    document.getElementById('session-overlay').style.display = 'none';
    document.body.style.overflow = '';
}

function formatDuration(seconds) {
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function formatTimeAgo(date) {
    const diff = (Date.now() - date.getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}
