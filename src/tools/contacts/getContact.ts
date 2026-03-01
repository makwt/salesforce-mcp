import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { soqlQuery, getInstanceUrl } from "../../lib/salesforce.js";

interface ContactRecord {
  Id: string;
  Name: string;
  Title: string | null;
  Email: string | null;
  Department: string | null;
  Division__c: string | null;
  pse__Resource_Role__c: string | null;
  Reporting_Company__c: string | null;
  Finance_Team__c: string | null;
  pse__Start_Date__c: string | null;
  pse__Is_Resource_Active__c: boolean;
  pse__Region__c: string | null;
}

function formatTenure(startDate: string): string {
  const start = new Date(startDate);
  const now = new Date();
  const totalMonths =
    (now.getFullYear() - start.getFullYear()) * 12 +
    (now.getMonth() - start.getMonth());
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  const parts: string[] = [];
  if (years > 0) parts.push(`${years} year${years !== 1 ? "s" : ""}`);
  if (months > 0) parts.push(`${months} month${months !== 1 ? "s" : ""}`);
  return parts.length > 0 ? parts.join(", ") : "less than a month";
}

export function registerGetContactTool(server: McpServer) {
  server.tool(
    "get_contact",
    "Look up a Salesforce Contact (resource/employee) by name and return their full profile: " +
      "title, department, division, resource role, reporting company, finance team, email, " +
      "start date, tenure, and active status. Use this when asked about a specific person — " +
      "'Who is X?', 'What is X's title?', 'How long has X been at WillowTree?'. " +
      "Accepts partial names. If multiple people match, all candidates are returned for disambiguation.",
    {
      name: z
        .string()
        .min(2)
        .describe(
          "Full or partial name of the person to look up (e.g. 'Adam Shea' or just 'Adam')"
        ),
    },
    async ({ name }) => {
      let contacts: ContactRecord[];
      try {
        contacts = await soqlQuery<ContactRecord>(`
          SELECT
            Id, Name, Title, Email, Department,
            Division__c, pse__Resource_Role__c,
            Reporting_Company__c, Finance_Team__c,
            pse__Start_Date__c, pse__Is_Resource_Active__c,
            pse__Region__c
          FROM Contact
          WHERE Name LIKE '%${name}%'
            AND pse__Is_Resource__c = true
          ORDER BY pse__Is_Resource_Active__c DESC, Name ASC
          LIMIT 10
        `);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error searching for contact: ${message}` }],
          isError: true,
        };
      }

      if (contacts.length === 0) {
        return {
          content: [{ type: "text", text: `No contact found matching "${name}".` }],
        };
      }

      const instanceUrl = await getInstanceUrl();

      if (contacts.length > 1) {
        const candidates = contacts
          .map(
            (c) =>
              `  • ${c.Name}${c.Title ? ` — ${c.Title}` : ""}${!c.pse__Is_Resource_Active__c ? " (inactive)" : ""}`
          )
          .join("\n");
        return {
          content: [
            {
              type: "text",
              text:
                `Found ${contacts.length} contacts matching "${name}". Please be more specific:\n\n` +
                candidates,
            },
          ],
        };
      }

      const c = contacts[0];
      const tenure = c.pse__Start_Date__c ? formatTenure(c.pse__Start_Date__c) : null;
      const startFormatted = c.pse__Start_Date__c
        ? new Date(c.pse__Start_Date__c).toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
          })
        : "—";

      const lines = [
        `${c.Name}`,
        ``,
        `  Status:           ${c.pse__Is_Resource_Active__c ? "Active" : "Inactive"}`,
        `  Title:            ${c.Title ?? "—"}`,
        `  Department:       ${c.Department ?? "—"}`,
        `  Division:         ${c.Division__c ?? "—"}`,
        `  Resource Role:    ${c.pse__Resource_Role__c ?? "—"}`,
        `  Reporting Company:${c.Reporting_Company__c ? " " + c.Reporting_Company__c : " —"}`,
        `  Finance Team:     ${c.Finance_Team__c ?? "—"}`,
        `  Email:            ${c.Email ?? "—"}`,
        `  Start Date:       ${startFormatted}`,
        tenure ? `  Tenure:           ${tenure}` : "",
        `  SF URL:           ${instanceUrl}/${c.Id}`,
      ].filter((l) => l !== "");

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );
}
