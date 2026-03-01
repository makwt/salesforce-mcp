import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { soqlQueryAll, getInstanceUrl } from "../../lib/salesforce.js";

interface ContactRecord {
  Id: string;
  Name: string;
  Business_Title__c: string | null;
  pse__Resource_Role__c: string | null;
  pse__Group__r: { Name: string } | null;
  pse__Practice__r: { Name: string } | null;
  pse__Region__r: { Name: string } | null;
  pse__Is_Resource_Active__c: boolean;
  Email: string | null;
}

export function registerFindContactsTool(server: McpServer) {
  server.tool(
    "find_contacts",
    "Search and filter Salesforce Contacts (resources/employees) by any combination of filters: " +
      "email list, partial name, service line, title, resource role, reporting company, and region. " +
      "All filters are optional and combined with AND logic. " +
      "Use 'emails' to look up specific people by their exact email addresses. " +
      "Use 'title' to match the person's job title (e.g. 'Director', 'Senior Engineer'). " +
      "Use 'resource_role' to match the PSA resource role field (e.g. 'Partner', 'Design Director'). " +
      "Use this when you need a list of people matching certain criteria — e.g. 'Who are the Directors in the Southeast?', " +
      "'List all Product Designers in WillowTree', 'Find everyone in the Mobile service line'. " +
      "Returns up to 200 results with name, title, resource role, service line, reporting company, region, and active status.",
    {
      emails: z
        .array(z.string())
        .optional()
        .describe("List of exact email addresses to look up (e.g. ['alice@example.com', 'bob@example.com'])"),
      name: z
        .string()
        .optional()
        .describe("Partial name to search for (e.g. 'Adam' or 'Smith')"),
      service_line: z
        .union([z.string(), z.array(z.string())])
        .optional()
        .describe(
          "Filter by service line / cost center group. Accepts a single value or an array for OR logic " +
            "(e.g. 'Mobile' or ['Product Delivery', 'Design', 'Marketing Services'])"
        ),
      title: z
        .union([z.string(), z.array(z.string())])
        .optional()
        .describe(
          "Filter by job title (Business_Title__c). Accepts a single value or an array for OR logic " +
            "(e.g. 'Director' or ['Senior Director', 'VP']). Use this when the user refers to someone's title/seniority."
        ),
      resource_role: z
        .union([z.string(), z.array(z.string())])
        .optional()
        .describe(
          "Filter by PSA resource role (pse__Resource_Role__c). Accepts a single value or an array for OR logic " +
            "(e.g. 'Partner' or ['Design Director', 'Engineering Lead']). Use this for role-based staffing queries."
        ),
      reporting_company: z
        .string()
        .optional()
        .describe("Filter by reporting company (partial match, e.g. 'WillowTree', 'Poatek', 'GM2')"),
      region: z
        .string()
        .optional()
        .describe("Filter by region (partial match, e.g. 'Southeast', 'Northeast')"),
      active_only: z
        .boolean()
        .optional()
        .default(true)
        .describe("When true (default), only returns active resources. Set to false to include inactive contacts."),
    },
    async ({ emails, name, service_line, title, resource_role, reporting_company, region, active_only }) => {
      const conditions: string[] = ["pse__Is_Resource__c = true"];

      if (active_only) conditions.push("pse__Is_Resource_Active__c = true");
      if (emails && emails.length > 0) {
        const emailList = emails.map(e => `'${e.replace(/'/g, "\\'")}'`).join(", ");
        conditions.push(`Email IN (${emailList})`);
      }
      if (name) conditions.push(`Name LIKE '%${name}%'`);

      if (service_line) {
        const values = Array.isArray(service_line) ? service_line : [service_line];
        const clauses = values.map((v) => `pse__Group__r.Name LIKE '%${v}%'`).join(" OR ");
        conditions.push(values.length > 1 ? `(${clauses})` : clauses);
      }

      if (title) {
        const values = Array.isArray(title) ? title : [title];
        const clauses = values.map((v) => `Business_Title__c LIKE '%${v}%'`).join(" OR ");
        conditions.push(values.length > 1 ? `(${clauses})` : clauses);
      }

      if (resource_role) {
        const values = Array.isArray(resource_role) ? resource_role : [resource_role];
        const clauses = values.map((v) => `pse__Resource_Role__c LIKE '%${v}%'`).join(" OR ");
        conditions.push(values.length > 1 ? `(${clauses})` : clauses);
      }

      if (reporting_company) conditions.push(`pse__Practice__r.Name LIKE '%${reporting_company}%'`);
      if (region) conditions.push(`pse__Region__r.Name LIKE '%${region}%'`);

      if (conditions.length === 1) {
        return {
          content: [
            {
              type: "text",
              text: "Please provide at least one filter (emails, name, service_line, title, resource_role, reporting_company, or region) to search for contacts.",
            },
          ],
        };
      }

      let contacts: ContactRecord[];
      try {
        contacts = await soqlQueryAll<ContactRecord>(`
          SELECT
            Id, Name, Business_Title__c, pse__Resource_Role__c,
            pse__Group__r.Name, pse__Practice__r.Name,
            pse__Region__r.Name, pse__Is_Resource_Active__c, Email
          FROM Contact
          WHERE ${conditions.join("\n            AND ")}
          ORDER BY Name ASC
          LIMIT 200
        `);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error searching contacts: ${message}` }],
          isError: true,
        };
      }

      if (contacts.length === 0) {
        return {
          content: [{ type: "text", text: "No contacts found matching the given filters." }],
        };
      }

      const instanceUrl = await getInstanceUrl();
      const fmt = (v: string | string[]) =>
        Array.isArray(v) ? v.map((s) => `"${s}"`).join(" or ") : `"${v}"`;

      const filterSummary = [
        emails && emails.length > 0 && `emails: ${emails.length} address(es)`,
        name && `name: "${name}"`,
        service_line && `service line: ${fmt(service_line)}`,
        title && `title: ${fmt(title)}`,
        resource_role && `resource role: ${fmt(resource_role)}`,
        reporting_company && `company: "${reporting_company}"`,
        region && `region: "${region}"`,
        !active_only && "including inactive",
      ]
        .filter(Boolean)
        .join(", ");

      const lines: string[] = [
        `Found ${contacts.length} contact(s) — filters: ${filterSummary}\n`,
      ];

      for (const c of contacts) {
        lines.push(
          `• ${c.Name}${!c.pse__Is_Resource_Active__c ? " (inactive)" : ""}`,
          `  Title:          ${c.Business_Title__c ?? "—"}`,
          `  Resource Role:  ${c.pse__Resource_Role__c ?? "—"}`,
          `  Service Line:   ${c.pse__Group__r?.Name ?? "—"}`,
          `  Company:        ${c.pse__Practice__r?.Name ?? "—"}`,
          `  Region:         ${c.pse__Region__r?.Name ?? "—"}`,
          `  Email:          ${c.Email ?? "—"}`,
          `  URL:            ${instanceUrl}/${c.Id}`,
          ``
        );
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );
}
