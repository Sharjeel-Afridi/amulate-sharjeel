/**
 * Host side of the MCP Apps bridge. The wire contract lives in
 * `packages/shared/src/mcp-app-protocol.ts`; this module is the browser
 * implementation of the host half of it.
 */
export { McpAppFrame, type McpAppCallTool, type McpAppFrameProps } from './McpAppFrame'
export { McpAppCard, type McpAppCardProps } from './McpAppCard'
