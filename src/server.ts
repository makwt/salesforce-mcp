import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// accounts
import { registerAccountDetailsTool } from "./tools/accounts/accountDetails.js";

// assignments
import { registerAllocationsTool } from "./tools/assignments/allocations.js";

// contacts
import { registerBenchResourcesTool } from "./tools/contacts/benchResources.js";
import { registerDirectReportsTool } from "./tools/contacts/directReports.js";
import { registerFindContactsTool } from "./tools/contacts/findContacts.js";
import { registerGetContactTool } from "./tools/contacts/getContact.js";
import { registerHeadcountTool } from "./tools/contacts/headcount.js";
import { registerWhoAmITool } from "./tools/contacts/whoami.js";

// delivery
import { registerMyDeliveryMetricsTool } from "./tools/delivery/myDeliveryMetrics.js";
import { registerMyTeamDeliveryMetricsTool } from "./tools/delivery/myTeamDeliveryMetrics.js";

// opportunities
import { registerOpportunitiesTool } from "./tools/opportunities/opportunities.js";

// projects
import { registerAllProjectsTool } from "./tools/projects/allProjects.js";
import { registerClientProjectHistoryTool } from "./tools/projects/clientProjectHistory.js";
import { registerFindProjectTool } from "./tools/projects/findProject.js";
import { registerMilestonesTool } from "./tools/projects/milestones.js";
import { registerMyProjectsTool } from "./tools/projects/myProjects.js";
import { registerPortfolioSummaryTool } from "./tools/projects/portfolioSummary.js";

// resource-requests
import { registerResourceRequestsTool } from "./tools/resource-requests/resourceRequests.js";

// revenue
import { registerBillingEventsTool } from "./tools/revenue/billingEvents.js";
import { registerComparePeriodsTool } from "./tools/revenue/comparePeriods.js";
import { registerEstVsActualsTool } from "./tools/revenue/estVsActuals.js";
import { registerRevenueByClientTool } from "./tools/revenue/revenueByClient.js";
import { registerRevenueForecastTool } from "./tools/revenue/revenueForecast.js";
import { registerVarianceBreakdownTool } from "./tools/revenue/varianceBreakdown.js";

// skills
import { registerSkillsTool, registerUpsertSkillTool, registerResourceSkillsTool } from "./tools/skills/skills.js";

// time-off
import { registerTimeOffsTool } from "./tools/time-off/timeOffs.js";

// timecards
import { registerMissingTimecardsTools } from "./tools/timecards/myMissingTimecards.js";
import { registerMissingApprovalsTools } from "./tools/timecards/myMissingApprovals.js";
import { registerAllMissingTimecardsTools } from "./tools/timecards/allMissingTimecards.js";
import { registerAllMissingApprovalsTools } from "./tools/timecards/allMissingApprovals.js";
import { registerApproveTimecardsTools } from "./tools/timecards/approveTimecards.js";

// util
import { registerFindRecordsTool } from "./tools/util/findRecords.js";
import { registerGetObjectFieldsTool } from "./tools/util/getObjectFields.js";
import { registerReconnectTool } from "./tools/util/reconnect.js";
import { registerRunSoqlQueryTool } from "./tools/util/runSoqlQuery.js";
import { registerRunSoslSearchTool } from "./tools/util/runSoslSearch.js";

/**
 * SF_TOOLSET selects which tools this server instance exposes.
 *
 *   full    (default) — all tools. Requires the Salesforce PSA managed package
 *                       (pse__* objects), i.e. the WillowTree org.
 *   generic           — only org-agnostic tools: whoami, run_soql_query,
 *                       run_sosl_search, get_object_fields, reconnect.
 *                       Use for any org without PSA installed; the PSA tools
 *                       would only return INVALID_TYPE errors there.
 */
const TOOLSET = process.env.SF_TOOLSET === "generic" ? "generic" : "full";

export const server = new McpServer({
  name: TOOLSET === "generic" ? "salesforce-mcp-generic" : "salesforce-mcp",
  version: "0.1.0",
});

// Org-agnostic tools — safe against any Salesforce org.
registerWhoAmITool(server);
registerGetObjectFieldsTool(server);
registerRunSoqlQueryTool(server);
registerRunSoslSearchTool(server);
registerReconnectTool(server);

if (TOOLSET === "full") {
  registerAccountDetailsTool(server);
  registerAllocationsTool(server);
  registerBenchResourcesTool(server);
  registerDirectReportsTool(server);
  registerFindContactsTool(server);
  registerGetContactTool(server);
  registerHeadcountTool(server);
  registerMyDeliveryMetricsTool(server);
  registerMyTeamDeliveryMetricsTool(server);
  registerOpportunitiesTool(server);
  registerAllProjectsTool(server);
  registerClientProjectHistoryTool(server);
  registerFindProjectTool(server);
  registerMilestonesTool(server);
  registerMyProjectsTool(server);
  registerPortfolioSummaryTool(server);
  registerResourceRequestsTool(server);
  registerBillingEventsTool(server);
  registerComparePeriodsTool(server);
  registerEstVsActualsTool(server);
  registerRevenueByClientTool(server);
  registerRevenueForecastTool(server);
  registerVarianceBreakdownTool(server);
  registerSkillsTool(server);
  registerUpsertSkillTool(server);
  registerResourceSkillsTool(server);
  registerTimeOffsTool(server);
  registerMissingTimecardsTools(server);
  registerMissingApprovalsTools(server);
  registerAllMissingTimecardsTools(server);
  registerAllMissingApprovalsTools(server);
  registerApproveTimecardsTools(server);
  registerFindRecordsTool(server);
}
