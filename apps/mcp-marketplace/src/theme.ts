/**
 * MCP Apps render in sandboxed iframes, so they can't inherit the host's
 * stylesheet — every widget has to ship its own. These tokens mirror the host's
 * dark showroom skin so the form and checkout read as part of the app rather
 * than as something bolted into it.
 */
export const THEME_CSS = `
:root {
  --bg: #15181d;
  --surface: rgba(255,255,255,0.035);
  --surface-2: rgba(255,255,255,0.06);
  --surface-3: #1d2127;
  --sunken: rgba(0,0,0,0.3);
  --border: rgba(255,255,255,0.08);
  --border-strong: rgba(255,255,255,0.16);
  --text: #f4f6f8;
  --muted: #99a2ad;
  --faint: #6b7480;
  --accent: #c8ff3d;
  --accent-ink: #14200a;
  --accent-dim: rgba(200,255,61,0.4);
  --success: #6ee7a8;
  --danger: #ff6b6b;
  --radius: 10px;
}
* { box-sizing: border-box; }
html, body {
  margin: 0;
  /* A sandboxed srcdoc iframe has nothing behind it, so "transparent" resolves
     to the browser default of white and the dark palette becomes unreadable.
     The host can still override --bg through the initialize handshake. */
  background: var(--bg);
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

/* ======================================================================
   The booking journey.
   ======================================================================
   One widget, four steps, one on screen at a time. Everything a person has
   to decide about a car is here — dates, cover, who is driving, paying — and
   showing all of it at once is what made a €500 transaction read as a form
   dump. Each step replaces the last, and every step after the first can be
   walked back.
*/

.app { display: flex; flex-direction: column; }

/* Which car this is about. Present on every step, so nobody has to scroll
   back to check they are booking the one they picked. */
.summary {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface-2);
}
.summary__art { width: 84px; height: 54px; flex: none; }
.summary__art img { width: 100%; height: 100%; object-fit: contain; display: block; }
.summary__body { min-width: 0; flex: 1; }
.summary__name { font-size: 14px; font-weight: 600; letter-spacing: -0.01em; }
.summary__meta {
  font-size: 11.5px; color: var(--faint);
  text-transform: uppercase; letter-spacing: 0.05em;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.summary__rate { margin-left: auto; text-align: right; flex: none; }
.summary__rate b { font-size: 15px; font-weight: 600; letter-spacing: -0.02em; }
.summary__rate span { display: block; font-size: 11px; color: var(--faint); }

/* ------------------------------------------------------------- progress */

.steps { display: flex; align-items: center; gap: 0; margin: 18px 0 16px; }
.steps__item {
  display: flex; align-items: center; gap: 7px;
  flex: none;
  background: none; border: 0; padding: 0;
  font: inherit; color: var(--faint);
  cursor: default;
}
.steps__item[data-done="1"] { cursor: pointer; }
.steps__num {
  width: 20px; height: 20px; border-radius: 50%;
  display: grid; place-items: center;
  border: 1.5px solid var(--border-strong);
  font-size: 10px; font-weight: 700;
  color: var(--faint);
  transition: background .18s, border-color .18s, color .18s;
}
.steps__label { font-size: 12px; white-space: nowrap; }
.steps__item[data-done="1"] .steps__num {
  background: var(--success); border-color: var(--success); color: #0d1a12;
}
.steps__item[data-done="1"] .steps__label { color: var(--muted); }
.steps__item[data-active="1"] .steps__num {
  background: var(--accent); border-color: var(--accent); color: var(--accent-ink);
}
.steps__item[data-active="1"] .steps__label { color: var(--text); font-weight: 600; }
.steps__rule { flex: 1; height: 1px; background: var(--border-strong); margin: 0 8px; min-width: 8px; }

/* ---------------------------------------------------------------- steps */

.step { display: none; }
.step[data-current="1"] { display: block; animation: step-in .22s cubic-bezier(.2,.7,.3,1); }
@keyframes step-in { from { opacity: 0; transform: translateX(8px); } to { opacity: 1; transform: none; } }

.step__title { font-size: 15px; font-weight: 600; margin: 0 0 3px; letter-spacing: -0.01em; }
.step__lede { font-size: 12.5px; color: var(--muted); margin: 0 0 16px; }

/* ---------------------------------------------------------------- fields */

.field { margin-bottom: 14px; }
.field:last-child { margin-bottom: 0; }
.field__label { display: block; font-size: 12px; color: var(--muted); margin-bottom: 6px; font-weight: 500; }
.field__hint { font-size: 11.5px; color: var(--faint); margin-top: 5px; }
.field__error { font-size: 11.5px; color: var(--danger); margin-top: 5px; min-height: 0; }
.field--bad input { border-color: var(--danger); }

.readonly {
  display: flex; align-items: center; gap: 8px;
  height: 42px; padding: 0 12px;
  background: var(--sunken);
  border: 1px dashed var(--border);
  border-radius: var(--radius);
  color: var(--muted);
  font-size: 13px;
}

/* ---------------------------------------------------------------- extras */

.option {
  display: flex; align-items: flex-start; gap: 11px;
  padding: 12px 13px;
  border: 1px solid var(--border);
  border-radius: 12px;
  cursor: pointer;
  transition: border-color .15s, background .15s;
}
.option + .option { margin-top: 8px; }
.option:hover { border-color: var(--border-strong); background: var(--surface-2); }
.option:has(input:checked) { border-color: var(--accent-dim); background: rgba(200,255,61,0.05); }
.option input { accent-color: var(--accent); width: 16px; height: 16px; margin: 2px 0 0; flex: none; }
/* The children are spans, so they need to be told to stack — an inline note
   trailing its own label reads as one run-on sentence. */
.option__body { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 2px; }
.option__name { display: block; font-size: 13.5px; font-weight: 500; }
.option__note { display: block; font-size: 11.5px; color: var(--faint); line-height: 1.4; }
.option__price { margin-left: auto; flex: none; font-size: 13px; font-weight: 600; white-space: nowrap; }
.option__price small { color: var(--faint); font-weight: 400; }

/* --------------------------------------------------------------- summary */

.lines { border-top: 1px solid var(--border); margin-top: 16px; padding-top: 12px; }
.lines .line { display: flex; justify-content: space-between; padding: 4px 0; font-size: 13px; }
.lines .line span:first-child { color: var(--muted); }
.lines .line span:last-child { font-variant-numeric: tabular-nums; }

/* ------------------------------------------------------------ action bar */

.bar {
  display: flex; align-items: center; gap: 12px;
  margin-top: 18px; padding-top: 14px;
  border-top: 1px solid var(--border);
}
.bar__total { margin-right: auto; }
.bar__total span { display: block; font-size: 11px; color: var(--faint); text-transform: uppercase; letter-spacing: 0.06em; }
.bar__total b { font-size: 20px; font-weight: 600; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }

.btn {
  height: 42px; padding: 0 20px;
  border-radius: var(--radius);
  border: 1px solid var(--border-strong);
  background: transparent;
  color: var(--text);
  font: 600 13.5px/1 inherit;
  cursor: pointer;
  transition: filter .15s, transform .08s, background .15s, border-color .15s;
}
.btn:hover:not(:disabled) { background: var(--surface-2); border-color: var(--border-strong); }
.btn:active:not(:disabled) { transform: scale(.985); }
.btn:disabled { opacity: .4; cursor: not-allowed; }
.btn--primary { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
.btn--primary:hover:not(:disabled) { background: var(--accent); filter: brightness(1.08); }
.btn--back { padding: 0 14px; border-color: transparent; color: var(--muted); }
.btn--back:hover:not(:disabled) { color: var(--text); }

.note { font-size: 11.5px; color: var(--faint); text-align: center; margin-top: 10px; }
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
input[type="text"], input[type="email"], input[type="tel"], input[type="date"], select {
  width: 100%;
  height: 42px;
  padding: 0 12px;
  background: var(--sunken);
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
/* The marketplace photos are 752x500 cut-outs on transparency, so they need a
   box near that ratio and object-fit to stop them stretching. */
.art { width: 104px; height: 68px; flex: none; }
.art svg { width: 100%; height: 100%; }
.art img { width: 100%; height: 100%; object-fit: contain; display: block; }
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
    // Measure the body, not the document element. The root box is sized against
    // the iframe's own viewport, which the host has just set from our last
    // report — so a widget that gets shorter keeps re-reporting the taller
    // number and can only ever grow. That is invisible on a single-page widget
    // and very visible on one with steps, which leaves a screen of dead space
    // below itself the moment a short step follows a tall one.
    var box = document.body || document.documentElement;
    var h = Math.ceil(box.getBoundingClientRect().height);
    if (!h || h === lastHeight) return;
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
    // Only the host may talk to us. Under an opaque origin event.origin is the
    // string "null" and proves nothing, so identity is checked on the window
    // instead. Without this, any frame could resolve a pending tools/call and
    // tell this widget its booking succeeded when nothing was submitted.
    if (event.source !== window.parent) return;

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
    return request('tools/call', { name: name, arguments: args }).then(function (result) {
      // A CallToolResult carrying isError is a failure the widget must show, not
      // a success with awkward contents. Surface it as a rejection so callers
      // cannot mistake it for a completed booking.
      if (result && result.isError) {
        var detail = (result.content || [])
          .map(function (c) { return c && c.text; })
          .filter(Boolean)
          .join(' ');
        throw new Error(detail || 'The server rejected that request.');
      }
      return result;
    });
  };
  window.reportSize = reportSize;

  // The guest opens the handshake. If the host never answers we still render —
  // a widget that silently stays blank is worse than one that works uncoupled.
  var settled = false;
  function finish(result) {
    if (settled) return;
    settled = true;
    // Announce readiness before reporting size, so a host that gates on
    // initialized does not discard the opening measurement.
    notify('ui/notifications/initialized');
    if (result && result.hostContext) applyHostContext(result.hostContext);
    reportSize();
    if (window.ResizeObserver) new ResizeObserver(reportSize).observe(document.body);
  }

  request('ui/initialize', { protocolVersion: PROTOCOL_VERSION, appCapabilities: {} })
    .then(finish)
    .catch(function () { finish(null); });

  // A host that never answers must not leave the widget unmeasured forever.
  setTimeout(function () { finish(null); }, 2000);

  window.addEventListener('load', reportSize);
})();
`
