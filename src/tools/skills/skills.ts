import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { soqlQueryAll, soqlQuery, sfPost, sfPatch, getCurrentUser, getInstanceUrl, SF_API_VERSION } from "../../lib/salesforce.js";

interface SkillRatingRecord {
  Id: string;
  pse__Resource__c: string;
  Resource_Name__c: string | null;
  Resource_Title__c: string | null;
  Resource_Division__c: string | null;
  Skill_or_Certification_Name__c: string | null;
  pse__Rating__c: string | null;
  pse__Numerical_Rating__c: number | null;
  pse__Notes__c: string | null;
  Is_Resource_Active__c: boolean;
  Date_Reported__c: string | null;
}

const SKILL_FIELDS = `
  Id,
  pse__Resource__c,
  Resource_Name__c,
  Resource_Title__c,
  Resource_Division__c,
  Skill_or_Certification_Name__c,
  pse__Rating__c,
  pse__Numerical_Rating__c,
  pse__Notes__c,
  Is_Resource_Active__c,
  Date_Reported__c
`.trim();

interface SkillRecord {
  Id: string;
  Name: string;
}

interface SkillRatingIdRecord {
  Id: string;
}

interface CreateSkillRatingResponse {
  id: string;
  success: boolean;
}

const RATING_LABELS: Record<number, string> = {
  0: "0 - no experience",
  1: "1 - novice",
  2: "2 - proficient",
  3: "3 - expert",
};

interface ExistingRatingRecord {
  Id: string;
  pse__Resource__c: string;
}

