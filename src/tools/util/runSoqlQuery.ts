import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { soqlQueryAll } from "../../lib/salesforce.js";

export function registerRunSoqlQueryTool(server: McpServer) {
  server.tool(
    "run_soql_query",
    "Executes a raw SOQL query against Salesforce and returns the results as JSON. " +
      "IMPORTANT: only use this as a last resort when no structured tool can answer the question. " +
      "Prefer purpose-built tools like find_contacts, get_headcount, get_revenue_by_client, list_allocations, etc. " +
      "Exception: it is fine to use this tool when a single SOQL query can replace what would otherwise require two or more calls to other tools. " +
      "This tool exists for ad-hoc or exploratory queries that fall outside the scope of existing tools. " +
      "The caller is responsible for writing valid SOQL — no validation is performed beyond what Salesforce enforces. " +
      "Results are returned as a JSON array of records.",
    {
      query: z
        .string()
        .describe("A valid SOQL query (e.g. \"SELECT Id, Name FROM Account WHERE Name LIKE '%Acme%' LIMIT 10\")"),
    },
    async ({ query }) => {
      try {
        const records = await soqlQueryAll<Record<string, unknown>>(query);
        return {
          content: [{
            type: "text",
            text: records.length === 0
              ? "Query returned 0 records."
              : JSON.stringify(records, null, 2),
          }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `SOQL query error: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
