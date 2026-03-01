import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { soqlQueryAll } from "../../lib/salesforce.js";

const EXCLUDED_PROJECT_NAMES = [
  "interns 2024",
  "techops",
  "WillowTree - Internal - Non-Exempt Staff",
  "New Hire - Project Shadowing",
  "transactel - time off",
  "WillowTree - DART",
];

interface MissingApprovalRecord {
  Id: string;
  Name: string;
  pse__Resource__r: { Name: string } | null;
  pse__Start_Date__c: string | null;
  pse__Billable__c: boolean;
  Utilization_Category__c: string | null;
  Actual_Approver__r: { Name: string } | null;
  pse__Project__r: {
    Name: string;
    pse__Project_Manager__r: { Name: string } | null;
    Director__r: { Name: string } | null;
    pse__Group__r: { Name: string } | null;
    Secondary_Approver__r: { Name: string } | null;
  } | null;
}

export function registerAllMissingApprovalsTools(server: McpServer) {
  server.tool(
    "list_all_missing_approvals",
    "Lists ALL submitted timecards pending approval across all WillowTree client projects for the current month, regardless of who the approver is. " +
      "Results are grouped by Director > Actual Approver > Project. " +
      "Returns per entry: resource name, week, billable flag, utilization category, and timecard ID. " +
      "This is an org-wide view. For a view scoped only to your projects, use list_my_missing_approvals instead.",
    {},
    async () => {
      let records: MissingApprovalRecord[];
      try {
        records = await soqlQueryAll<MissingApprovalRecord>(`
          SELECT
            Id,
            Name,
            pse__Resource__r.Name,
            pse__Start_Date__c,
            pse__Billable__c,
            Utilization_Category__c,
            Actual_Approver__r.Name,
            pse__Project__r.Name,
            pse__Project__r.pse__Project_Manager__r.Name,
            pse__Project__r.Director__r.Name,
            pse__Project__r.pse__Group__r.Name,
            pse__Project__r.Secondary_Approver__r.Name
          FROM pse__Timecard_Header__c
          WHERE pse__Status__c = 'Submitted'
            AND Utilization_Category__c != 'internal need'
            AND pse__Start_Date__c = THIS_MONTH
            AND pse__Project__r.pse__Project_Type__c = 'Client'
            AND pse__Project__r.pse__Practice__r.Name = 'WillowTree'
          ORDER BY pse__Project__r.Director__r.Name,
                   Actual_Approver__r.Name,
                   pse__Project__r.Name,
                   pse__Resource__r.Name
        `);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error querying missing approvals: ${message}` }],
          isError: true,
        };
      }

      // Filter excluded project names in code
      records = records.filter((r) => {
        const projName = r.pse__Project__r?.Name ?? "";
        return !EXCLUDED_PROJECT_NAMES.some((ex) =>
          projName.toLowerCase().includes(ex.toLowerCase())
        );
      });

      if (records.length === 0) {
        return {
          content: [{ type: "text", text: "No pending timecard approvals found across all client projects this month." }],
        };
      }

      // Group: Director → Approver → Project → timecards
      const byDirector = new Map<string, Map<string, Map<string, MissingApprovalRecord[]>>>();

      for (const r of records) {
        const director = r.pse__Project__r?.Director__r?.Name ?? "(No Director)";
        const approver = r.Actual_Approver__r?.Name ?? "(No Approver)";
        const project = r.pse__Project__r?.Name ?? "(Unknown Project)";

        if (!byDirector.has(director)) byDirector.set(director, new Map());
        const byApprover = byDirector.get(director)!;
        if (!byApprover.has(approver)) byApprover.set(approver, new Map());
        const byProject = byApprover.get(approver)!;
        if (!byProject.has(project)) byProject.set(project, []);
        byProject.get(project)!.push(r);
      }

      const lines: string[] = [
        `Found ${records.length} pending timecard approval(s) across ${byDirector.size} director(s) this month:\n`,
      ];

      for (const [director, byApprover] of byDirector) {
        const directorTotal = [...byApprover.values()].reduce(
          (sum, approver) => sum + [...approver.values()].reduce((s, rows) => s + rows.length, 0),
          0
        );
        lines.push(`\n▸ Director: ${director} (${directorTotal} pending)`);

        for (const [approver, byProject] of byApprover) {
          const approverTotal = [...byProject.values()].reduce((s, rows) => s + rows.length, 0);
          lines.push(`  ▸ Approver: ${approver} (${approverTotal} pending)`);

          for (const [project, rows] of byProject) {
            const pm = rows[0].pse__Project__r?.pse__Project_Manager__r?.Name ?? "—";
            const serviceLine = rows[0].pse__Project__r?.pse__Group__r?.Name ?? "—";
            lines.push(`    ── ${project} [${serviceLine}] | PM: ${pm}`);
            for (const row of rows) {
              const resource = row.pse__Resource__r?.Name ?? "—";
              const week = row.pse__Start_Date__c ?? "—";
              const billable = row.pse__Billable__c ? "Billable" : "Non-Billable";
              const util = row.Utilization_Category__c ?? "—";
              const tcId = row.Name ?? "—";
              lines.push(`       • ${resource} | Week of ${week} | ${billable} | ${util} | ${tcId}`);
            }
          }
        }
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );
}