export function registerUpsertSkillTool(server: McpServer) {
  server.tool(
    "upsert_skill",
    "Adds or updates a skill/certification rating for one or more PSA resources in a single call. " +
      "Looks up the skill by exact name in the master skill list — if it does not exist yet, it is created automatically. " +
      "For each resource, checks whether they already have that skill: if so, updates the rating and notes; otherwise creates a new skill rating record. " +
      "Resources can be identified by contact_ids (Salesforce IDs) or emails (resolved to IDs automatically in one query). " +
      "Omit both to default to the currently authenticated user. " +
      "Rating scale: 0 = no experience, 1 = novice, 2 = proficient, 3 = expert.",
    {
      skill_name: z
        .string()
        .describe("Exact name of the skill/certification (e.g. 'Applied Generative AI'). Created automatically if it doesn't exist."),
      rating: z
        .number()
        .int()
        .min(0)
        .max(3)
        .optional()
        .describe("Proficiency level: 0 = no experience, 1 = novice, 2 = proficient, 3 = expert"),
      notes: z
        .string()
        .optional()
        .describe("Optional notes about this skill, applied to all resources"),
      contact_ids: z
        .array(z.string())
        .optional()
        .describe("List of Salesforce Contact IDs to assign the skill to."),
      emails: z
        .array(z.string())
        .optional()
        .describe("List of email addresses to assign the skill to. Resolved to Contact IDs automatically. Can be combined with contact_ids."),
    },
    async ({ skill_name, rating, notes, contact_ids, emails }) => {
      // Resolve the list of resource IDs to process
      let resourceIds: string[] = contact_ids ?? [];

      const unresolvedEmails: string[] = [];
      if (emails && emails.length > 0) {
        const emailList = emails.map(e => `'${e.replace(/'/g, "\\'")}'`).join(", ");
        let emailContacts: { Id: string; Email: string }[];
        try {
          emailContacts = await soqlQuery<{ Id: string; Email: string }>(
            `SELECT Id, Email FROM Contact WHERE Email IN (${emailList}) AND pse__Is_Resource__c = true`
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text", text: `Error resolving emails to contacts: ${message}` }],
            isError: true,
          };
        }

        const resolvedEmails = new Set(emailContacts.map(c => c.Email.toLowerCase()));
        emails.filter(e => !resolvedEmails.has(e.toLowerCase())).forEach(e => unresolvedEmails.push(e));
        resourceIds = [...new Set([...resourceIds, ...emailContacts.map(c => c.Id)])];
      }

      if (resourceIds.length === 0) {
        try {
          const user = await getCurrentUser();
          resourceIds = [user.contactId];
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text", text: `Error resolving current user: ${message}` }],
            isError: true,
          };
        }
      }

      // Look up (or create) the skill master record
      let skillRecords: SkillRecord[];
      try {
        skillRecords = await soqlQuery<SkillRecord>(
          `SELECT Id, Name FROM pse__Skill__c WHERE Name = '${skill_name.replace(/'/g, "\\'")}' LIMIT 1`
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error looking up skill: ${message}` }],
          isError: true,
        };
      }

      let skill: SkillRecord;
      let skillWasCreated = false;
      if (skillRecords.length === 0) {
        let created: CreateSkillRatingResponse;
        try {
          created = await sfPost<CreateSkillRatingResponse>(
            `/services/data/${SF_API_VERSION}/sobjects/pse__Skill__c`,
            { Name: skill_name }
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text", text: `Error creating skill master record: ${message}` }],
            isError: true,
          };
        }
        skill = { Id: created.id, Name: skill_name };
        skillWasCreated = true;
      } else {
        skill = skillRecords[0];
      }

      // Bulk-fetch existing ratings for all resources in one query
      const idList = resourceIds.map(id => `'${id}'`).join(", ");
      let existingRatings: ExistingRatingRecord[];
      try {
        existingRatings = await soqlQuery<ExistingRatingRecord>(
          `SELECT Id, pse__Resource__c FROM pse__Skill_Certification_Rating__c
           WHERE pse__Resource__c IN (${idList})
             AND pse__Skill_Certification__c = '${skill.Id}'`
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error checking existing skill ratings: ${message}` }],
          isError: true,
        };
      }

      const existingByContact = new Map(existingRatings.map(r => [r.pse__Resource__c, r.Id]));
      const fields: Record<string, unknown> = {};
      if (rating != null) fields["pse__Rating__c"] = RATING_LABELS[rating];
      if (notes != null) fields["pse__Notes__c"] = notes;

      const instanceUrl = await getInstanceUrl();
      const lines: string[] = [];

      if (skillWasCreated) {
        lines.push(`ℹ  Skill "${skill.Name}" added to the org's master skill catalog.\n`);
      }

      lines.push(
        `Skill:  ${skill.Name}`,
        `Rating: ${rating != null ? RATING_LABELS[rating] : "(none set)"}`,
        `Notes:  ${notes ?? "(none)"}`,
        ``,
      );

      // Process each resource — create or update their rating
      for (const contactId of resourceIds) {
        const existingId = existingByContact.get(contactId);
        try {
          if (existingId) {
            await sfPatch("pse__Skill_Certification_Rating__c", existingId, fields);
            lines.push(`  ✓ updated  ${contactId}  →  ${instanceUrl}/${existingId}`);
          } else {
            const created = await sfPost<CreateSkillRatingResponse>(
              `/services/data/${SF_API_VERSION}/sobjects/pse__Skill_Certification_Rating__c`,
              { pse__Resource__c: contactId, pse__Skill_Certification__c: skill.Id, ...fields }
            );
            lines.push(`  ✓ added    ${contactId}  →  ${instanceUrl}/${created.id}`);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          lines.push(`  ✗ failed   ${contactId}  —  ${message}`);
        }
      }

      if (unresolvedEmails.length > 0) {
        lines.push(``, `  ✗ not found (${unresolvedEmails.length} email(s) not matched to a resource):`);
        unresolvedEmails.forEach(e => lines.push(`    - ${e}`));
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );
}

interface ResourceSkillRecord {
  pse__Resource__c: string;
  Resource_Name__c: string | null;
  Resource_Title__c: string | null;
  Skill_or_Certification_Name__c: string | null;
  pse__Rating__c: string | null;
  pse__Numerical_Rating__c: number | null;
  pse__Notes__c: string | null;
}

const RESOURCE_SKILL_FIELDS = `
  pse__Resource__c,
  Resource_Name__c,
  Resource_Title__c,
  Skill_or_Certification_Name__c,
  pse__Rating__c,
  pse__Numerical_Rating__c,
  pse__Notes__c
`.trim();

