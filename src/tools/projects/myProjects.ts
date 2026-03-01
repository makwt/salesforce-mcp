import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { soqlQuery, getCurrentUser, getInstanceUrl } from "../../lib/salesforce.js";
import { ProjectRecord, PROJECT_FIELDS, formatProject } from "../../lib/projects.js";

export function registerMyProjectsTool(server: McpServer) {
  server.tool(
    "list_my_projects",
    "Lists active Salesforce projects (end date on or after today, stage not Completed or Cancelled) where the current authenticated user is the Project Manager or the Director. Returns project details including financials (bookings, revenue, margin, underrun, ECR), contract info, team (director, timecard approver, finance team), and org info (service line, region, line of business, reporting company).",
    {},
    async () => {
      let currentUser: Awaited<ReturnType<typeof getCurrentUser>>;
      try {
        currentUser = await getCurrentUser();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error resolving current user: ${message}` }],
          isError: true,
        };
      }

      let projects: ProjectRecord[];
      try {
        projects = await soqlQuery<ProjectRecord>(`
          SELECT ${PROJECT_FIELDS}
          FROM pse__Proj__c
          WHERE (
            pse__Project_Manager__c = '${currentUser.contactId}'
            OR Director__c = '${currentUser.userId}'
          )
            AND pse__End_Date__c >= TODAY
            AND pse__Stage__c NOT IN ('Completed', 'Cancelled')
          ORDER BY Name ASC
        `);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error querying projects: ${message}` }],
          isError: true,
        };
      }

      if (projects.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No active projects found where you are the Project Manager or Director.",
            },
          ],
        };
      }

      const instanceUrl = await getInstanceUrl();
      const lines: string[] = [
        `Found ${projects.length} active project(s) where you are Project Manager or Director:\n`,
      ];

      for (const p of projects) {
        const roles: string[] = [];
        if (p.pse__Project_Manager__c === currentUser.contactId) roles.push("Project Manager");
        if (p.Director__c === currentUser.userId) roles.push("Director");

        lines.push(
          ...formatProject(p, instanceUrl, [`  My Role: ${roles.join(" & ")}`])
        );
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );
}
