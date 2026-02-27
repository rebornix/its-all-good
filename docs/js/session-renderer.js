// Parse events.jsonl and render session views

function parseEventsJSONL(text) {
    return text.trim().split('\n').map(line => JSON.parse(line));
}

function getSessionInfo(events) {
    const start = events.find(e => e.type === 'session.start');
    const lastEvent = events[events.length - 1];
    const startTime = start ? new Date(start.timestamp) : null;
    const endTime = lastEvent ? new Date(lastEvent.timestamp) : null;
    const durationSec = startTime && endTime ? (endTime - startTime) / 1000 : null;

    return {
        sessionId: start?.data?.sessionId || 'unknown',
        model: start?.data?.selectedModel || 'unknown',
        copilotVersion: start?.data?.copilotVersion || '',
        startTime,
        endTime,
        durationSec,
        eventCount: events.length,
        toolCalls: events.filter(e => e.type === 'tool.execution_start').length,
        turns: events.filter(e => e.type === 'assistant.turn_start').length,
    };
}

// Render the timeline view
function renderTimeline(events) {
    if (!events.length) return '<p class="muted">No events</p>';

    const timestamps = events.map(e => new Date(e.timestamp).getTime());
    const minTime = Math.min(...timestamps);
    const maxTime = Math.max(...timestamps);
    const totalDuration = maxTime - minTime || 1;

    // Build spans from event pairs
    const spans = [];
    const toolStarts = new Map();

    for (const event of events) {
        const ts = new Date(event.timestamp).getTime();

        switch (event.type) {
            case 'session.start':
                spans.push({
                    name: 'session.start',
                    type: 'session',
                    startMs: ts - minTime,
                    endMs: ts - minTime,
                    preview: event.data.selectedModel || '',
                    detail: JSON.stringify(event.data, null, 2),
                });
                break;

            case 'user.message':
                spans.push({
                    name: 'user.message',
                    type: 'user',
                    startMs: ts - minTime,
                    endMs: ts - minTime,
                    preview: truncate(event.data.content, 120),
                    detail: event.data.content,
                });
                break;

            case 'assistant.message':
                spans.push({
                    name: 'assistant.message',
                    type: 'assistant',
                    startMs: ts - minTime,
                    endMs: ts - minTime,
                    preview: truncate(event.data.content, 120),
                    detail: event.data.content,
                    toolRequests: event.data.toolRequests,
                });
                break;

            case 'assistant.reasoning':
                spans.push({
                    name: 'assistant.reasoning',
                    type: 'reasoning',
                    startMs: ts - minTime,
                    endMs: ts - minTime,
                    preview: truncate(safeString(event.data.content), 120),
                    detail: safeString(event.data.content),
                });
                break;

            case 'tool.execution_start':
                toolStarts.set(event.data.toolCallId, {
                    startMs: ts - minTime,
                    toolName: event.data.toolName,
                    arguments: event.data.arguments,
                });
                break;

            case 'tool.execution_complete': {
                const start = toolStarts.get(event.data.toolCallId);
                if (start) {
                    const resultStr = event.data.result?.content || event.data.result?.detailedContent || '';
                    spans.push({
                        name: `tool: ${start.toolName}`,
                        type: 'tool',
                        startMs: start.startMs,
                        endMs: ts - minTime,
                        preview: truncate(resultStr, 100),
                        detail: `Arguments:\n${JSON.stringify(start.arguments, null, 2)}\n\nResult:\n${typeof event.data.result === 'string' ? event.data.result : JSON.stringify(event.data.result, null, 2)}`,
                        success: event.data.success,
                    });
                    toolStarts.delete(event.data.toolCallId);
                }
                break;
            }

            case 'assistant.turn_start':
                spans.push({
                    name: `turn ${event.data.turnId}`,
                    type: 'default',
                    startMs: ts - minTime,
                    endMs: ts - minTime,
                    preview: '',
                });
                break;
        }
    }

    // Render
    const totalEvents = events.length;
    const toolCount = spans.filter(s => s.type === 'tool').length;
    const totalSec = (totalDuration / 1000).toFixed(1);

    let html = `<div class="trace-header">
        <span class="trace-meta">${totalEvents} events</span>
        <span class="trace-meta">${toolCount} tool calls</span>
        <span class="trace-meta">${totalSec}s total</span>
    </div>`;

    html += '<div class="trace-spans">';
    for (const [idx, span] of spans.entries()) {
        const leftPct = (span.startMs / totalDuration * 100).toFixed(2);
        const width = span.endMs - span.startMs;
        const widthPct = Math.max(0.5, (width / totalDuration * 100)).toFixed(2);
        const durationLabel = width > 0 ? `${(width / 1000).toFixed(2)}s` : '';
        const spanClass = `span-${span.type}`;
        const spanId = `span-${idx}`;
        const hasDetail = !!span.detail;

        html += `<div class="trace-span ${hasDetail ? 'clickable' : ''}" ${hasDetail ? `onclick="toggleSpanDetail('${spanId}')"` : ''}>
            <div class="trace-span-label">
                <span class="trace-span-icon ${spanClass}"></span>
                <span class="trace-span-name">${escapeHtml(span.name)}</span>
                ${span.preview ? `<span class="trace-span-preview">${escapeHtml(span.preview)}</span>` : ''}
                <span class="trace-span-duration">${durationLabel}</span>
            </div>
            <div class="trace-span-bar-container">
                <div class="trace-span-bar ${spanClass}" style="left:${leftPct}%;width:${widthPct}%"></div>
            </div>
        </div>`;

        if (hasDetail) {
            html += `<div id="${spanId}" class="trace-span-detail" style="display:none">
                <div class="trace-detail-section">
                    <pre class="trace-detail-content">${escapeHtml(span.detail)}</pre>
                </div>
            </div>`;
        }
    }
    html += '</div>';
    return html;
}

// Render conversation view
function renderConversation(events) {
    let html = '';
    for (const event of events) {
        if (event.type === 'user.message') {
            html += `<div class="conv-message role-user">
                <div class="conv-role">User</div>
                <div class="conv-content">${escapeHtml(event.data.content)}</div>
            </div>`;
        } else if (event.type === 'assistant.message') {
            let toolsHtml = '';
            if (event.data.toolRequests) {
                try {
                    const tools = JSON.parse(event.data.toolRequests);
                    if (Array.isArray(tools) && tools.length > 0) {
                        toolsHtml = `<div class="conv-tools">${tools.map(t =>
                            `<span class="conv-tool-badge">${escapeHtml(t.name)}</span>`
                        ).join('')}</div>`;
                    }
                } catch {}
            }
            html += `<div class="conv-message role-assistant">
                <div class="conv-role">Assistant</div>
                <div class="conv-content">${escapeHtml(event.data.content)}</div>
                ${toolsHtml}
            </div>`;
        } else if (event.type === 'assistant.reasoning') {
            html += `<div class="conv-message role-assistant">
                <div class="conv-role">Reasoning</div>
                <div class="conv-content">${escapeHtml(safeString(event.data.content))}</div>
            </div>`;
        }
    }
    return html || '<p class="muted">No conversation data</p>';
}

function toggleSpanDetail(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

function truncate(str, len) {
    if (!str) return '';
    return str.length > len ? str.substring(0, len) + '…' : str;
}

function safeString(val) {
    if (typeof val === 'string') {
        // Strip wrapping quotes if present
        if (val.startsWith('"') && val.endsWith('"')) {
            try { return JSON.parse(val); } catch {}
        }
        return val;
    }
    return JSON.stringify(val);
}
