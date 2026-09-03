import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getCurrentUserBasic, getInstanceUrl, getTargetOrgAlias } from "../../lib/salesforce.js";

export function registerWhoAmITool(server: McpServer) {
  server.tool(
    "whoami",
    "Returns the identity of the currently authenticated Salesforce user: name, email, Salesforce User ID, and linked Contact ID. " +
      "Also confirms connectivity to the org. " +
      "Use this at the start of a session to confirm who is logged in, and to anchor any 'my' queries (e.g. my projects, my team, my metrics) to the correct person.",
    {},
    async () => {
      const instanceUrl = await getInstanceUrl();

      let user: Awaited<ReturnType<typeof getCurrentUserBasic>>;
      try {
        user = await getCurrentUserBasic();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error resolving current user: ${message}` }],
          isError: true,
        };
      }

      const lines = [
        `Connected to: ${instanceUrl}`,
        `Target org:   ${getTargetOrgAlias()}`,
        ...(user.orgId ? [`Org ID:       ${user.orgId}`] : []),
        ``,
        `Name:       ${user.name}`,
        `Email:      ${user.email}`,
        `User ID:    ${user.userId}`,
        `Contact ID: ${user.contactId ?? "(none — this user has no linked Contact in this org)"}`,
      ];

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );
}
