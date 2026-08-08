/**
 * MCP Apps render in sandboxed iframes, so they can't inherit the host's
 * stylesheet — every widget has to ship its own. These tokens mirror the host's
 * dark showroom skin so the form and checkout read as part of the app rather
 * than as something bolted into it.
 */
export const THEME_CSS = `
:root {
  --bg: #0b0c0e;
  --surface: rgba(255,255,255,0.045);
  --surface-2: rgba(255,255,255,0.07);
  --border: rgba(255,255,255,0.10);
  --border-strong: rgba(255,255,255,0.18);
  --text: #f2f4f7;
  --muted: #98a1ab;
  --accent: #c8ff3d;
  --accent-ink: #16200a;
  --danger: #ff6b6b;
  --radius: 10px;
}
* { box-sizing: border-box; }
html, body {
  margin: 0;
  background: transparent;
  color: var(--text);
  font: 400 14px/1.5 ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
}
.wrap { padding: 16px; }
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 16px;
}
.row { display: flex; gap: 12px; align-items: center; }
.between { display: flex; justify-content: space-between; align-items: center; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.stack { display: flex; flex-direction: column; gap: 12px; }
h1 { font-size: 16px; font-weight: 600; margin: 0; letter-spacing: -0.01em; }
h2 { font-size: 13px; font-weight: 600; margin: 0; }
.muted { color: var(--muted); }
.tiny { font-size: 12px; }
.label {
  display: block;
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 5px;
}
input[type="text"], input[type="email"], input[type="date"], select {
  width: 100%;
  height: 38px;
  padding: 0 11px;
  background: rgba(0,0,0,0.28);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  font: inherit;
  outline: none;
  transition: border-color .15s, box-shadow .15s;
}
input:focus, select:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(200,255,61,0.13);
}
input::placeholder { color: #5f6871; }
input[aria-invalid="true"] { border-color: var(--danger); }
.extra {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
  transition: border-color .15s, background .15s;
}
.extra:hover { border-color: var(--border-strong); background: var(--surface-2); }
.extra input { accent-color: var(--accent); width: 15px; height: 15px; margin: 0; }
.extra .price { margin-left: auto; color: var(--muted); font-size: 12px; }
button.primary {
  width: 100%;
  height: 42px;
  background: var(--accent);
  color: var(--accent-ink);
  border: 0;
  border-radius: var(--radius);
  font: 600 14px/1 inherit;
  cursor: pointer;
  transition: filter .15s, transform .08s;
}
button.primary:hover { filter: brightness(1.07); }
button.primary:active { transform: scale(0.985); }
button.primary:disabled { opacity: .45; cursor: not-allowed; }
.total { font-size: 22px; font-weight: 600; letter-spacing: -0.02em; }
.divider { height: 1px; background: var(--border); margin: 14px 0; }
.err { color: var(--danger); font-size: 12px; min-height: 15px; }
.mock-banner {
  display: flex; align-items: center; gap: 8px;
  background: rgba(255,193,7,0.10);
  border: 1px solid rgba(255,193,7,0.34);
  color: #ffd75e;
  border-radius: var(--radius);
  padding: 9px 12px;
  font-size: 12px;
  font-weight: 500;
}
.art { width: 92px; height: 42px; flex: none; }
.art svg { width: 100%; height: 100%; }
.done { text-align: center; padding: 26px 16px; }
.check {
  width: 46px; height: 46px; margin: 0 auto 14px;
  border-radius: 50%;
  background: var(--accent); color: var(--accent-ink);
  display: flex; align-items: center; justify-content: center;
  font-size: 24px; font-weight: 700;
  animation: pop .32s cubic-bezier(.2,1.3,.4,1);
}
@keyframes pop { from { transform: scale(0); } to { transform: scale(1); } }
.line { display: flex; justify-content: space-between; padding: 5px 0; font-size: 13px; }
.line span:first-child { color: var(--muted); }
`

/** Wraps widget markup in a complete, self-contained HTML document. */
export function layout(body: string, script: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${THEME_CSS}</style>
</head>
<body>
<div class="wrap">${body}</div>
<script>${script}</script>
</body>
</html>`
}

/** Escapes text destined for HTML. Listing data is generated, but never trust it. */
export function esc(s: unknown): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * The guest half of the MCP Apps bridge — JSON-RPC 2.0 over postMessage, per
 * SEP-1865. Method names, protocol version and payload shapes match
 * `@modelcontextprotocol/ext-apps`; see `packages/shared/src/mcp-app-protocol.ts`
 * for the contract and the reasoning behind implementing it directly.
 *
 * Exposes two globals to widget code:
 *   callTool(name, args) -> Promise<CallToolResult>
 *   reportSize()         -> push the current height to the host
 */
export const BRIDGE_JS = `
(function () {
  var PROTOCOL_VERSION = '${'2026-01-26'}';
  var nextId = 1;
  var pending = new Map();
  var lastHeight = 0;

  function post(msg) { window.parent.postMessage(msg, '*'); }

  function request(method, params) {
    var id = nextId++;
    return new Promise(function (resolve, reject) {
      pending.set(id, { resolve: resolve, reject: reject });
      post({ jsonrpc: '2.0', id: id, method: method, params: params });
    });
  }

  function notify(method, params) {
    post({ jsonrpc: '2.0', method: method, params: params });
  }

  function reportSize() {
    var h = Math.ceil(document.documentElement.getBoundingClientRect().height);
    if (h === lastHeight) return;
    lastHeight = h;
    notify('ui/notifications/size-changed', { height: h });
  }

  // The host may hand us its theme tokens; mirror them so the widget tracks the
  // host's appearance instead of hard-coding one.
  function applyHostContext(ctx) {
    if (!ctx || !ctx.styles) return;
    var root = document.documentElement;
    Object.keys(ctx.styles).forEach(function (k) {
      root.style.setProperty(k.startsWith('--') ? k : '--' + k, ctx.styles[k]);
    });
  }

  window.addEventListener('message', function (event) {
    var msg = event.data;
    if (!msg || msg.jsonrpc !== '2.0') return;

    if (msg.method === undefined && msg.id !== undefined) {
      var p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message || 'host error'));
      else p.resolve(msg.result);
      return;
    }

    if (msg.method === 'ui/notifications/host-context-changed') {
      applyHostContext(msg.params && msg.params.hostContext);
    }
  });

  window.callTool = function (name, args) {
    return request('tools/call', { name: name, arguments: args });
  };
  window.reportSize = reportSize;

  // The guest opens the handshake. If the host never answers we still render —
  // a widget that silently stays blank is worse than one that works uncoupled.
  request('ui/initialize', { protocolVersion: PROTOCOL_VERSION, appCapabilities: {} })
    .then(function (result) {
      notify('ui/notifications/initialized');
      if (result && result.hostContext) applyHostContext(result.hostContext);
      reportSize();
    })
    .catch(function () { reportSize(); });

  if (window.ResizeObserver) new ResizeObserver(reportSize).observe(document.documentElement);
  window.addEventListener('load', reportSize);
})();
`
