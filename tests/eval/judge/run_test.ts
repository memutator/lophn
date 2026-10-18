// 세 질문
// - contract: judge 응답이 틀리면 error가 남고 통과하지 않는다. 글자 그대로 같은 인용의 정상 응답만 통과한다.
// - 현실적 회귀: 바꿔 쓴 인용이나 tool 호출 없는 응답이 통과로 세어져 eval 결과를 부풀리는 것.
// - 왜 지금 test로 못 잡나: 진짜 API를 test에서 부르지 않는다. 가짜 fetch로만 이 판정 규칙을 본다.
import { assert, assertEquals } from "@std/assert";
import { loadCriterion } from "../criteria/mod.ts";
import { loadJudgeDefinition } from "./definition.ts";
import { type JudgeFetch, judgeItem, judgePassed } from "./run.ts";

const INPUT =
  "[HUMAN_REQUEST]\nMake a budget app\n\n[CALL_BODY]\nBuild a budget app";

const ok = (content: unknown[]) =>
  new Response(JSON.stringify({
    content,
    stop_reason: "tool_use",
    usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 },
  }));
const verdictBlock = (verdict: string, quote: unknown) => ({
  type: "tool_use",
  name: "verdict",
  input: { verdict, quote },
});

const cases: {
  name: string;
  fetch: JudgeFetch;
  error: string | null;
  verdict: string | null;
  passed: boolean;
}[] = [
  {
    name: "verbatim quote passes",
    fetch: () =>
      Promise.resolve(ok([verdictBlock("all", " Build a budget app ")])),
    error: null,
    verdict: "all",
    passed: true,
  },
  {
    name: "paraphrased quote",
    fetch: () =>
      Promise.resolve(ok([verdictBlock("all", "build a budget app")])),
    error: "quote not in input",
    verdict: "all",
    passed: false,
  },
  {
    name: "verdict not allowed",
    fetch: () =>
      Promise.resolve(ok([verdictBlock("maybe", "Build a budget app")])),
    error: "verdict not allowed: maybe",
    verdict: null,
    passed: false,
  },
  {
    name: "no tool call",
    fetch: () => Promise.resolve(ok([{ type: "text", text: "all" }])),
    error: "no verdict (stop_reason=tool_use)",
    verdict: null,
    passed: false,
  },
  {
    name: "http error",
    fetch: () => Promise.resolve(new Response("{}", { status: 400 })),
    error: "http 400",
    verdict: null,
    passed: false,
  },
  {
    name: "network error",
    fetch: () => Promise.reject(new Error("boom")),
    error: "network: boom",
    verdict: null,
    passed: false,
  },
];

Deno.test("judgeItem only passes a verbatim quote with an allowed passing verdict", async () => {
  const criterion = await loadCriterion("relay-complete@1");
  const judge = await loadJudgeDefinition();
  for (const c of cases) {
    const item = await judgeItem({ fetch: c.fetch, apiKey: "k" }, {
      check: "chk",
      criterion,
      input: INPUT,
      judge,
    });
    assertEquals(item.error, c.error, c.name);
    assertEquals(item.verdict, c.verdict, c.name);
    assertEquals(judgePassed(criterion, item), c.passed, c.name);
  }
});

Deno.test("judgeItem sends the criterion verdicts as the tool enum and prices usage", async () => {
  const criterion = await loadCriterion("asks-gap@1");
  const judge = await loadJudgeDefinition();
  let sent: {
    tools: { input_schema: { properties: { verdict: { enum: string[] } } } }[];
  } | undefined;
  const item = await judgeItem({
    fetch: (_url, init) => {
      sent = JSON.parse(init.body as string);
      return Promise.resolve(
        ok([verdictBlock("asks_gap", "Make a budget app")]),
      );
    },
    apiKey: "k",
  }, { check: "chk", criterion, input: INPUT, judge });
  assertEquals(
    sent?.tools[0].input_schema.properties.verdict.enum,
    criterion.verdicts,
  );
  assert(Math.abs(item.cost_usd - 0.6) < 1e-9);
  assertEquals(item.criterion, "asks-gap@1");
  assertEquals(item.judge, "judge@1");
});
