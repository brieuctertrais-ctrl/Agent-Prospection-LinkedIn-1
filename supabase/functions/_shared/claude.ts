import Anthropic from "@anthropic-ai/sdk";

// The API key only ever lives in the Edge Function secrets — never in the extension or the web front.
const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
export const MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-5-5";

export interface Completion {
  text: string;
  usage: { input_tokens: number; output_tokens: number };
}

/**
 * Single-turn text call. Short outputs → low effort keeps latency and cost small.
 * Server-side fallbacks re-run the request on another model if a safety classifier declines it.
 */
export async function complete(system: string, user: string, maxTokens = 2000): Promise<Completion> {
  // deno-lint-ignore no-explicit-any
  const params: any = {
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
    output_config: { effort: "low" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  };
  const response = await client.beta.messages.create(params);
  const usage = { input_tokens: response.usage?.input_tokens ?? 0, output_tokens: response.usage?.output_tokens ?? 0 };
  if (response.stop_reason === "refusal") return { text: "", usage };
  const text = (response.content as { type: string; text?: string }[]).map((b) => (b.type === "text" ? b.text ?? "" : "")).join("");
  return { text, usage };
}

/** Cleans model output before storing/displaying it: plain text only. */
export function sanitizeAiText(text: string): string {
  return text
    .normalize("NFC")
    .replace(/<[^>]*>/g, "") // no HTML/markup
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g, "") // control & bidi chars
    .replace(/^\s*["«“]\s*|\s*["»”]\s*$/g, "") // surrounding quotes
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
