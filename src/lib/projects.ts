export interface ProjectRecord {
  Id: string;
  Name: string;
  pse__Project_ID__c: string | null;
  pse__Project_Manager__c: string | null;
  pse__Project_Manager__r: { Name: string } | null;
  Director__c: string | null;
  pse__Stage__c: string | null;
  pse__Start_Date__c: string | null;
  pse__End_Date__c: string | null;
  pse__Is_Active__c: boolean;
  pse__Account__r: { Name: string } | null;
  pse__Opportunity__r: { Name: string } | null;
  pse__Group__r: { Name: string } | null;
  pse__Practice__r: { Name: string } | null;
  pse__Region__r: { Name: string } | null;
  Primary_Timecard_Approver__r: { Name: string } | null;
  Secondary_Approver__r: { Name: string } | null;
  Director__r: { Name: string } | null;
  Contract_Type__c: string | null;
  Line_of_Business__c: string | null;
  Contracted_By__c: string | null;
  pse__Project_Type__c: string | null;
  CurrencyIsoCode: string | null;
  Notes__c: string | null;
  pse__Is_Billable__c: boolean;
  pse__Time_Credited__c: boolean;
  pse__Bookings__c: number | null;
  Total_Estimated_Revenue__c: number | null;
  Project_Underrun__c: number | null;
  Project_Margin_to_Date_Percent__c: number | null;
  Project_Margin_Percent_at_Completion__c: number | null;
  Client_ECR__c: number | null;
  Is_Project_on_Budget__c: boolean | null;
  Revenue_Earned_to_Date__c: number | null;
  Costs_Incurred_to_Date__c: number | null;
  Estimated_Costs_at_Completion__c: number | null;
}

export const PROJECT_FIELDS = `
  Id,
  Name,
  pse__Project_ID__c,
  pse__Project_Manager__c,
  pse__Project_Manager__r.Name,
  Director__c,
  pse__Stage__c,
  pse__Start_Date__c,
  pse__End_Date__c,
  pse__Is_Active__c,
  pse__Account__r.Name,
  pse__Opportunity__r.Name,
  pse__Group__r.Name,
  pse__Practice__r.Name,
  pse__Region__r.Name,
  Primary_Timecard_Approver__r.Name,
  Secondary_Approver__r.Name,
  Director__r.Name,
  Contract_Type__c,
  Line_of_Business__c,
  Contracted_By__c,
  pse__Project_Type__c,
  CurrencyIsoCode,
  Notes__c,
  pse__Is_Billable__c,
  pse__Time_Credited__c,
  pse__Bookings__c,
  Total_Estimated_Revenue__c,
  Project_Underrun__c,
  Project_Margin_to_Date_Percent__c,
  Project_Margin_Percent_at_Completion__c,
  Client_ECR__c,
  Is_Project_on_Budget__c,
  Revenue_Earned_to_Date__c,
  Costs_Incurred_to_Date__c,
  Estimated_Costs_at_Completion__c
`.trim();

export const currency = (v: number | null) =>
  v != null
    ? `USD ${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : "—";

export const percent = (v: number | null) => (v != null ? `${v.toFixed(2)}%` : "—");

export const bool = (v: boolean | null, yes = "Yes", no = "No") =>
  v == null ? "—" : v ? yes : no;

export function formatProject(
  p: ProjectRecord,
  instanceUrl: string,
  extraLines: string[] = []
): string[] {
  const url = `${instanceUrl}/${p.Id}`;
  return [
    `• ${p.Name} (${p.pse__Project_ID__c ?? "—"})`,
    ...extraLines,
    `  URL: ${url}`,
    ``,
    `  — Info —`,
    `  Account:                   ${p.pse__Account__r?.Name ?? "—"}`,
    `  Opportunity:               ${p.pse__Opportunity__r?.Name ?? "—"}`,
    `  Stage:                     ${p.pse__Stage__c ?? "—"}`,
    `  Project Type:              ${p.pse__Project_Type__c ?? "—"}`,
    `  Dates:                     ${p.pse__Start_Date__c ?? "—"} → ${p.pse__End_Date__c ?? "—"}`,
    `  Service Line:              ${p.pse__Group__r?.Name ?? "—"}`,
    `  Reporting Company:         ${p.pse__Practice__r?.Name ?? "—"}`,
    `  Region:                    ${p.pse__Region__r?.Name ?? "—"}`,
    `  Line of Business:          ${p.Line_of_Business__c ?? "—"}`,
    `  Project Manager:           ${p.pse__Project_Manager__r?.Name ?? "—"}`,
    `  Director:                  ${p.Director__r?.Name ?? "—"}`,
    `  Primary Timecard Approver: ${p.Primary_Timecard_Approver__r?.Name ?? "—"}`,
    `  Secondary Approver:        ${p.Secondary_Approver__r?.Name ?? "—"}`,
    `  Contract Type:             ${p.Contract_Type__c ?? "—"}`,
    `  Finance Team:              ${p.Contracted_By__c ?? "—"}`,
    `  Currency:                  ${p.CurrencyIsoCode ?? "—"}`,
    `  Billable:                  ${bool(p.pse__Is_Billable__c)}`,
    `  Time Credited:             ${bool(p.pse__Time_Credited__c)}`,
    ...(p.Notes__c ? [`  Notes:                     ${p.Notes__c}`] : []),
    ``,
    `  — Financials —`,
    `  Bookings:                       ${currency(p.pse__Bookings__c)}`,
    `  Total Estimated Revenue:        ${currency(p.Total_Estimated_Revenue__c)}`,
    `  Revenue Earned to Date:         ${currency(p.Revenue_Earned_to_Date__c)}`,
    `  Costs Incurred to Date:         ${currency(p.Costs_Incurred_to_Date__c)}`,
    `  Est Costs at Completion:        ${currency(p.Estimated_Costs_at_Completion__c)}`,
    `  Project Underrun:               ${currency(p.Project_Underrun__c)}`,
    `  Client ECR:                     ${p.Client_ECR__c != null ? `USD ${p.Client_ECR__c}/hr` : "—"}`,
    `  Project Margin to Date %:       ${percent(p.Project_Margin_to_Date_Percent__c)}`,
    `  Project Margin % at Completion: ${percent(p.Project_Margin_Percent_at_Completion__c)}`,
    `  Is Project on Budget:           ${bool(p.Is_Project_on_Budget__c)}`,
    ``,
  ];
}
