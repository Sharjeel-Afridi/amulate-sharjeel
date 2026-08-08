import { McpAppFrame, type McpAppFrameProps } from './McpAppFrame'

/**
 * Chrome around an MCP App.
 *
 * The badge is not decoration: a sandboxed widget rendered inline is otherwise
 * indistinguishable from host-drawn UI, and both the user and anyone reviewing
 * this project should be able to see at a glance which surfaces are
 * server-authored and which are ours.
 *
 * Styling is inline and deliberately thin — it borrows the tokens already
 * defined in `src/styles.css` rather than adding rules there.
 */

export interface McpAppCardProps extends McpAppFrameProps {
  /** Shown beside the badge, e.g. the tool that opened the widget. */
  label?: string
  /** The ui:// resource the HTML came from, if the host knows it. */
  uri?: string
}

export function McpAppCard({ label, uri, ...frame }: McpAppCardProps) {
  return (
    <section
      aria-label={`MCP App${label ? `: ${label}` : ''}`}
      style={{
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--surface)',
        overflow: 'hidden',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '7px 11px',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <span
          style={{
            flex: 'none',
            padding: '2px 6px',
            borderRadius: 5,
            border: '1px solid var(--accent)',
            color: 'var(--accent)',
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.08em',
          }}
        >
          MCP APP
        </span>
        {label && <span style={{ fontSize: 12, color: 'var(--text)' }}>{label}</span>}
        {uri && (
          <span
            style={{
              marginLeft: 'auto',
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: 11,
              color: 'var(--muted)',
            }}
            title={uri}
          >
            {uri}
          </span>
        )}
      </header>

      <McpAppFrame {...frame} />
    </section>
  )
}
