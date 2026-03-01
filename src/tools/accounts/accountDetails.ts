import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { soqlQueryAll, getInstanceUrl } from "../../lib/salesforce.js";

interface AccountRecord {
  Id: string;
  Name: string;
  Industry: string | null;
  Type: string | null;
  Owner: { Name: string } | null;
  Website: string | null;
  BillingCity: string | null;
  BillingCountry: string | null;
  Phone: string | null;
  Description: string | null;
}

interface RelatedOpportunity {
  Id: string;
  Name: string;
  StageName: string | null;
  Amount: number | null;
  CloseDate: string | null;
  Owner: { Name: string } | null;
}

interface RelatedProject {
  Id: string;
  Name: string;
  pse__Stage__c: string | null;
  pse__Start_Date__c: string | null;
  pse__End_Date__c: string | null;
  pse__Project_Manager__r: { Name: string } | null;
  Director__r: { Name: string } | null;
  pse__Bookings__c: number | null;
  Total_Estimated_Revenue__c: number | null;
  Project_Underrun__c: number | null;
}

const ACCOUNT_FIELDS =
  "Id, Name, Industry, Type, Owner.Name, Website, BillingCity, BillingCountry, Phone, Description";

const currency = (v: number | null) =>
  v != null
    ? `USD ${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : "—";

export function registerAccountDetailsTool(server: McpServer) {
  server.tool(
    "get_account_details",
    "Returns details for a Salesforce Account (client), including related active Opportunities and active Projects. " +
      "Use this to understand a client's history, active deals, and current engagements before meetings or proposals.",
    {
      account: z.string().describe("Account name (partial match)"),
    },
    async ({ account }) => {
      const escaped = account.replace(/'/g, "''");
      let accounts: AccountRecord[];
      try {
        accounts = await soqlQueryAll<AccountRecord>(`
          SELECT ${ACCOUNT_FIELDS}
          FROM Account
          WHERE Name LIKE '%${escaped}%'
          ORDER BY Name ASC
          LIMIT 10
        `);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error searching for account: ${message}` }],
          isError: true,
        };
      }

      if (accounts.length === 0) {
        return {
          content: [{ type: "text", text: `No account found matching "${account}".` }],
        };
      }

      if (accounts.length > 1) {
        const candidates = accounts.map((a) => `  • ${a.Name}`).join("\n");
        return {
          content: [
            {
              type: "text",
              text:
                `Found ${accounts.length} accounts matching "${account}". Please be more specific:\n\n` +
                candidates,
            },
          ],
        };
      }

      const acc = accounts[0];
      const instanceUrl = await getInstanceUrl();

      const [opportunities, projects] = await Promise.all([
        soqlQueryAll<RelatedOpportunity>(`
          SELECT Id, Name, StageName, Amount, CloseDate, Owner.Name
          FROM Opportunity
          WHERE AccountId = '${acc.Id}'
            AND StageName NOT IN ('Closed Won', 'Closed Lost', 'Closed', 'Closed Cancelled', 'Closed Canceled')
          ORDER BY CloseDate ASC
          LIMIT 20
        `).catch(() => [] as RelatedOpportunity[]),
        soqlQueryAll<RelatedProject>(`
          SELECT Id, Name, pse__Stage__c, pse__Start_Date__c, pse__End_Date__c,
            pse__Project_Manager__r.Name, Director__r.Name,
            pse__Bookings__c, Total_Estimated_Revenue__c, Project_Underrun__c
          FROM pse__Proj__c
          WHERE pse__Account__r.Name LIKE '%${acc.Name.replace(/'/g, "''")}%'
            AND pse__End_Date__c >= TODAY
            AND pse__Stage__c NOT IN ('Completed', 'Cancelled')
          ORDER BY pse__End_Date__c ASC
          LIMIT 20
        `).catch(() => [] as RelatedProject[]),
      ]);

      const location = [acc.BillingCity, acc.BillingCountry].filter(Boolean).join(", ") || "—";
      const lines: string[] = [
        `Account: ${acc.Name}`,
        `  Industry:   ${acc.Industry ?? "—"}`,
        `  Type:       ${acc.Type ?? "—"}`,
        `  Owner:      ${acc.Owner?.Name ?? "—"}`,
        `  Website:    ${acc.Website ?? "—"}`,
        `  Location:   ${location}`,
        `  Phone:      ${acc.Phone ?? "—"}`,
        `  URL: ${instanceUrl}/${acc.Id}`,
        ``,
      ];

      lines.push(`── Active Opportunities (${opportunities.length}) ──`, ``);
      for (const o of opportunities) {
        const amount = o.Amount != null ? `$${o.Amount.toLocaleString()}` : "—";
        lines.push(
          `  • ${o.Name}`,
          `    Stage: ${o.StageName ?? "—"} | Amount: ${amount} | Close Date: ${o.CloseDate ?? "—"}`,
          `    Owner: ${o.Owner?.Name ?? "—"}`,
          `    URL: ${instanceUrl}/${o.Id}`,
          ``
        );
      }

      lines.push(`── Active Projects (${projects.length}) ──`, ``);
      for (const p of projects) {
        const dates = `${p.pse__Start_Date__c ?? "—"} → ${p.pse__End_Date__c ?? "—"}`;
        lines.push(
          `  • ${p.Name}`,
          `    Stage: ${p.pse__Stage__c ?? "—"} | Dates: ${dates}`,
          `    PM: ${p.pse__Project_Manager__r?.Name ?? "—"} | Director: ${p.Director__r?.Name ?? "—"}`,
          `    Bookings: ${currency(p.pse__Bookings__c)} | Est Revenue: ${currency(p.Total_Estimated_Revenue__c)} | Underrun: ${currency(p.Project_Underrun__c)}`,
          `    URL: ${instanceUrl}/${p.Id}`,
          ``
        );
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );
}
