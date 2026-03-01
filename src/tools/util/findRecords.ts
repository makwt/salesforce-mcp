import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sfGet, getInstanceUrl, SF_API_VERSION } from "../../lib/salesforce.js";

const SUPPORTED_OBJECTS = [
  "pse__Proj__c",
  "Account",
  "Contact",
  "Opportunity",
  "pse__Resource_Request__c",
] as const;

type SupportedObject = (typeof SUPPORTED_OBJECTS)[number];

const OBJECT_LABELS: Record<SupportedObject, string> = {
  "pse__Proj__c": "Project",
  "Account": "Account",
  "Contact": "Contact (Resource)",
  "Opportunity": "Opportunity",
  "pse__Resource_Request__c": "Resource Request",
};

interface SoslResult {
  searchRecords: Array<{
    Id: string;
    Name: string;
    attributes: { type: string; url: string };
    [key: string]: unknown;
  }>;
}

export function registerFindRecordsTool(server: McpServer) {
  server.tool(
    "search_records_by_name",
    "Full-text search across Salesforce objects by name or keyword using SOSL. " +
      "Use this when you know part of a name but not the exact match — e.g. a client name, person name, project name, or opportunity name. " +
      "Returns the record name, type, Salesforce ID, and URL so you can pass the name or ID to more specific tools. " +
      "Searchable object types: Project (pse__Proj__c), Account, Contact/Resource, Opportunity, Resource Request. " +
      "Omit object_types to search across all supported types at once.",
    {
      query: z
        .string()
        .describe("The search term to look for (e.g. a client name, person name, or project keyword)"),
      object_types: z
        .array(z.enum(SUPPORTED_OBJECTS))
        .optional()
        .describe(
          "Limit search to specific object types. Options: pse__Proj__c, Account, Contact, Opportunity, pse__Resource_Request__c. " +
            "Omit to search all."
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("Max results per object type (default: 10)"),
    },
    async ({ query, object_types, limit = 10 }) => {
      const targets = (object_types ?? [...SUPPORTED_OBJECTS]) as SupportedObject[];

      const returningClauses = targets
        .map((obj) => `${obj}(Id, Name LIMIT ${limit})`)
        .join(", ");

      const sosl = `FIND {${query.replace(/[?&|!{}[\]()^~*:\\"'+-]/g, "\\$&")}} IN NAME FIELDS RETURNING ${returningClauses}`;
      const encoded = encodeURIComponent(sosl);

      let result: SoslResult;
      try {
        result = await sfGet<SoslResult>(`/services/data/${SF_API_VERSION}/search?q=${encoded}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error running search: ${message}` }],
          isError: true,
        };
      }

      if (result.searchRecords.length === 0) {
        return {
          content: [{ type: "text", text: `No records found matching "${query}".` }],
        };
      }

      const instanceUrl = await getInstanceUrl();

      // Group by object type
      const byType = new Map<string, typeof result.searchRecords>();
      for (const r of result.searchRecords) {
        const type = r.attributes.type;
        if (!byType.has(type)) byType.set(type, []);
        byType.get(type)!.push(r);
      }

      const lines: string[] = [`Found ${result.searchRecords.length} record(s) matching "${query}":\n`];

      for (const [type, records] of byType) {
        const label = OBJECT_LABELS[type as SupportedObject] ?? type;
        lines.push(`── ${label} (${records.length}) ──`);
        for (const r of records) {
          lines.push(`  • ${r.Name}`, `    ID: ${r.Id}  |  URL: ${instanceUrl}/${r.Id}`);
        }
        lines.push(``);
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );
}