export function registerResourceSkillsTool(server: McpServer) {
  server.tool(
    "get_resource_skills",
    "Returns all skills and certifications for one or more PSA resources. " +
      "The inverse of find_resources_by_skill: given a person (or team), returns everything they know. " +
      "Identify resources by contact_ids (Salesforce IDs), emails (resolved automatically), or manager_name (shows all direct reports' skills). " +
      "Omit all three to default to the currently authenticated user. " +
      "Results are grouped by person, with skills ordered by rating descending.",
    {
      contact_ids: z
        .array(z.string())
        .optional()
        .describe("Salesforce Contact IDs to look up skills for."),
      emails: z
        .array(z.string())
        .optional()
        .describe("Email addresses to look up. Resolved to Contact IDs automatically."),
      manager_name: z
        .string()
        .optional()
        .describe("Show skills for all direct reports of this manager (name or partial name)."),
    },
    async ({ contact_ids, emails, manager_name }) => {
      let resourceIds: string[] = contact_ids ? [...contact_ids] : [];

      // Resolve emails
      if (emails && emails.length > 0) {
        const emailList = emails.map(e => `'${e.replace(/'/g, "\\'")}'`).join(", ");
        try {
          const emailContacts = await soqlQuery<{ Id: string }>(
            `SELECT Id FROM Contact WHERE Email IN (${emailList}) AND pse__Is_Resource__c = true`
          );
          resourceIds = [...new Set([...resourceIds, ...emailContacts.map(c => c.Id)])];
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text", text: `Error resolving emails: ${message}` }],
            isError: true,
          };
        }
      }

      // Resolve manager name -> direct reports -> contact IDs
      if (manager_name) {
        try {
          const managers = await soqlQuery<{ Id: string; Name: string }>(
            `SELECT Id, Name FROM User WHERE Name LIKE '%${manager_name}%' AND IsActive = true ORDER BY Name ASC LIMIT 5`
          );
          if (managers.length === 0) {
            return {
              content: [{ type: "text", text: `No active user found matching "${manager_name}".` }],
            };
          }
          if (managers.length > 1) {
            const candidates = managers.map(m => `  • ${m.Name}`).join("\n");
            return {
              content: [{
                type: "text",
                text: `Found ${managers.length} users matching "${manager_name}". Please be more specific:\n\n${candidates}`,
              }],
            };
          }
          const reportUserIds = await soqlQuery<{ Id: string }>(
            `SELECT Id FROM User WHERE ManagerId = '${managers[0].Id}' AND IsActive = true`
          );
          if (reportUserIds.length === 0) {
            return {
              content: [{ type: "text", text: `${managers[0].Name} has no active direct reports.` }],
            };
          }
          const userIdList = reportUserIds.map(u => `'${u.Id}'`).join(", ");
          const contacts = await soqlQuery<{ Id: string }>(
            `SELECT Id FROM Contact WHERE pse__Salesforce_User__c IN (${userIdList}) AND pse__Is_Resource__c = true`
          );
          resourceIds = [...new Set([...resourceIds, ...contacts.map(c => c.Id)])];
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text", text: `Error resolving manager team: ${message}` }],
            isError: true,
          };
        }
      }

      // Default: current user
      if (resourceIds.length === 0) {
        try {
          const user = await getCurrentUser();
          resourceIds = [user.contactId];
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text", text: `Error resolving current user: ${message}` }],
            isError: true,
          };
        }
      }

      const idList = resourceIds.map(id => `'${id}'`).join(", ");
      let records: ResourceSkillRecord[];
      try {
        records = await soqlQueryAll<ResourceSkillRecord>(`
          SELECT ${RESOURCE_SKILL_FIELDS}
          FROM pse__Skill_Certification_Rating__c
          WHERE pse__Resource__c IN (${idList})
            AND Is_Resource_Active__c = true
          ORDER BY Resource_Name__c ASC, pse__Numerical_Rating__c DESC NULLS LAST
        `);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error querying resource skills: ${message}` }],
          isError: true,
        };
      }

      if (records.length === 0) {
        return {
          content: [{ type: "text", text: "No skill records found for the specified resource(s)." }],
        };
      }

      // Group by resource
      const byResource = new Map<string, { name: string; title: string; skills: ResourceSkillRecord[] }>();
      for (const r of records) {
        const id = r.pse__Resource__c;
        if (!byResource.has(id)) {
          byResource.set(id, {
            name: r.Resource_Name__c ?? id,
            title: r.Resource_Title__c ?? "—",
            skills: [],
          });
        }
        byResource.get(id)!.skills.push(r);
      }

      const lines: string[] = [
        `Skills for ${byResource.size} resource(s) — ${records.length} skill record(s) total`,
        ``,
      ];

      for (const { name, title, skills } of byResource.values()) {
        lines.push(`• ${name} — ${title}`, `  ${"─".repeat(50)}`);
        for (const s of skills) {
          const rating = s.pse__Rating__c ?? "—";
          const skillName = s.Skill_or_Certification_Name__c ?? "—";
          const notes = s.pse__Notes__c ? ` [${s.pse__Notes__c}]` : "";
          lines.push(`  ${skillName.padEnd(40)} ${rating}${notes}`);
        }
        lines.push(``);
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );
}

export function registerSkillsTool(server: McpServer) {
  server.tool(
    "find_resources_by_skill",
    "Finds PSA resources that have a specific skill or certification, with optional minimum rating. " +
      "Uses the skill ratings junction object which links skills to contacts with proficiency levels (1-5). " +
      "Filter by skill name, minimum rating, division, title, or active status.",
    {
      skill: z
        .string()
        .describe("Skill or certification name (partial match)"),
      min_rating: z
        .number()
        .optional()
        .describe("Minimum numerical rating (1-5)"),
      division: z
        .string()
        .optional()
        .describe("Filter by division (partial match)"),
      title: z
        .string()
        .optional()
        .describe("Filter by resource title (partial match)"),
      active_only: z
        .boolean()
        .optional()
        .describe("Only show active resources (default true)"),
    },
    async ({ skill, min_rating, division, title, active_only }) => {
      const conditions: string[] = [
        `Skill_or_Certification_Name__c LIKE '%${skill}%'`,
      ];

      if (active_only !== false) {
        conditions.push("Is_Resource_Active__c = true");
      }
      if (min_rating != null) {
        conditions.push(`pse__Numerical_Rating__c >= ${min_rating}`);
      }
      if (division) {
        conditions.push(`Resource_Division__c LIKE '%${division}%'`);
      }
      if (title) {
        conditions.push(`Resource_Title__c LIKE '%${title}%'`);
      }

      let records: SkillRatingRecord[];
      try {
        records = await soqlQueryAll<SkillRatingRecord>(`
          SELECT ${SKILL_FIELDS}
          FROM pse__Skill_Certification_Rating__c
          WHERE ${conditions.join("\n            AND ")}
          ORDER BY pse__Numerical_Rating__c DESC NULLS LAST, Resource_Name__c ASC
        `);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error querying skills: ${message}` }],
          isError: true,
        };
      }

      if (records.length === 0) {
        return {
          content: [{ type: "text", text: "No resources found matching the given skill and filters." }],
        };
      }

      const instanceUrl = await getInstanceUrl();
      const lines: string[] = [`Found ${records.length} resource(s) with matching skill:\n`];

      for (const r of records) {
        const contactUrl = `${instanceUrl}/${r.pse__Resource__c}`;
        lines.push(
          `• ${r.Resource_Name__c ?? "—"} — ${r.Resource_Title__c ?? "—"}`,
          `  Skill:    ${r.Skill_or_Certification_Name__c ?? "—"}`,
          `  Rating:   ${r.pse__Rating__c ?? "—"} (${r.pse__Numerical_Rating__c ?? "—"}/5)`,
          `  Division: ${r.Resource_Division__c ?? "—"}`,
          `  Reported: ${r.Date_Reported__c ?? "—"}`,
          `  Contact URL: ${contactUrl}`,
          ``
        );
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );
}
