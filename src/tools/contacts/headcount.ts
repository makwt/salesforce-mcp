import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { soqlQueryAll } from "../../lib/salesforce.js";

const GROUP_BY_OPTIONS = [
  "service_line",
  "reporting_company",
  "region",
  "country",
  "resource_role",
  "title",
] as const;
type GroupByOption = (typeof GROUP_BY_OPTIONS)[number];

interface HeadcountRecord {
  pse__Group__r: { Name: string } | null;
  pse__Practice__r: { Name: string } | null;
  pse__Region__r: { Name: string } | null;
  Country__c: string | null;
  pse__Resource_Role__c: string | null;
  Business_Title__c: string | null;
}

const HEADCOUNT_FIELDS = `
  pse__Group__r.Name,
  pse__Practice__r.Name,
  pse__Region__r.Name,
  Country__c,
  pse__Resource_Role__c,
  Business_Title__c
`.trim();

const GROUP_CONFIG: Record<
  GroupByOption,
  { label: string; extract: (r: HeadcountRecord) => string }
> = {
  service_line:      { label: "Service Line",      extract: r => r.pse__Group__r?.Name ?? "(none)" },
  reporting_company: { label: "Reporting Company",  extract: r => r.pse__Practice__r?.Name ?? "(none)" },
  region:            { label: "Region",             extract: r => r.pse__Region__r?.Name ?? "(none)" },
  country:           { label: "Country",            extract: r => r.Country__c ?? "(none)" },
  resource_role:     { label: "Resource Role",      extract: r => r.pse__Resource_Role__c ?? "(none)" },
  title:             { label: "Title",              extract: r => r.Business_Title__c ?? "(none)" },
};

export function registerHeadcountTool(server: McpServer) {
  server.tool(
    "get_headcount",
    "Returns a headcount breakdown of active PSA resources grouped by a chosen dimension: " +
      "service line, reporting company, region, country, resource role, or title. " +
      "Optionally filter to a subset of the org using any combination of the same dimensions. " +
      "Returns each group's count sorted by headcount descending, plus a grand total.",
    {
      group_by: z
        .enum(GROUP_BY_OPTIONS)
        .describe(
          "Dimension to group headcount by. Options: service_line, reporting_company, region, country, resource_role, title."
        ),
      service_line: z
        .string()
        .optional()
        .describe("Filter to a specific service line (partial match)"),
      reporting_company: z
        .string()
        .optional()
        .describe("Filter to a specific reporting company (partial match, e.g. 'Poatek', 'WillowTree')"),
      region: z
        .string()
        .optional()
        .describe("Filter to a specific region (partial match)"),
      resource_role: z
        .string()
        .optional()
        .describe("Filter to a specific resource role (partial match, e.g. 'Engineer', 'Designer')"),
      title: z
        .string()
        .optional()
        .describe("Filter by job title (partial match)"),
      active_only: z
        .boolean()
        .optional()
        .describe("When true (default), only counts active resources."),
    },
    async ({ group_by, service_line, reporting_company, region, resource_role, title, active_only }) => {
      const conditions: string[] = ["pse__Is_Resource__c = true"];
      if (active_only !== false) conditions.push("pse__Is_Resource_Active__c = true");
      if (service_line) conditions.push(`pse__Group__r.Name LIKE '%${service_line}%'`);
      if (reporting_company) conditions.push(`pse__Practice__r.Name LIKE '%${reporting_company}%'`);
      if (region) conditions.push(`pse__Region__r.Name LIKE '%${region}%'`);
      if (resource_role) conditions.push(`pse__Resource_Role__c LIKE '%${resource_role}%'`);
      if (title) conditions.push(`Business_Title__c LIKE '%${title}%'`);

      let records: HeadcountRecord[];
      try {
        records = await soqlQueryAll<HeadcountRecord>(`
          SELECT ${HEADCOUNT_FIELDS}
          FROM Contact
          WHERE ${conditions.join("\n            AND ")}
        `);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error querying headcount: ${message}` }],
          isError: true,
        };
      }

      const cfg = GROUP_CONFIG[group_by];
      const counts = new Map<string, number>();
      for (const r of records) {
        const key = cfg.extract(r);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }

      const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
      const maxLabelLen = Math.max(cfg.label.length, ...sorted.map(([k]) => k.length));

      const filterParts = [
        service_line && `service line: "${service_line}"`,
        reporting_company && `company: "${reporting_company}"`,
        region && `region: "${region}"`,
        resource_role && `role: "${resource_role}"`,
        title && `title: "${title}"`,
      ].filter(Boolean);

      const lines: string[] = [
        `Headcount by ${cfg.label}${filterParts.length ? ` — ${filterParts.join(", ")}` : ""}`,
        `Total: ${records.length} resource(s) across ${sorted.length} group(s)`,
        ``,
        `${cfg.label.padEnd(maxLabelLen)}  Count`,
        `${"─".repeat(maxLabelLen)}  ${"─".repeat(5)}`,
      ];

      for (const [key, count] of sorted) {
        lines.push(`${key.padEnd(maxLabelLen)}  ${String(count).padStart(5)}`);
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );
}
