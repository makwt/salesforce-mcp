import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { soqlQuery, getInstanceUrl } from "../../lib/salesforce.js";

interface UserRecord {
  Id: string;
  Name: string;
  Title: string | null;
  Email: string | null;
  IsActive: boolean;
  Manager: { Name: string } | null;
}

interface ManagerRecord {
  Id: string;
  Name: string;
  Title: string | null;
}

interface ContactRecord {
  Id: string;
  Name: string;
  pse__Salesforce_User__c: string;
  Business_Title__c: string | null;
  pse__Resource_Role__c: string | null;
}

export function registerDirectReportsTool(server: McpServer) {
  server.tool(
    "list_direct_reports",
    "Lists all active Salesforce users who directly report to the specified person (based on the Manager field). " +
      "Provide a name or partial name — if multiple managers match, all candidates are listed for disambiguation. " +
      "Returns each direct report's name, title, and email.",
    {
      manager_name: z
        .string()
        .min(2)
        .describe("Name or partial name of the manager to look up (e.g. 'Kylie Whitman' or just 'Kylie')"),
    },
    async ({ manager_name }) => {
      // Step 1: find matching managers
      let managers: ManagerRecord[];
      try {
        managers = await soqlQuery<ManagerRecord>(`
          SELECT Id, Name, Title
          FROM User
          WHERE Name LIKE '%${manager_name}%'
            AND IsActive = true
          ORDER BY Name ASC
          LIMIT 10
        `);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error searching for manager: ${message}` }],
          isError: true,
        };
      }

      if (managers.length === 0) {
        return {
          content: [{ type: "text", text: `No active user found matching "${manager_name}".` }],
        };
      }

      // Step 2: if ambiguous, ask to clarify
      if (managers.length > 1) {
        const candidates = managers
          .map((m) => `  • ${m.Name}${m.Title ? ` — ${m.Title}` : ""}`)
          .join("\n");
        return {
          content: [
            {
              type: "text",
              text:
                `Found ${managers.length} users matching "${manager_name}". Please be more specific:\n\n` +
                candidates,
            },
          ],
        };
      }

      const manager = managers[0];

      // Step 3: fetch direct reports
      let reports: UserRecord[];
      try {
        reports = await soqlQuery<UserRecord>(`
          SELECT Id, Name, Title, Email, IsActive, Manager.Name
          FROM User
          WHERE ManagerId = '${manager.Id}'
            AND IsActive = true
          ORDER BY Name ASC
        `);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error fetching direct reports: ${message}` }],
          isError: true,
        };
      }

      const instanceUrl = await getInstanceUrl();

      if (reports.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `${manager.Name} has no active direct reports.`,
            },
          ],
        };
      }

      const userIds = reports.map((r) => `'${r.Id}'`).join(", ");
      let contacts: ContactRecord[] = [];
      try {
        contacts = await soqlQuery<ContactRecord>(`
          SELECT Id, Name, pse__Salesforce_User__c, Business_Title__c, pse__Resource_Role__c
          FROM Contact
          WHERE pse__Salesforce_User__c IN (${userIds})
            AND pse__Is_Resource__c = true
            AND pse__Is_Resource_Active__c = true
        `);
      } catch {
        // Contact lookup is best-effort; continue without it
      }

      const contactByUserId = new Map<string, ContactRecord>();
      for (const c of contacts) {
        contactByUserId.set(c.pse__Salesforce_User__c, c);
      }

      const lines: string[] = [
        `${manager.Name}${manager.Title ? ` (${manager.Title})` : ""} — ${reports.length} direct report(s):\n`,
      ];

      for (const r of reports) {
        const url = `${instanceUrl}/${r.Id}`;
        const contact = contactByUserId.get(r.Id);
        const title = contact?.Business_Title__c ?? r.Title ?? "—";
        lines.push(
          `• ${r.Name}`,
          `  Title:         ${title}`,
          `  Resource Role: ${contact?.pse__Resource_Role__c ?? "—"}`,
          `  Email:         ${r.Email ?? "—"}`,
          `  User URL:      ${url}`,
        );
        if (contact) {
          lines.push(
            `  Contact ID:  ${contact.Id}`,
            `  Contact URL: ${instanceUrl}/${contact.Id}`,
          );
        }
        lines.push(``);
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );
}
