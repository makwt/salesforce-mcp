import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { clearCachedToken, getCurrentUser } from "../../lib/salesforce.js";

export function registerReconnectTool(server: McpServer) {
  server.tool(
    "reconnect",
    "Re-authenticates with Salesforce by clearing the cached token and opening a new browser login via the sf CLI. Use this when your session has expired or you need to switch accounts.",
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
