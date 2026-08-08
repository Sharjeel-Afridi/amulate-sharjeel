import type { JsonRpcMessage } from '@car/shared'
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../../styles.css'
import { McpAppCard } from '../McpAppCard'
import fixtureHtml from './booking-form.fixture.html?raw'

/**
 * Standalone harness for the host bridge, served at /mcp-demo.html.
 *
 * The HTML is a real `start_booking` result captured from the marketplace
 * server, not a hand-written stand-in — testing the host against a mock guest
 * would prove nothing about the contract. `onCallTool` is stubbed so the demo
 * runs without the API, and every frame that crosses the boundary is shown, so
 * the handshake is visible rather than merely asserted.
 */

const HOST_CONTEXTS = {
  showroom: {
    theme: 'dark' as const,
    displayMode: 'inline' as const,
    locale: 'en-IE',
    styles: { '--accent': '#c8ff3d', '--accent-ink': '#16200a' },
  },
  amber: {
    theme: 'dark' as const,
    displayMode: 'inline' as const,
    locale: 'en-IE',
    styles: { '--accent': '#ffc14d', '--accent-ink': '#2a1d00' },
  },
}

/**
 * `?autopilot=1` appends this to the widget document.
 *
 * A frame sandboxed without `allow-same-origin` gets an opaque origin, which
 * Chrome isolates into its own process, and browser automation cannot deliver
 * synthetic clicks or keystrokes into it — they land on the <iframe> element
 * instead. Driving the widget's own controls from inside the document is the
 * only way to exercise the submit path without a human at the keyboard. It
 * touches nothing in the bridge: the click runs the widget's real handler,
 * which calls the real `window.callTool`.
 */
const AUTOPILOT = `<script>
window.addEventListener('load', function () {
  setTimeout(function () {
    document.getElementById('name').value = 'Alex Moreau';
    document.getElementById('email').value = 'alex@example.com';
    var boxes = document.querySelectorAll('[data-extra]');
    boxes[0].checked = true;
    boxes[2].checked = true;
    document.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('submit').click();
  }, 400);
});
<\/script>`

const params = new URLSearchParams(location.search)
const autopilot = params.has('autopilot')
/** `?fail=1` rejects every tool call, to exercise the JSON-RPC error path. */
const failing = params.has('fail')
const widgetHtml = autopilot ? fixtureHtml.replace('</body>', `${AUTOPILOT}</body>`) : fixtureHtml

interface LogEntry {
  seq: number
  at: string
  direction: 'in' | 'out'
  summary: string
  detail: string
}

function describe(message: JsonRpcMessage): string {
  const m = message as { method?: string; id?: number | string; error?: { code: number } }
  if (m.method) return m.id === undefined ? `notification ${m.method}` : `request #${m.id} ${m.method}`
  return m.error ? `error   #${m.id}` : `result  #${m.id}`
}

function Demo() {
  const [log, setLog] = useState<LogEntry[]>([])
  const [contextName, setContextName] = useState<keyof typeof HOST_CONTEXTS>('showroom')

  const record = (direction: 'in' | 'out', message: JsonRpcMessage) => {
    const detail = JSON.stringify(message)
    console.log(`[mcp-app ${direction === 'in' ? 'guest->host' : 'host->guest'}]`, message)
    setLog((prev) => [
      ...prev,
      {
        seq: prev.length + 1,
        at: new Date().toISOString().slice(11, 23),
        direction,
        summary: describe(message),
        detail: detail.length > 400 ? `${detail.slice(0, 400)}…` : detail,
      },
    ])
  }

  const onCallTool = async (name: string, args: Record<string, unknown>) => {
    console.log('[demo] onCallTool', name, args)
    await new Promise((r) => setTimeout(r, 300))
    if (failing) throw new Error('simulated API failure')
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ bookingId: 'BK-DEMO', tool: name, received: args }),
        },
      ],
    }
  }

  return (
    // styles.css locks the app shell to the viewport, so the harness scrolls
    // itself. The scroller has to be the outer element: a grid with a definite
    // height sizes its auto rows to fit, which would clip the widget instead of
    // letting it grow to the height the guest asked for.
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <main
        style={{ maxWidth: 620, margin: '0 auto', padding: 24, display: 'grid', gap: 16 }}
      >
        <header style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h1 style={{ fontSize: 15, margin: 0 }}>MCP Apps host bridge</h1>
          {autopilot && <span style={{ fontSize: 11, color: 'var(--muted)' }}>autopilot</span>}
          <button
            type="button"
            onClick={() => setContextName(contextName === 'showroom' ? 'amber' : 'showroom')}
            style={{
              marginLeft: 'auto',
              height: 28,
              padding: '0 10px',
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              color: 'var(--text)',
              font: 'inherit',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Push host context ({contextName})
          </button>
        </header>

        <McpAppCard
          label="start_booking"
          uri="ui://car-matchmaker/booking-form.html"
          html={widgetHtml}
          hostContext={HOST_CONTEXTS[contextName]}
          onCallTool={onCallTool}
          onProtocolMessage={record}
          onError={(e) => console.error('[demo] host error', e)}
        />

        <section
          style={{
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            background: 'var(--surface)',
            padding: 12,
            font: '400 11px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace',
            color: 'var(--muted)',
          }}
        >
          <div style={{ color: 'var(--text)', marginBottom: 6 }}>JSON-RPC log ({log.length})</div>
          {log.map((e) => (
            <div key={e.seq} style={{ marginBottom: 4 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <span style={{ color: 'var(--faint)' }}>{e.at}</span>
                <span style={{ color: e.direction === 'in' ? 'var(--accent)' : 'var(--muted)' }}>
                  {e.direction === 'in' ? 'guest -> host' : 'host -> guest'}
                </span>
                <span style={{ color: 'var(--text)' }}>{e.summary}</span>
              </div>
              <div style={{ color: 'var(--faint)', wordBreak: 'break-all' }}>{e.detail}</div>
            </div>
          ))}
        </section>
      </main>
    </div>
  )
}

const root = document.getElementById('root')
if (!root) throw new Error('#root missing')
createRoot(root).render(
  <StrictMode>
    <Demo />
  </StrictMode>,
)
