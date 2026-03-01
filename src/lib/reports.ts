import { sfPost, SF_API_VERSION } from "./salesforce.js";

export interface ReportCell {
  label: string;
  value: unknown;
}

export interface ReportRow {
  dataCells: ReportCell[];
}

export interface ReportGrouping {
  key: string;
  label: string;
  groupings: ReportGrouping[];
}

export interface ReportResult {
  columns: string[];
  columnLabels: Record<string, string>;
  aggregateColumns: string[];
  aggregateLabels: Record<string, string>;
  groupingsDown: ReportGrouping[];
  factMap: Record<string, { rows: ReportRow[]; aggregates: ReportCell[] }>;
  allData: boolean;
  totalRows: number;
}

/**
 * Executes a Salesforce Analytics report and returns the raw structured result.
 * Uses POST (run now) so filters based on $USER apply against the current token's user.
 *
 * @param metadataOverrides - Optional partial reportMetadata to merge into the POST body,
 *   e.g. { aggregates: ["FORMULA1"] }.
 */
export async function runReport(
  reportId: string,
  includeDetails = true,
  metadataOverrides?: Record<string, unknown>
): Promise<ReportResult> {
  let path = `/services/data/${SF_API_VERSION}/analytics/reports/${reportId}`;
  if (!includeDetails) {
    path += "?includeDetails=false";
  }

  const body = metadataOverrides
    ? { reportMetadata: metadataOverrides }
    : undefined;

  const data = await sfPost<{
    allData: boolean;
    reportMetadata: {
      detailColumns: string[];
      aggregates: string[];
    };
    reportExtendedMetadata: {
      detailColumnInfo: Record<string, { label: string }>;
      aggregateColumnInfo: Record<string, { label: string }>;
    };
    groupingsDown: { groupings: ReportGrouping[] };
    factMap: Record<string, { rows: ReportRow[]; aggregates: ReportCell[] }>;
  }>(path, body);

  const columns = data.reportMetadata.detailColumns;
  const columnInfo = data.reportExtendedMetadata.detailColumnInfo;
  const columnLabels: Record<string, string> = {};
  for (const col of columns) {
    columnLabels[col] = columnInfo[col]?.label ?? col;
  }

  const aggregateColumns = data.reportMetadata.aggregates ?? [];
  const aggInfo = data.reportExtendedMetadata.aggregateColumnInfo ?? {};
  const aggregateLabels: Record<string, string> = {};
  for (const col of aggregateColumns) {
    aggregateLabels[col] = aggInfo[col]?.label ?? col;
  }

  let totalRows = 0;
  for (const entry of Object.values(data.factMap)) {
    totalRows += entry.rows?.length ?? 0;
  }

  return {
    columns,
    columnLabels,
    aggregateColumns,
    aggregateLabels,
    groupingsDown: data.groupingsDown.groupings,
    factMap: data.factMap,
    allData: data.allData,
    totalRows,
  };
}

/**
 * Walks a grouped report's groupings tree and collects all detail rows,
 * annotating each row with its grouping labels.
 */
export function collectGroupedRows(
  result: ReportResult,
  groupingLabels: string[]
): Array<{ groups: string[]; cells: Record<string, string> }> {
  const rows: Array<{ groups: string[]; cells: Record<string, string> }> = [];

  function walk(groupings: ReportGrouping[], ancestors: string[]) {
    for (const g of groupings) {
      const path = [...ancestors, g.label];
      if (g.groupings.length > 0) {
        walk(g.groupings, path);
      } else {
        const fk = `${g.key}!T`;
        const entry = result.factMap[fk];
        for (const row of entry?.rows ?? []) {
          const cells: Record<string, string> = {};
          result.columns.forEach((col, i) => {
            cells[result.columnLabels[col]] = row.dataCells[i]?.label ?? "—";
          });
          // Annotate with grouping values
          groupingLabels.forEach((label, i) => {
            cells[label] = path[i] ?? "—";
          });
          rows.push({ groups: path, cells });
        }
      }
    }
  }

  walk(result.groupingsDown, []);
  return rows;
}
