import { providerManager } from "./providers/ProviderManager";
import { writeSkill } from "./vault";

/**
 * Learning loop: observes user exchanges and auto-creates skills for
 * repeatable multi-step workflows. Modeled on Hermes' background skill
 * creation: only persists a skill the SECOND time the same workflow is
 * observed, so one-off actions don't pollute the vault.
 *
 * Fire-and-forget: call as `void learnFromExchange(userText, replyText)`.
 */

interface SkillProposal {
  trigger: string | null;
  steps: string[];
}

// Trigger slug -> observed count. In-memory only (resets on server restart).
const observationCounts = new Map<string, number>();

// Cache of skill slugs already written so a repeated proposal is idempotent
// even across the trigger-variation boundary.
const writtenSlugs = new Set<string>();

function slugify(trigger: string): string {
  return trigger
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

/**
 * Ask Gemini whether an exchange represents a repeatable multi-step workflow.
 * Returns null when the exchange is one-off or non-actionable.
 */
async function proposeSkill(userText: string, replyText: string): Promise<SkillProposal | null> {
  const exchange = `User: ${userText}\nAddy: ${replyText}`.slice(0, 6000);
  const promptText =
    "Decide whether the exchange below describes a REPEATABLE multi-step workflow " +
    "the user is likely to ask again (e.g. a recurring action sequence). " +
    "Do NOT propose a skill for chit-chat, simple Q&A, or one-off tasks. " +
    "Reply with ONLY valid JSON, no markdown:\n" +
    '{"trigger": "<short phrase the user would say to invoke this workflow, or null>", "steps": ["<step 1>", "<step 2>"]}\n\n' +
    "If it is NOT a repeatable workflow, reply {\"trigger\": null, \"steps\": []}.\n\n" +
    exchange;

  const raw = await providerManager.generateResilientCompletion(
    promptText,
    "You are a skill-extraction assistant for a personal AI companion."
  );

  const json = raw.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(json) as SkillProposal;
  if (!parsed.trigger || !Array.isArray(parsed.steps) || parsed.steps.length < 2) {
    return null;
  }
  return { trigger: parsed.trigger.trim(), steps: parsed.steps.map((s) => String(s).trim()) };
}

/**
 * Observe one completed exchange. The first time a workflow is seen it is
 * counted; the second time (same trigger slug) a skill is written to the vault.
 */
export async function learnFromExchange(userText: string, replyText: string): Promise<void> {
  try {
    const proposal = await proposeSkill(userText, replyText);
    if (!proposal) return;

    const slug = slugify(proposal.trigger);
    if (writtenSlugs.has(slug)) return;

    const count = (observationCounts.get(slug) ?? 0) + 1;
    observationCounts.set(slug, count);

    if (count < 2) {
      console.log(`[Skills] First observation of workflow "${proposal.trigger}" (needs one more to persist)`);
      return;
    }

    await writeSkill(proposal.trigger, proposal.steps);
    writtenSlugs.add(slug);
    console.log(`[Skills] Learned new skill "${proposal.trigger}" (${proposal.steps.length} steps)`);
  } catch (e: any) {
    console.warn("[Skills] Learning loop error:", e?.message ?? e);
  }
}