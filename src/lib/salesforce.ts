import { execSync } from "child_process";

export const SF_API_VERSION = "v62.0";
const SF_ALIAS = "willowtree";
const SF_INSTANCE_URL = "https://willowtree.my.salesforce.com";

let cachedToken: string | null = null;

export function clearCachedToken(): void {
  cachedToken = null;
}

async function getAccessToken(): Promise<string> {
  if (cachedToken) return cachedToken;

  // Read the cached token from the sf CLI's existing session. We intentionally
  // do NOT call `sf org login web` here — it opens a browser, which hangs in
  // MCP stdio context. If the CLI session has expired, this throws and the
  // user re-authenticates once at the shell with `sf org login web`.
  //
  // SF_TEMP_SHOW_SECRETS=true forces `sf org display` to return the real
  // accessToken instead of [REDACTED] on sf CLI >= 2.137.x.
  let raw: string;
  try {
    raw = execSync(
      `sf org display --target-org ${SF_ALIAS} --verbose --json`,
      {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, SF_TEMP_SHOW_SECRETS: "true" },
      }
    );
  } catch (err) {
    throw new Error(
      `Salesforce CLI session not available for alias "${SF_ALIAS}". ` +
        `Run \`sf org login web --instance-url ${SF_INSTANCE_URL} --alias ${SF_ALIAS}\` ` +
        `in a terminal once, then retry.`
    );
  }

  const json = JSON.parse(raw) as { result?: { accessToken?: string } };
  const token = json.result?.accessToken;
  if (!token || token === "[REDACTED]") {
    throw new Error(
      `Could not retrieve Salesforce access token from sf CLI. ` +
        `If you see [REDACTED], your sf CLI version may not honor SF_TEMP_SHOW_SECRETS — ` +
        `upgrade with \`npm i -g @salesforce/cli\` or downgrade and retry.`
    );
  }

  cachedToken = token;
  return token;
}

async function getConfig(): Promise<{ instanceUrl: string; accessToken: string }> {
  const instanceUrl = process.env.SALESFORCE_INSTANCE_URL ?? SF_INSTANCE_URL;
  const accessToken = await getAccessToken();
  return { instanceUrl, accessToken };
}

function authHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
  };
}

export async function soqlQuery<T>(soql: string): Promise<T[]> {
  const { instanceUrl, accessToken } = await getConfig();
  const url = `${instanceUrl}/services/data/${SF_API_VERSION}/query?q=${encodeURIComponent(soql)}`;
  const response = await fetch(url, { headers: authHeaders(accessToken) });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Salesforce query failed (HTTP ${response.status}): ${body}`);
  }
  const data = (await response.json()) as { records: T[] };
  return data.records;
}

/**
 * Like soqlQuery but follows nextRecordsUrl pages until all records are fetched.
 * Use for queries that may return more than 2,000 records.
 */
export async function soqlQueryAll<T>(soql: string): Promise<T[]> {
  const { instanceUrl, accessToken } = await getConfig();
  const headers = authHeaders(accessToken);
  const all: T[] = [];

  let url: string | null = `${instanceUrl}/services/data/${SF_API_VERSION}/query?q=${encodeURIComponent(soql)}`;

  while (url) {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Salesforce query failed (HTTP ${response.status}): ${body}`);
    }
    const data = (await response.json()) as {
      records: T[];
      done: boolean;
      nextRecordsUrl?: string;
    };
    all.push(...data.records);
    url = data.done || !data.nextRecordsUrl
      ? null
      : `${instanceUrl}${data.nextRecordsUrl}`;
  }

  return all;
}

export async function sfPost<T>(path: string, body?: unknown): Promise<T> {
  const { instanceUrl, accessToken } = await getConfig();
  const url = `${instanceUrl}${path}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...authHeaders(accessToken),
      "Content-Type": "application/json",
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Salesforce POST failed (HTTP ${response.status}): ${text}`);
  }
  return response.json() as Promise<T>;
}

export async function sfGet<T>(path: string): Promise<T> {
  const { instanceUrl, accessToken } = await getConfig();
  const url = `${instanceUrl}${path}`;
  const response = await fetch(url, { headers: authHeaders(accessToken) });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Salesforce request failed (HTTP ${response.status}): ${body}`);
  }
  return response.json() as Promise<T>;
}

/**
 * PATCH a single Salesforce record with the given fields.
 * Returns nothing on success (Salesforce responds 204 No Content).
 * Throws on any non-2xx response.
 */
export async function sfPatch(
  sobjectType: string,
  recordId: string,
  fields: Record<string, unknown>
): Promise<void> {
  const { instanceUrl, accessToken } = await getConfig();
  const url = `${instanceUrl}/services/data/${SF_API_VERSION}/sobjects/${sobjectType}/${recordId}`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      ...authHeaders(accessToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(fields),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Salesforce PATCH failed for ${sobjectType}/${recordId} (HTTP ${response.status}): ${body}`
    );
  }
}

interface UserInfo {
  user_id: string;
  email: string;
  name: string;
}

interface ContactRecord {
  Id: string;
}

export interface CurrentUser {
  /** Salesforce User Id (e.g. used for Director__c lookups) */
  userId: string;
  /** Contact Id linked to this user (e.g. used for pse__Project_Manager__c lookups) */
  contactId: string;
  email: string;
  name: string;
}

/**
 * Resolves the current authenticated user's Salesforce User ID and linked Contact ID.
 * PSA uses Contact references for Project Manager, while some fields (e.g. Director__c) reference User directly.
 */
export async function getCurrentUser(): Promise<CurrentUser> {
  const userInfo = await sfGet<UserInfo>(`/services/oauth2/userinfo`);

  const contacts = await soqlQuery<ContactRecord>(
    `SELECT Id FROM Contact WHERE Email = '${userInfo.email}' LIMIT 1`
  );

  if (contacts.length === 0) {
    throw new Error(
      `No Contact record found for the current user (${userInfo.email}). ` +
        `Ensure your Salesforce user has a linked Contact.`
    );
  }

  return {
    userId: userInfo.user_id,
    contactId: contacts[0].Id,
    email: userInfo.email,
    name: userInfo.name,
  };
}

/** @deprecated Use getCurrentUser() instead */
export async function getCurrentUserContactId(): Promise<string> {
  return (await getCurrentUser()).contactId;
}

export async function getInstanceUrl(): Promise<string> {
  return (await getConfig()).instanceUrl;
}
