import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { clearCachedToken, getCurrentUser } from "../../lib/salesforce.js";

export function registerReconnectTool(server: McpServer) {
  server.tool(
    "reconnect",
    "Drops the in-memory access token and re-reads it from the `sf` CLI's current session. Use this AFTER you have re-authenticated at a terminal with `sf org login web --instance-url https://willowtree.my.salesforce.com --alias willowtree`. This tool does NOT open a browser — running over MCP stdio, it cannot launch interactive flows.",
    {},
    async () => {
      clearCachedToken();
      try {
        const user = await getCurrentUser();
        return {
          content: [{ type: "text", text: `Reconnected successfully. Logged in as ${user.name} (${user.email}).` }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Reconnection failed: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
