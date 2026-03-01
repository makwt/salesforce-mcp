import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { soqlQuery, soqlQueryAll, getInstanceUrl } from "../../lib/salesforce.js";

interface ContactRecord {
  Id: string;
  Name: string;
  Business_Title__c: string | null;
  pse__Resource_Role__c: string | null;
  pse__Region__r: { Name: string } | null;
  pse__Practice__r: { Name: string } | null;
  pse__Group__r: { Name: string } | null;
  Country__c: string | null;
}

interface LastAssignmentRecord {
  pse__Resource__c: string;
  expr0: string | null;
}

interface NextAssignmentRecord {
  Id: string;
  pse__Resource__c: string;
  pse__Start_Date__c: string | null;
  pse__End_Date__c: string | null;
  pse__Percent_Allocated__c: number | null;
  pse__Project__r: { Name: string } | null;
}

const CONTACT_FIELDS = `
  Id,
  Name,
  Business_Title__c,
  pse__Resource_Role__c,
  pse__Region__r.Name,
  pse__Practice__r.Name,
  pse__Group__r.Name,
  Country__c
`.trim();

function cutoffDate(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

export function registerBenchResourcesTool(server: McpServer) {
  server.tool(
    "list_bench_resources",
    "Lists active Salesforce PSA resources who are on the bench (no current assignment) or rolling off soon. " +
      "By default scoped to WillowTree family companies (WillowTree, Poatek, GM2). Provide reporting_company to override and filter by a specific company. " +
      "When available_within_days is omitted, returns people with no active assignment as of today — fully on the bench. " +
      "When available_within_days is provided (e.g. 30), returns people whose last active assignment ends within that many days. " +
      "Use filters to narrow by service line, region, country, title, or resource_role. " +
      "IMPORTANT: discipline-specific roles like 'Android Engineer', 'iOS Engineer', 'Backend Engineer' are stored in the resource_role field, NOT the title. Use resource_role for those queries. " +
      "Returns per resource: name, title, resource role, reporting company, service line, region, country, current end date (rolling-off mode), next upcoming assignment (project, dates, allocation %), and a Salesforce URL. " +
      "Results are ordered by name.",
    {
      reporting_company: z
        .string()
        .optional()
        .describe("Filter by reporting company (partial match, e.g. 'WillowTree')"),
      service_line: z
        .string()
        .optional()
        .describe("Filter by service line / cost center group (partial match, e.g. 'Product Delivery')"),
      region: z
        .string()
        .optional()
        .describe("Filter by region (partial match)"),
      country: z
        .string()
        .optional()
        .describe("Filter by country (partial match, e.g. 'Brazil')"),
      title: z
        .string()
        .optional()
        .describe("Filter by job title / Business_Title__c (partial match, e.g. 'Senior Director', 'Manager'). Use resource_role instead for discipline-specific roles like 'Android Engineer'."),
      resource_role: z
        .string()
        .optional()
        .describe("Filter by PSA resource role / pse__Resource_Role__c (partial match, e.g. 'Android Engineer', 'iOS Engineer', 'Backend Engineer', 'Design Director'). This is the primary field for discipline-specific roles."),
      available_within_days: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          "When provided, returns resources whose last active assignment ends within this many days (rolling off). " +
            "When omitted, returns resources with no active assignments at all (bench)."
        ),
      manager_name: z
        .string()
        .optional()
        .describe("Filter to only show direct reports of this manager (name or partial name)"),
      skill: z
        .string()
        .optional()
        .describe(
          "Filter to only show bench resources who have a matching skill or certification (partial match on skill name). " +
            "Combine with resource_role to find e.g. 'Android Engineers with Flutter experience'."
        ),
    },
    async ({ reporting_company, service_line, region, country, title, resource_role, available_within_days, manager_name, skill }) => {
      let teamContactIds: string[] | null = null;
      if (manager_name) {
        try {
          const managers = await soqlQuery<{ Id: string; Name: string }>(`
            SELECT Id, Name FROM User
            WHERE Name LIKE '%${manager_name}%' AND IsActive = true
            ORDER BY Name ASC LIMIT 5
          `);
          if (managers.length === 0) {
            return {
              content: [{ type: "text", text: `No active user found matching "${manager_name}".` }],
            };
          }
          if (managers.length > 1) {
            const candidates = managers.map((m) => `  • ${m.Name}`).join("\n");
            return {
              content: [{
                type: "text",
                text: `Found ${managers.length} users matching "${manager_name}". Please be more specific:\n\n${candidates}`,
              }],
            };
          }
          const reportUserIds = await soqlQuery<{ Id: string }>(`
            SELECT Id FROM User WHERE ManagerId = '${managers[0].Id}' AND IsActive = true
          `);
          if (reportUserIds.length === 0) {
            return {
              content: [{ type: "text", text: `${managers[0].Name} has no active direct reports.` }],
            };
          }
          const userIdList = reportUserIds.map((u) => `'${u.Id}'`).join(", ");
          const contacts = await soqlQuery<{ Id: string }>(`
            SELECT Id FROM Contact
            WHERE pse__Salesforce_User__c IN (${userIdList}) AND pse__Is_Resource__c = true
          `);
          teamContactIds = contacts.map((c) => c.Id);
          if (teamContactIds.length === 0) {
            return {
              content: [{ type: "text", text: `No PSA resources found for ${managers[0].Name}'s direct reports.` }],
            };
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text", text: `Error resolving manager team: ${message}` }],
            isError: true,
          };
        }
      }

      const baseConditions: string[] = [
        `pse__Is_Resource__c = true`,
        `pse__Is_Resource_Active__c = true`,
        `pse__Exclude_From_Time_Calculations__c = false`,
      ];

      if (teamContactIds) {
        baseConditions.push(`Id IN (${teamContactIds.map((id) => `'${id}'`).join(", ")})`);
      }

      if (reporting_company) {
        baseConditions.push(`pse__Practice__r.Name LIKE '%${reporting_company}%'`);
      } else {
        baseConditions.push(
          `(pse__Practice__r.Name IN ('WillowTree', 'Poatek') OR pse__Practice__r.Parent_TDS_Company_Name__c = 'WillowTree' OR pse__Practice__r.Merger_Acquisition_Group__r.Name = 'GM2')`
        );
      }

      if (service_line) baseConditions.push(`pse__Group__r.Name LIKE '%${service_line}%'`);
      if (region) baseConditions.push(`pse__Region__r.Name LIKE '%${region}%'`);
      if (country) baseConditions.push(`Country__c LIKE '%${country}%'`);
      if (title) baseConditions.push(`Business_Title__c LIKE '%${title}%'`);
      if (resource_role) baseConditions.push(`pse__Resource_Role__c LIKE '%${resource_role}%'`);

      const activeAssignmentSubquery = `
        SELECT pse__Resource__c FROM pse__Assignment__c
        WHERE pse__End_Date__c >= TODAY
          AND pse__Status__c IN ('Tentative', 'Scheduled')
          AND pse__Exclude_From_Utilization__c = false
      `.trim();

      let modeLabel: string;
      let conditions: string[];

      if (available_within_days == null) {
        modeLabel = "People currently on the bench (no active assignment)";
        conditions = [
          ...baseConditions,
          `Id NOT IN (${activeAssignmentSubquery})`,
        ];
      } else {
        const cutoff = cutoffDate(available_within_days);
        modeLabel = `People rolling off within ${available_within_days} day(s) (last assignment ends by ${cutoff})`;
        const futureAssignmentSubquery = `
          SELECT pse__Resource__c FROM pse__Assignment__c
          WHERE pse__End_Date__c > '${cutoff}'
            AND pse__Status__c IN ('Tentative', 'Scheduled')
            AND pse__Exclude_From_Utilization__c = false
        `.trim();
        conditions = [
          ...baseConditions,
          `Id IN (${activeAssignmentSubquery})`,
          `Id NOT IN (${futureAssignmentSubquery})`,
        ];
      }

      let contacts: ContactRecord[];
      try {
        contacts = await soqlQueryAll<ContactRecord>(`
          SELECT ${CONTACT_FIELDS}
          FROM Contact
          WHERE ${conditions.join("\n            AND ")}
          ORDER BY Name ASC
        `);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error querying bench resources: ${message}` }],
          isError: true,
        };
      }

      if (contacts.length === 0) {
        return {
          content: [{ type: "text", text: `No resources found. (${modeLabel})` }],
        };
      }

      // Apply skill filter: intersect bench contacts with those who have the skill
      if (skill) {
        try {
          const ids = contacts.map((c) => `'${c.Id}'`).join(", ");
          const skillMatches = await soqlQueryAll<{ pse__Resource__c: string }>(`
            SELECT pse__Resource__c
            FROM pse__Skill_Certification_Rating__c
            WHERE pse__Resource__c IN (${ids})
              AND Skill_or_Certification_Name__c LIKE '%${skill}%'
              AND Is_Resource_Active__c = true
          `);
          const matchSet = new Set(skillMatches.map((r) => r.pse__Resource__c));
          contacts = contacts.filter((c) => matchSet.has(c.Id));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text", text: `Error filtering by skill: ${message}` }],
            isError: true,
          };
        }

        if (contacts.length === 0) {
          return {
            content: [{ type: "text", text: `No resources found matching the skill "${skill}". (${modeLabel})` }],
          };
        }
      }

      const ids = contacts.map((c) => `'${c.Id}'`).join(", ");

      // For rolling-off mode, fetch each resource's last assignment end date
      const lastEndDateByContactId = new Map<string, string>();
      if (available_within_days != null) {
        try {
          const lastAssignments = await soqlQueryAll<LastAssignmentRecord>(`
            SELECT pse__Resource__c, MAX(pse__End_Date__c) expr0
            FROM pse__Assignment__c
            WHERE pse__Resource__c IN (${ids})
              AND pse__Status__c IN ('Tentative', 'Scheduled')
            GROUP BY pse__Resource__c
          `);
          for (const row of lastAssignments) {
            if (row.pse__Resource__c && row.expr0) {
              lastEndDateByContactId.set(row.pse__Resource__c, row.expr0);
            }
          }
        } catch {
          // Non-fatal: continue without end dates
        }
      }

      // Always fetch the next upcoming assignment for each person
      const nextAssignmentByContactId = new Map<string, NextAssignmentRecord>();
      try {
        const upcoming = await soqlQueryAll<NextAssignmentRecord>(`
          SELECT Id, pse__Resource__c, pse__Start_Date__c, pse__End_Date__c,
                 pse__Percent_Allocated__c, pse__Project__r.Name
          FROM pse__Assignment__c
          WHERE pse__Resource__c IN (${ids})
            AND pse__Start_Date__c > TODAY
            AND pse__Status__c IN ('Tentative', 'Scheduled')
            AND pse__Exclude_From_Utilization__c = false
          ORDER BY pse__Start_Date__c ASC
        `);
        // Keep only the earliest assignment per contact
        for (const row of upcoming) {
          if (!nextAssignmentByContactId.has(row.pse__Resource__c)) {
            nextAssignmentByContactId.set(row.pse__Resource__c, row);
          }
        }
      } catch {
        // Non-fatal: continue without next assignment info
      }

      const instanceUrl = await getInstanceUrl();
      const lines: string[] = [`${modeLabel}\nFound ${contacts.length} resource(s):\n`];

      for (const c of contacts) {
        const url = `${instanceUrl}/${c.Id}`;
        const lastEnd = lastEndDateByContactId.get(c.Id);
        const next = nextAssignmentByContactId.get(c.Id);
        const nextLine = next
          ? `${next.pse__Start_Date__c} → ${next.pse__End_Date__c} on ${next.pse__Project__r?.Name ?? "—"} (${next.pse__Percent_Allocated__c ?? "—"}%)`
          : "None scheduled";

        lines.push(
          `• ${c.Name} — ${c.Business_Title__c ?? "—"}`,
          `  Resource Role:      ${c.pse__Resource_Role__c ?? "—"}`,
          `  Reporting Company:  ${c.pse__Practice__r?.Name ?? "—"}`,
          `  Service Line:       ${c.pse__Group__r?.Name ?? "—"}`,
          `  Region:             ${c.pse__Region__r?.Name ?? "—"}`,
          `  Country:            ${c.Country__c ?? "—"}`,
          ...(lastEnd ? [`  Current End Date:   ${lastEnd}`] : []),
          `  Next Assignment:    ${nextLine}`,
          `  URL: ${url}`,
          ``
        );
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );
}
