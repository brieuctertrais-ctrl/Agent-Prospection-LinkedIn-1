import Anthropic from "@anthropic-ai/sdk";

// The API key only ever lives in the Edge Function secrets — never in the extension.
const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
export const MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-5-5";

/**
 * Single-turn text call. Short outputs → low effort keeps latency small.
 * Server-side fallbacks re-run the request on another model if a safety
 * classifier declines it.
 */
export async function complete(system: string, user: string, maxTokens = 2000): Promise<string> {
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
  if (response.stop_reason === "refusal") throw new Error("model_refusal");
  return response.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();
}
