import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getCurrentUser, getInstanceUrl } from "../../lib/salesforce.js";

export function registerWhoAmITool(server: McpServer) {
  server.tool(
    "whoami",
    "Returns the identity of the currently authenticated Salesforce user: name, email, Salesforce User ID, and linked Contact ID. " +
      "Also confirms connectivity to the org. " +
      "Use this at the start of a session to confirm who is logged in, and to anchor any 'my' queries (e.g. my projects, my team, my metrics) to the correct person.",
    {},
    async () => {
      const instanceUrl = await getInstanceUrl();

      let user: Awaited<ReturnType<typeof getCurrentUser>>;
      try {
        user = await getCurrentUser();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error resolving current user: ${message}` }],
          isError: true,
        };
      }

      const lines = [
        `Connected to: ${instanceUrl}`,
        ``,
        `Name:       ${user.name}`,
        `Email:      ${user.email}`,
        `User ID:    ${user.userId}`,
        `Contact ID: ${user.contactId}`,
      ];

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );
}
