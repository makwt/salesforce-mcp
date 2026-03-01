import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { soqlQueryAll } from "../../lib/salesforce.js";

const EXCLUDED_PROJECT_NAMES = [
  "techops",
  "Test Project - SOX",
  "WillowTree->TelusDigital.com Site Merge",
  "TELUS Digital - 2025 Commercial Support",
  "WillowTree - DART",
];

interface MissingTimecardRecord {
  Id: string;
  pse__Resource__r: { Name: string } | null;
  pse__Estimated_Hours__c: number | null;
  pse__Start_Date__c: string | null;
  pse__End_Date__c: string | null;
  Billable__c: boolean;
  Utilization_Category__c: string | null;
  Reviewed__c: boolean;
  Reviewer_Comments__c: string | null;
  pse__Project__r: {
    Name: string;
    pse__Project_Manager__r: { Name: string } | null;
    Director__r: { Name: string } | null;
    pse__Group__r: { Name: string } | null;
    Secondary_Approver__r: { Name: string } | null;
  } | null;
}

export function registerAllMissingTimecardsTools(server: McpServer) {
  server.tool(
    "list_all_missing_timecards",
    "Lists ALL assignments with missing timecards across all WillowTree client projects for the current month, regardless of who the Project Manager or Director is. " +
      "A missing timecard means the resource has estimated hours but has not submitted a timecard and the variance has not been accepted. " +
      "Results are grouped by Director > Project Manager > Project. " +
      "Returns per entry: resource name, dates, estimated hours, billable flag, utilization category, and reviewer comments. " +
      "This is an org-wide view. For a view scoped only to your projects, use list_my_missing_timecards instead.",
    {},
    async () => {
      let records: MissingTimecardRecord[];
      try {
        records = await soqlQueryAll<MissingTimecardRecord>(`
          SELECT
            Id,
            pse__Resource__r.Name,
            pse__Estimated_Hours__c,
            pse__Start_Date__c,
            pse__End_Date__c,
            Billable__c,
            Utilization_Category__c,
            Reviewed__c,
            Reviewer_Comments__c,
            pse__Project__r.Name,
            pse__Project__r.pse__Project_Manager__r.Name,
            pse__Project__r.Director__r.Name,
            pse__Project__r.pse__Group__r.Name,
            pse__Project__r.Secondary_Approver__r.Name
          FROM pse__Est_Vs_Actuals__c
          WHERE pse__Time_Period_Type__c = 'SplitWeek'
            AND pse__Timecards_Submitted__c = false
            AND pse__Actual_Hours__c = 0
            AND pse__Estimated_Hours__c != 0
            AND Reviewed__c = false
            AND Utilization_Category__c NOT IN ('other', 'excluded hours', 'internal need')
            AND pse__Start_Date__c = THIS_MONTH
            AND pse__Project__r.pse__Project_Type__c = 'Client'
            AND pse__Project__r.pse__Practice__r.Name = 'WillowTree'
            AND pse__Assignment__c NOT IN (
              SELECT pse__Assignment__c FROM pse__Timecard__c
              WHERE pse__Timecard_Header__r.pse__Status__c IN ('Submitted', 'Approved')
                AND pse__Timecard_Header__r.pse__Start_Date__c = THIS_MONTH
            )
          ORDER BY pse__Project__r.Director__r.Name,
                   pse__Project__r.pse__Project_Manager__r.Name,
                   pse__Project__r.Name,
                   pse__Resource__r.Name
        `);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error querying missing timecards: ${message}` }],
          isError: true,
        };
      }

      // Filter excluded project names in code (cross-object LIKE not supported in SOQL)
      records = records.filter((r) => {
        const projName = r.pse__Project__r?.Name ?? "";
        return !EXCLUDED_PROJECT_NAMES.some((ex) =>
          projName.toLowerCase().includes(ex.toLowerCase())
        );
      });

      if (records.length === 0) {
        return {
          content: [{ type: "text", text: "No missing timecards found across all client projects this month." }],
        };
      }

      // Group: Director → PM → Project → resources
      const byDirector = new Map<string, Map<string, Map<string, MissingTimecardRecord[]>>>();

      for (const r of records) {
        const director = r.pse__Project__r?.Director__r?.Name ?? "(No Director)";
        const pm = r.pse__Project__r?.pse__Project_Manager__r?.Name ?? "(No PM)";
        const project = r.pse__Project__r?.Name ?? "(Unknown Project)";

        if (!byDirector.has(director)) byDirector.set(director, new Map());
        const byPM = byDirector.get(director)!;
        if (!byPM.has(pm)) byPM.set(pm, new Map());
        const byProject = byPM.get(pm)!;
        if (!byProject.has(project)) byProject.set(project, []);
        byProject.get(project)!.push(r);
      }

      const lines: string[] = [
        `Found ${records.length} missing timecard assignment(s) across ${byDirector.size} director(s) this month:\n`,
      ];

      for (const [director, byPM] of byDirector) {
        const directorTotal = [...byPM.values()].reduce(
          (sum, pm) => sum + [...pm.values()].reduce((s, rows) => s + rows.length, 0),
          0
        );
        lines.push(`\n▸ Director: ${director} (${directorTotal} missing)`);

        for (const [pm, byProject] of byPM) {
          const pmTotal = [...byProject.values()].reduce((s, rows) => s + rows.length, 0);
          lines.push(`  ▸ PM: ${pm} (${pmTotal} missing)`);

          for (const [project, rows] of byProject) {
            const serviceLine = rows[0].pse__Project__r?.pse__Group__r?.Name ?? "—";
            lines.push(`    ── ${project} [${serviceLine}]`);
            for (const row of rows) {
              const resource = row.pse__Resource__r?.Name ?? "—";
              const start = row.pse__Start_Date__c ?? "—";
              const end = row.pse__End_Date__c ?? "—";
              const hrs = row.pse__Estimated_Hours__c ?? "—";
              const billable = row.Billable__c ? "Billable" : "Non-Billable";
              const util = row.Utilization_Category__c ?? "—";
              lines.push(`       • ${resource} | ${start} → ${end} | ${hrs} hrs | ${billable} | ${util}`);
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
