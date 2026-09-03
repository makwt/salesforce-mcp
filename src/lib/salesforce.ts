import { execSync } from "child_process";

export const SF_API_VERSION = "v62.0";

/**
 * Which `sf` CLI org this server instance talks to. Defaults to the WillowTree
 * PSA org so existing single-org setups keep working with no config change.
 * Set SF_TARGET_ORG to point a second server instance at another org (see
 * README "Running against a second org").
 */
const SF_ALIAS = process.env.SF_TARGET_ORG ?? "willowtree";
const SF_FALLBACK_INSTANCE_URL = "https://willowtree.my.salesforce.com";

let cachedToken: string | null = null;
let cachedInstanceUrl: string | null = null;

export function clearCachedToken(): void {
  cachedToken = null;
  cachedInstanceUrl = null;
}

export function getTargetOrgAlias(): string {
  return SF_ALIAS;
}

/**
 * Reads the access token AND instance URL from the `sf` CLI's cached session for
 * SF_ALIAS. Both come from the same call so a server instance can never pair one
 * org's token with another org's instance URL.
 *
 * We intentionally do NOT call `sf org login web` here — it opens a browser,
 * which hangs in MCP stdio context. If the CLI session has expired, this throws
 * and the user re-authenticates once at the shell with `sf org login web`.
 *
 * SF_TEMP_SHOW_SECRETS=true forces `sf org display` to return the real
 * accessToken instead of [REDACTED] on sf CLI >= 2.137.x.
 */
async function loadSession(): Promise<{ accessToken: string; instanceUrl: string }> {
  if (cachedToken && cachedInstanceUrl) {
    return { accessToken: cachedToken, instanceUrl: cachedInstanceUrl };
  }

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
        `Run \`sf org login web --instance-url <your-org-url> --alias ${SF_ALIAS}\` ` +
        `in a terminal once, then retry.`
    );
  }

  const json = JSON.parse(raw) as {
    result?: { accessToken?: string; instanceUrl?: string };
  };
  const token = json.result?.accessToken;
  if (!token || token === "[REDACTED]") {
    throw new Error(
      `Could not retrieve Salesforce access token from sf CLI for alias "${SF_ALIAS}". ` +
        `If you see [REDACTED], your sf CLI version may not honor SF_TEMP_SHOW_SECRETS — ` +
        `upgrade with \`npm i -g @salesforce/cli\` or downgrade and retry.`
    );
  }

  // Always use the instance URL the CLI reports for THIS org, so a token can
  // never be paired with another org's URL.
  //
  // SALESFORCE_INSTANCE_URL is honoured ONLY on the default org — .env ships it
  // pinned to WillowTree, and dotenv would otherwise leak that value into a
  // second server instance pointed at a different org (verified: causes a 401).
  const envOverride = process.env.SF_TARGET_ORG
    ? undefined
    : process.env.SALESFORCE_INSTANCE_URL;

  const instanceUrl =
    envOverride ?? json.result?.instanceUrl ?? SF_FALLBACK_INSTANCE_URL;

  cachedToken = token;
  cachedInstanceUrl = instanceUrl.replace(/\/$/, "");
  return { accessToken: cachedToken, instanceUrl: cachedInstanceUrl };
}

async function getConfig(): Promise<{ instanceUrl: string; accessToken: string }> {
  return loadSession();
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

/**
 * Like getCurrentUser() but does NOT require a linked Contact record.
 * PSA tools need the Contact and should keep using getCurrentUser(); identity
 * checks (whoami) use this so they still work in a non-PSA org where the
 * authenticated user has no Contact.
 */
export async function getCurrentUserBasic(): Promise<
  Omit<CurrentUser, "contactId"> & { contactId: string | null; orgId: string | null }
> {
  const userInfo = await sfGet<UserInfo & { organization_id?: string }>(
    `/services/oauth2/userinfo`
  );

  let contactId: string | null = null;
  try {
    const contacts = await soqlQuery<ContactRecord>(
      `SELECT Id FROM Contact WHERE Email = '${userInfo.email}' LIMIT 1`
    );
    contactId = contacts[0]?.Id ?? null;
  } catch {
    // Org may not expose Contact to this user; identity is still resolvable.
    contactId = null;
  }

  return {
    userId: userInfo.user_id,
    contactId,
    orgId: userInfo.organization_id ?? null,
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
