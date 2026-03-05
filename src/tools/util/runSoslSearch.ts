import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sfGet, SF_API_VERSION } from "../../lib/salesforce.js";

export function registerRunSoslSearchTool(server: McpServer) {
  server.tool(
    "run_sosl_search",
    "Executes a raw SOSL (Salesforce Object Search Language) search and returns matching records as JSON. " +
      "SOSL is a full-text cross-object search — use it when you want to find a term across multiple object types at once (e.g. find 'Acme' in Accounts, Contacts, and Projects simultaneously). " +
      "Example: FIND {Acme} IN ALL FIELDS RETURNING Account(Id, Name), Contact(Id, Name, Email). " +
      "The caller is responsible for writing valid SOSL. Results are returned as a JSON array of search records.",
    {
      search: z
        .string()
        .describe(
          "A valid SOSL search string (e.g. \"FIND {John Smith} IN ALL FIELDS RETURNING Contact(Id, Name, Email), Account(Id, Name)\")"
        ),
    },
    async ({ search }) => {
      try {
        const result = await sfGet<{ searchRecords: unknown[] }>(
          `/services/data/${SF_API_VERSION}/search?q=${encodeURIComponent(search)}`
        );
        const records = result.searchRecords ?? [];
        return {
          content: [{
            type: "text",
            text: records.length === 0
              ? "Search returned 0 records."
              : JSON.stringify(records, null, 2),
          }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `SOSL search error: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
