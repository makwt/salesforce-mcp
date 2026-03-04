import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sfGet, SF_API_VERSION } from "../../lib/salesforce.js";

interface SalesforceField {
  name: string;
  label: string;
  type: string;
  length?: number;
  picklistValues?: { value: string; label: string; active: boolean }[];
  referenceTo?: string[];
  relationshipName?: string | null;
  nillable: boolean;
  updateable: boolean;
  custom: boolean;
}

interface DescribeResult {
  name: string;
  label: string;
  fields: SalesforceField[];
}

export function registerGetObjectFieldsTool(server: McpServer) {
  server.tool(
    "get_object_fields",
    "Retrieves all field names, labels, and types for a given Salesforce object (SObject). " +
      "Use this to explore the schema of any standard or custom object — especially useful before writing ad-hoc SOQL queries or when you need to find the correct API name of a custom field. " +
      "Returns each field's API name, label, data type, whether it's custom, nillable, and updateable. " +
      "For picklist fields, also returns the available picklist values. " +
      "For relationship fields, returns the related object type(s) and relationship name.",
    {
      object_name: z
        .string()
        .describe(
          "The API name of the Salesforce object (e.g. 'Account', 'Contact', 'pse__Proj__c', 'pse__Assignment__c')"
        ),
      custom_only: z
        .boolean()
        .optional()
        .describe("When true, returns only custom fields (__c suffix). Default false (returns all fields)."),
    },
    async ({ object_name, custom_only }) => {
      try {
        const result = await sfGet<DescribeResult>(
          `/services/data/${SF_API_VERSION}/sobjects/${object_name}/describe`
        );

        let fields = result.fields;
        if (custom_only) {
          fields = fields.filter((f) => f.custom);
        }

        const lines: string[] = [
          `Object: ${result.label} (${result.name})`,
          `Fields: ${fields.length}${custom_only ? " (custom only)" : ""}`,
          "",
        ];

        for (const f of fields) {
          const parts = [`• ${f.name}`];
          if (f.label !== f.name) parts.push(`(${f.label})`);
          parts.push(`— ${f.type}`);
          if (f.custom) parts.push("[custom]");
          if (!f.nillable) parts.push("[required]");
          if (!f.updateable) parts.push("[read-only]");
          if (f.referenceTo && f.referenceTo.length > 0) {
            parts.push(`→ ${f.referenceTo.join(", ")}${f.relationshipName ? ` (${f.relationshipName})` : ""}`);
          }
          lines.push(parts.join(" "));

          if (f.type === "picklist" || f.type === "multipicklist") {
            const active = (f.picklistValues ?? []).filter((p) => p.active);
            if (active.length > 0) {
              lines.push(`  Values: ${active.map((p) => p.value).join(" | ")}`);
            }
          }
        }

        return {
          content: [{ type: "text", text: lines.join("\n") }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error describing object '${object_name}': ${message}` }],
          isError: true,
        };
      }
    }
  );
}
