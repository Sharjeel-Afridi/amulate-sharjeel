import { McpAppFrame, type McpAppFrameProps } from './McpAppFrame'

/**
 * Chrome around an MCP App.
 *
 * The badge is not decoration: a sandboxed widget rendered inline is otherwise
 * indistinguishable from host-drawn UI, and both the user and anyone reviewing
 * this project should be able to see at a glance which surfaces are
 * server-authored and which are ours.
 *
 * Styling lives with the rest of the host skin in `src/styles.css` under
 * `.mcpapp`, so the widget's frame picks up the same surface and elevation
 * tokens as every other panel.
 */

export interface McpAppCardProps extends McpAppFrameProps {
  /** Shown beside the badge, e.g. what the widget is for. */
  label?: string
  /** The ui:// resource the HTML came from, if the host knows it. */
  uri?: string
}

export function McpAppCard({ label, uri, ...frame }: McpAppCardProps) {
  return (
    <section className="mcpapp" aria-label={`MCP App${label ? `: ${label}` : ''}`}>
      <header className="mcpapp__head">
        <span className="mcpapp__badge">MCP APP</span>
        {label && <span className="mcpapp__label">{label}</span>}
        {uri && (
          <span className="mcpapp__uri" title={uri}>
            {uri}
          </span>
        )}
      </header>

      <McpAppFrame {...frame} />
    </section>
  )
}
