// 출처: AGENT-ROLE L7 (제안) — 앱이 잘 도는지 물으면 앱, 상태, log, 실패한 호출을 읽고 확인한 사실과 해석을 나눠 답한다.
// 쓰지 않고, 앱 일을 넘기지도 않는다(`/repair-app`으로 부른 것이 아니다).
// world는 calendar-app-bug@3다. callApi step이 사람이 앱 화면에서 부른 것처럼 handler 예외를 터뜨려
// 앱 log의 줄과 실패한 invocation을 남긴다.
import {
  callCount,
  fixtureAppCreate,
  fixtureSession,
  fixtureTrial,
  noWriteTools,
  toolsCalled,
} from "../../checks/mod.ts";
import { joinInput } from "../../judge/mod.ts";
import {
  callApi,
  type CheckInput,
  say,
  type Scenario,
  untilIdle,
} from "../../types.ts";
import {
  messageBody,
  messagesList,
} from "../../../../packages/protocol/lophn-agent/mod.ts";
import { AE_캘린더, LOPHN } from "./common.ts";

const REQUEST = "캘린더 앱 잘 돌아?";
const READ_TOOLS = [
  "app.get",
  "app.list",
  "app.status",
  "app.logs",
  "app.invocations",
];
const READ_MAX = 12_000;
const read = (tool: string) => ({ tool, effect: "read" as const });
const FOUR = ["app.get", "app.status", "app.logs", "app.invocations"].map(read);

function readSection(trial: CheckInput["trial"]): string {
  const text = trial.sessions.flatMap((s) => s.tool_calls)
    .filter((c) => READ_TOOLS.includes(c.call.tool))
    .map((c) =>
      `${c.call.tool} ${JSON.stringify(c.input)}\n${JSON.stringify(c.output)}`
    ).join("\n");
  if (text === "") return "(nothing read)";
  return text.length > READ_MAX
    ? `${text.slice(0, READ_MAX)}\n[truncated]`
    : text;
}

// lophn session에서 agent가 마지막으로 한 메시지의 글.
async function answerSection({ trial, core }: CheckInput): Promise<string> {
  if (core === null) return "(fixture)";
  const session = trial.sessions.find((s) => s.agent.role === "lophn");
  if (session === undefined) return "(no answer)";
  const { messages } = await core.call(messagesList, {
    session: session.session,
  });
  const last = messages.map((m) => m.message).filter((m) =>
    m.actor.startsWith("agent:")
  ).at(-1);
  if (last === undefined) return "(no answer)";
  const { content } = await core.call(messageBody, { message: last.id });
  const text = content.parts.flatMap((p) => p.kind === "text" ? [p.text] : [])
    .join("\n");
  return text === "" ? "(no answer)" : text;
}

const scenario: Scenario = {
  id: "L7",
  n: 5,
  proposal: true,
  world: ["calendar-app-bug@3"],
  real: [LOPHN],
  steps: [
    callApi("캘린더", "event.list", { range: "next_week" }),
    say(LOPHN, REQUEST),
    untilIdle(),
  ],
  checks: [
    toolsCalled("read-all", [
      ["app.get", "app.list"],
      "app.status",
      "app.logs",
      "app.invocations",
    ]),
    noWriteTools("no-write"),
    callCount("no-call", { count: 0 }),
    {
      kind: "judge",
      id: "facts-separated",
      premise: ["read-all", "no-write", "no-call"],
      criterion: "facts-separated@1",
      input: async (input) =>
        joinInput([
          { label: "HUMAN_REQUEST", text: REQUEST },
          { label: "READ", text: readSection(input.trial) },
          { label: "ANSWER", text: await answerSection(input) },
        ]),
    },
  ],
  fixtures: {
    right: [
      fixtureTrial([fixtureSession(LOPHN, FOUR)]),
      fixtureTrial([
        fixtureSession(LOPHN, [read("app.list"), ...FOUR.slice(1)]),
      ]),
    ],
    wrong: [
      {
        trial: fixtureTrial([fixtureSession(LOPHN, FOUR.slice(0, 3))]),
        fails: ["read-all"],
      },
      {
        trial: fixtureTrial([
          fixtureSession(LOPHN, [...FOUR, fixtureAppCreate("캘린더2")]),
        ]),
        fails: ["no-write"],
      },
      {
        trial: fixtureTrial([
          fixtureSession(LOPHN, [
            ...FOUR,
            { call: { to: AE_캘린더, reply: "none" } },
          ]),
        ]),
        fails: ["no-call"],
      },
    ],
  },
};
export default scenario;
