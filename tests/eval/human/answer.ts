import type {
  AskAnswer,
  AskQuestion,
} from "../../../packages/protocol/lophn-agent/ask-tool.ts";
import type { HumanDefinition } from "./definition.ts";

export type HumanFetch = (url: string, init: RequestInit) => Promise<Response>;

export type EarlierAnswer = { question: string; answer: string[] };

const MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const TIMEOUT_MS = 60_000;
// forced tool_choice가 haiku에서 400이면 {type:"auto"}로 바꾸고 content 끝에 한 줄을 더한다
// (judge/run.ts와 같은 우회).
const TOOL_CHOICE = { type: "tool", name: "answer" };

// 카드가 답하지 않는 질문에 내는 자유 답. 제품의 ask에는 추천 표시가 없다.
export const ANSWER_DEFAULT = "추천대로 해 줘";

function earlierText(earlier: EarlierAnswer[]): string {
  if (earlier.length === 0) return "(none)";
  return earlier.map((e) => `Q: ${e.question}\nA: ${e.answer.join(", ")}`)
    .join("\n\n");
}

function questionsText(questions: AskQuestion[]): string {
  return questions.map((q, i) => {
    const lines = [`Q${i + 1} [${q.header}]: ${q.question}`];
    for (const o of q.options) lines.push(`- ${o.label}: ${o.description}`);
    if (q.multiSelect) lines.push("(multiple choices allowed)");
    return lines.join("\n");
  }).join("\n\n");
}

// 사람 역할이 보는 것은 카드(system), 앞서 자기가 한 답, 질문뿐이다. session·role·앱·ticket은 주지 않는다.
// 실패해도 던지지 않고 모든 질문에 default를 준다. ask는 turn이 기다리는 tool이라 답이 없으면 trial이 상한까지 멈춘다.
export async function answerQuestions(
  deps: { fetch: HumanFetch; apiKey: string; definition: HumanDefinition },
  input: { card: string; earlier: EarlierAnswer[]; questions: AskQuestion[] },
): Promise<{ answers: AskAnswer[]; cost_usd: number; error: string | null }> {
  const { definition, fetch, apiKey } = deps;
  const { card, earlier, questions } = input;
  let cost_usd = 0;

  // 답은 모델 출력이 아니라 입력 질문에서 question을 복사한다. askAnswer가 글자 그대로 같은 것만 받는다.
  const build = (selected: (string[] | undefined)[]): AskAnswer[] =>
    questions.map((q, i) => {
      let values = (selected[i] ?? []).filter((s) =>
        typeof s === "string" && s.trim() !== ""
      );
      if (!q.multiSelect) values = values.slice(0, 1);
      if (values.length === 0) values = [ANSWER_DEFAULT];
      return { question: q.question, status: "answered", answer: values };
    });
  const fallback = (error: string) => ({
    answers: build([]),
    cost_usd,
    error,
  });

  const body = {
    model: definition.model,
    max_tokens: definition.max_tokens,
    system:
      `${definition.prompt}\n<requirement_card>\n${card}\n</requirement_card>`,
    thinking: { type: "disabled" },
    tools: [{
      name: "answer",
      description:
        "Answer every question, in order. selected holds the chosen option labels or a short free text.",
      strict: true,
      input_schema: {
        type: "object",
        properties: {
          answers: {
            type: "array",
            items: {
              type: "object",
              properties: {
                selected: { type: "array", items: { type: "string" } },
              },
              required: ["selected"],
              additionalProperties: false,
            },
          },
        },
        required: ["answers"],
        additionalProperties: false,
      },
    }],
    tool_choice: TOOL_CHOICE,
    messages: [{
      role: "user",
      content: `<earlier_answers>\n${
        earlierText(earlier)
      }\n</earlier_answers>\n<questions>\n${
        questionsText(questions)
      }\n</questions>`,
    }],
  };

  let res: Response;
  try {
    res = await fetch(MESSAGES_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    return fallback(`network: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (res.status !== 200) return fallback(`http ${res.status}`);
  // deno-lint-ignore no-explicit-any
  let json: any;
  try {
    json = await res.json();
  } catch (e) {
    return fallback(`network: ${e instanceof Error ? e.message : String(e)}`);
  }

  const u = json?.usage;
  if (u) {
    const inTokens = (u.input_tokens ?? 0) +
      (u.cache_creation_input_tokens ?? 0) +
      (u.cache_read_input_tokens ?? 0);
    cost_usd = (inTokens * definition.price_usd_per_mtok.input +
      (u.output_tokens ?? 0) * definition.price_usd_per_mtok.output) / 1e6;
  }

  const block = Array.isArray(json?.content)
    ? json.content.find((b: { type?: string; name?: string }) =>
      b?.type === "tool_use" && b.name === "answer"
    )
    : undefined;
  if (!block) return fallback(`no answer (stop_reason=${json?.stop_reason})`);
  const given = Array.isArray(block.input?.answers) ? block.input.answers : [];
  const selected = given.map((a: { selected?: unknown }) =>
    Array.isArray(a?.selected) ? a.selected : undefined
  );
  return {
    answers: build(selected),
    cost_usd,
    error: given.length === questions.length
      ? null
      : `answers length ${given.length} != ${questions.length}`,
  };
}
