import type { Criterion, JudgeItem } from "../types.ts";
import type { JudgeDefinition } from "./definition.ts";

export type JudgeFetch = (url: string, init: RequestInit) => Promise<Response>;

const MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const TIMEOUT_MS = 60_000;
// forced tool_choice가 haiku에서 400이면 {type:"auto"}로 바꾸고 content 끝에 이 줄을 더한다.
const TOOL_CHOICE = { type: "tool", name: "verdict" };

export function quoteInInput(input: string, quote: string): boolean {
  const q = quote.trim();
  return q !== "" && input.includes(q);
}

export async function judgeItem(
  deps: { fetch: JudgeFetch; apiKey: string },
  args: {
    check: string;
    criterion: Criterion;
    input: string;
    judge: JudgeDefinition;
  },
): Promise<JudgeItem> {
  const { check, criterion, input, judge } = args;
  const item: JudgeItem = {
    check,
    criterion: `${criterion.name}@${criterion.n}`,
    input,
    verdict: null,
    quote: null,
    quote_found: false,
    judge: `judge@${judge.n}`,
    cost_usd: 0,
    error: null,
  };
  const body = {
    model: judge.model,
    max_tokens: judge.max_tokens,
    system: judge.prompt,
    thinking: { type: "disabled" },
    tools: [{
      name: "verdict",
      description:
        "Report the verdict for the question, with one verbatim quote from the input.",
      strict: true,
      input_schema: {
        type: "object",
        properties: {
          verdict: { type: "string", enum: criterion.verdicts },
          quote: { type: "string" },
        },
        required: ["verdict", "quote"],
        additionalProperties: false,
      },
    }],
    tool_choice: TOOL_CHOICE,
    messages: [{
      role: "user",
      content: `<question>${criterion.question}</question>\n<allowed_verdicts>${
        criterion.verdicts.join(", ")
      }</allowed_verdicts>\n<input>\n${input}\n</input>`,
    }],
  };

  let res: Response;
  try {
    res = await deps.fetch(MESSAGES_URL, {
      method: "POST",
      headers: {
        "x-api-key": deps.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    item.error = `network: ${e instanceof Error ? e.message : String(e)}`;
    return item;
  }
  if (res.status !== 200) {
    item.error = `http ${res.status}`;
    return item;
  }
  // deno-lint-ignore no-explicit-any
  let json: any;
  try {
    json = await res.json();
  } catch (e) {
    item.error = `network: ${e instanceof Error ? e.message : String(e)}`;
    return item;
  }

  const u = json?.usage;
  if (u) {
    const inTokens = (u.input_tokens ?? 0) +
      (u.cache_creation_input_tokens ?? 0) +
      (u.cache_read_input_tokens ?? 0);
    item.cost_usd = (inTokens * judge.price_usd_per_mtok.input +
      (u.output_tokens ?? 0) * judge.price_usd_per_mtok.output) / 1e6;
  }

  const block = Array.isArray(json?.content)
    ? json.content.find((b: { type?: string; name?: string }) =>
      b?.type === "tool_use" && b.name === "verdict"
    )
    : undefined;
  if (!block) {
    item.error = `no verdict (stop_reason=${json?.stop_reason})`;
    return item;
  }
  const { verdict, quote } = block.input ?? {};
  if (!criterion.verdicts.includes(verdict)) {
    item.error = `verdict not allowed: ${verdict}`;
    return item;
  }
  item.verdict = verdict;
  if (typeof quote !== "string") {
    item.error = "no quote";
    return item;
  }
  item.quote = quote;
  item.quote_found = quoteInInput(input, quote);
  if (!item.quote_found) item.error = "quote not in input";
  return item;
}

export function judgePassed(criterion: Criterion, item: JudgeItem): boolean {
  return item.error === null && item.quote_found && item.verdict !== null &&
    criterion.pass.includes(item.verdict);
}
