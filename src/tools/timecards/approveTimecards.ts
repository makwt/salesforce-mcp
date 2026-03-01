import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { soqlQuery, sfPatch, getCurrentUser, getInstanceUrl } from "../../lib/salesforce.js";

interface PendingApprovalRecord {
  Id: string;
  Name: string;
  pse__Status__c: string;
  pse__Resource__r: { Name: string } | null;
  pse__Project__r: { Name: string } | null;
  pse__Start_Date__c: string | null;
  pse__End_Date__c: string | null;
  pse__Billable__c: boolean;
  Utilization_Category__c: string | null;
  Approval_Deadline__c: string | null;
}

async function fetchMyPendingApprovals(userId: string): Promise<PendingApprovalRecord[]> {
  return soqlQuery<PendingApprovalRecord>(`
    SELECT
      Id,
      Name,
      pse__Status__c,
      pse__Resource__r.Name,
      pse__Project__r.Name,
      pse__Start_Date__c,
      pse__End_Date__c,
      pse__Billable__c,
      Utilization_Category__c,
      Approval_Deadline__c
    FROM pse__Timecard_Header__c
    WHERE Actual_Approver__c = '${userId}'
      AND pse__Status__c = 'Submitted'
    ORDER BY pse__Project__r.Name, pse__Resource__r.Name, pse__Start_Date__c
  `);
}

export function registerApproveTimecardsTools(server: McpServer) {
  server.tool(
    "list_my_pending_approvals",
    "Lists all timecards currently in your approval queue — i.e. submitted timecards where you are the Actual Approver. " +
      "Returns the timecard ID, resource, project, week, billable status, and approval deadline. " +
      "Use this before calling approve_timecards to see what needs your attention.",
    {},
    async () => {
      let userId: string;
      try {
        const user = await getCurrentUser();
        userId = user.userId;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Failed to resolve current user: ${message}` }],
        };
      }

      let records: PendingApprovalRecord[];
      try {
        records = await fetchMyPendingApprovals(userId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Failed to query pending approvals: ${message}` }],
        };
      }

      if (records.length === 0) {
        return {
          content: [{ type: "text", text: "Your approval queue is empty — no submitted timecards awaiting your approval." }],
        };
      }

      const instanceUrl = await getInstanceUrl();
      const lines: string[] = [`Found ${records.length} timecard(s) pending your approval:\n`];

      for (const r of records) {
        const resource = r.pse__Resource__r?.Name ?? "—";
        const project = r.pse__Project__r?.Name ?? "—";
        const week = r.pse__Start_Date__c ?? "—";
        const billable = r.pse__Billable__c ? "Billable" : "Non-Billable";
        const util = r.Utilization_Category__c ?? "—";
        const deadline = r.Approval_Deadline__c ?? "—";
        const url = `${instanceUrl}/${r.Id}`;

        lines.push(
          `• ${r.Name}`,
          `  Resource:         ${resource}`,
          `  Project:          ${project}`,
          `  Week of:          ${week}`,
          `  Billable:         ${billable}`,
          `  Utilization:      ${util}`,
          `  Approval Deadline: ${deadline}`,
          `  URL: ${url}`,
          ``
        );
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );

  server.tool(
    "approve_timecards",
    "Approves one or more timecards from your approval queue. " +
      "Pass a list of timecard IDs (e.g. 'aBkTS000002PVU50AO') or use 'all' to approve everything currently in your queue. " +
      "Only timecards where YOU are the Actual Approver can be approved — any others are silently skipped with an explanation. " +
      "Each timecard is approved individually and results are reported per record.",
    {
      timecard_ids: z
        .union([z.array(z.string().min(1)), z.literal("all")])
        .describe(
          "List of Salesforce Timecard Header record IDs to approve, or the string \"all\" to approve your entire queue."
        ),
    },
    async ({ timecard_ids }) => {
      let userId: string;
      try {
        const user = await getCurrentUser();
        userId = user.userId;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Failed to resolve current user: ${message}` }],
        };
      }

      // Always re-fetch the queue as source of truth — never trust caller-supplied IDs alone
      let queue: PendingApprovalRecord[];
      try {
        queue = await fetchMyPendingApprovals(userId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Failed to fetch approval queue: ${message}` }],
        };
      }

      if (queue.length === 0) {
        return {
          content: [{ type: "text", text: "Your approval queue is empty — nothing to approve." }],
        };
      }

      const queueById = new Map(queue.map((r) => [r.Id, r]));

      // Determine which records to act on
      let targets: PendingApprovalRecord[];
      const unauthorized: string[] = [];

      if (timecard_ids === "all") {
        targets = queue;
      } else {
        targets = [];
        for (const id of timecard_ids) {
          const record = queueById.get(id);
          if (record) {
            targets.push(record);
          } else {
            unauthorized.push(id);
          }
        }
      }

      const results: string[] = [];

      if (unauthorized.length > 0) {
        results.push(
          `Skipped ${unauthorized.length} ID(s) not in your approval queue (not submitted or not assigned to you):`,
          ...unauthorized.map((id) => `  • ${id}`),
          ``
        );
      }

      if (targets.length === 0) {
        results.push("No valid timecards to approve.");
        return { content: [{ type: "text", text: results.join("\n") }] };
      }

      results.push(`Approving ${targets.length} timecard(s)...\n`);

      let successCount = 0;
      let failCount = 0;

      for (const record of targets) {
        const label = `${record.Name} (${record.pse__Resource__r?.Name ?? "?"} — ${record.pse__Project__r?.Name ?? "?"}, week of ${record.pse__Start_Date__c ?? "?"})`;
        try {
          await sfPatch("pse__Timecard_Header__c", record.Id, {
            pse__Status__c: "Approved",
          });
          results.push(`  ✓ Approved: ${label}`);
          successCount++;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          results.push(`  ✗ Failed:   ${label}`);
          results.push(`    Error: ${message}`);
          failCount++;
        }
      }

      results.push(``);
      results.push(`Done. ${successCount} approved, ${failCount} failed.`);

      return { content: [{ type: "text", text: results.join("\n") }] };
    }
  );
}
