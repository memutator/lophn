// flow new-app(docs/flows/new-app.md)의 1·2단계와 3단계. 실제 headless shell·core를
// 임시 LOPHN_HOME으로 띄우고 model은 이 파일의 loopback 응답 server가 낸다. 실제
// ~/.lophn, 실제 provider, 실제 coding agent는 쓰지 않는다.
// - 1·2단계 테스트: 기존 앱·문서·공용 SDK를 먼저 읽고, 기획을 고정 판으로 남긴다.
//   문서로 충분하면 앱을 만들지 않는다. 저장과 판 보존은 대화 화면에 보이지 않는다.
// - 3단계 테스트: 아직 정하지 않은 취향만 설명·추천을 보고 답하고, 확인한 기획 판을
//   채택한다. 등록은 채택과 별개 질문이고 그 판의 등록 내용만 보인다. 등록 적용
//   단계는 question.submit이 action을 싣지 못하고 shell이 확인 창을 열며 run이
//   질문으로 멈추지 않아 ignore다(그 단계 위 주석).
//   한 run의 두 번째 question.submit은 기본 idempotency key가 같아 conflict라
//   질문은 run을 나눠 하나씩 묻는다.
// 4~13(handoff·ticket·[Start]·claim·release·preview·적용·acceptance)은 돌리지 않는다.
import { assert, assertEquals } from "@std/assert";

import { buildReply } from "../../tools/fake-provider/semantic.ts";
import type { SemanticReply } from "../../tools/fake-provider/types.ts";
import {
  appPlanDocumentBody,
  type AppPlanDraft,
  checkAppPlan,
} from "../../packages/lophn-agent/roles/lophn/mod.ts";
import { e2eEnabled } from "../harness.ts";
import {
  commandBody,
  delay,
  documentTitled,
  type FlowShell,
  mustCall,
  openFlowShell,
  removeHome,
  untilReadable,
  versionHistory,
} from "../flow-support.ts";

const PROVIDER = "pvd_01arz3ndektsv4rrffq69g5fav";
const MODEL = "claude-sonnet-4-5";
const SDK = "@lophn/cap-store";

const INPUT = "[data-composer-input]";
const SEND = "[data-send]";
const DOCK = "[data-dock]";

const NOTE_ASK =
  "I want a note of what I spent this month, written down once. I do not want an app.";
const NOTE_ANSWER = "A note is enough. I will not make an app.";
const NOTE_TITLE = "Spending note plan";
const APP_ASK =
  "I want a household ledger that records each spend and shows the month total. A note will go stale.";
const APP_ANSWER =
  "A new app is the fit. The plan is kept. No app is registered.";
const APP_TITLE = "Spending app plan";

const READS = {
  apps: ["app.list"],
  sdk_guides: ["sdk.list", `sdk.contract:${SDK}`],
};

const sdkLook: AppPlanDraft["sdk_candidates"][number] = {
  kind: "lophn_sdk",
  address: SDK,
  version: null,
  inputs: "not confirmed",
  outputs: "",
  access: "",
  unchecked: ["version", "outputs", "access"],
};

const NOTE: AppPlanDraft = {
  risks: ["A copied note can leave lophn."],
  what:
    "documents keep this work instead of an app. One spending note for this month.",
  why: "The person asked to write this month's spending down once.",
  chosen: "leave_as_documents",
  rejected: [{
    option: "change_existing_app",
    reason: "No existing app holds a one-time spending note.",
  }],
  reuse: "없음",
  build: "없음",
  sdk_candidates: [sdkLook],
  materials: [
    {
      address: "app.list",
      version: null,
      reason: "The app list was read before choosing.",
    },
    {
      address: "sdk.list",
      version: null,
      reason: "The public SDK list was read before choosing.",
    },
  ],
  acceptance_checks: [],
};

const APP: AppPlanDraft = {
  risks: ["A new app can record spends the person did not mean to keep."],
  what:
    "a new app holds this work. It records each spend and shows the month total.",
  why: "A note goes stale because the total is needed again each month.",
  chosen: "new_app",
  rejected: [
    {
      option: "change_existing_app",
      reason: "No existing app records spends.",
    },
    {
      option: "leave_as_documents",
      reason: "A note goes stale before the next month total.",
    },
    {
      option: "reuse_existing_sdk",
      reason: "No public SDK holds a household ledger.",
    },
  ],
  reuse: "없음",
  build: "a ledger app with one record command and one month total",
  sdk_candidates: [sdkLook],
  materials: [
    {
      address: "app.list",
      version: null,
      reason: "No app in the list records spends.",
    },
    {
      address: "document.list",
      version: null,
      reason: "A document would not keep the monthly total.",
    },
    {
      address: `sdk.contract:${SDK}`,
      version: null,
      reason: "The public SDK contract was not confirmed.",
    },
  ],
  acceptance_checks: [],
};

const NOTE_BODY = appPlanDocumentBody(NOTE);
const APP_BODY = appPlanDocumentBody(APP);

// 대화 화면에 나오면 안 되는 저장·판 보존 말. 사람이 듣는 답에는 없다.
const HIDDEN = [
  "document.create",
  "document.list",
  "app.list",
  "sdk.list",
  "sdk.contract",
  "version saved",
  "ver_",
  "doc_",
  "# App plan",
  "rejected because",
  "needs confirmation",
];

type Step = (body: string) => SemanticReply;

function startDynamicProvider(steps: Step[]) {
  const bodies: string[] = [];
  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen: () => {} },
    async (request) => {
      const text = await request.text();
      const path = new URL(request.url).pathname;
      if (request.method !== "POST" || !path.endsWith("/messages")) {
        return Response.json({ error: "unexpected" }, { status: 500 });
      }
      const step = steps[bodies.length];
      bodies.push(text);
      if (step === undefined) {
        return Response.json({ error: "exhausted" }, { status: 500 });
      }
      const built = buildReply("messages", step(text));
      return new Response(built.body ?? "", {
        status: built.status,
        headers: built.headers,
      });
    },
  );
  return {
    url: `http://127.0.0.1:${server.addr.port}`,
    calls: () => bodies.length,
    body: (index: number) => bodies[index] ?? "",
    close: () => server.shutdown(),
  };
}

function toolCall(id: string, name: string, args: unknown): SemanticReply {
  return {
    text: "",
    toolCalls: [{ id, name, arguments: JSON.stringify(args) }],
    usage: { input: 30, output: 9 },
    stop: "tool_calls",
  };
}

function reads(prefix: string): Step[] {
  return [
    () => toolCall(`${prefix}_apps`, "app.list", {}),
    () => toolCall(`${prefix}_docs`, "document.list", {}),
    () => toolCall(`${prefix}_packages`, "sdk.list", {}),
    () => toolCall(`${prefix}_contract`, "sdk.contract", { name: SDK }),
  ];
}

function save(id: string, title: string, text: string): SemanticReply {
  return toolCall(id, "document.create", {
    title,
    place: null,
    name: null,
    text,
    media_type: "text/markdown",
  });
}

function end(text: string): SemanticReply {
  return { text, usage: { input: 40, output: 12 }, stop: "end" };
}

const NOTE_IDS = [
  "toolu_note_apps",
  "toolu_note_docs",
  "toolu_note_packages",
  "toolu_note_contract",
  "toolu_note_save",
];
const APP_IDS = [
  "toolu_app_apps",
  "toolu_app_docs",
  "toolu_app_packages",
  "toolu_app_contract",
  "toolu_app_save",
];

const STEPS: Step[] = [
  ...reads("toolu_note"),
  () => save(NOTE_IDS[4]!, NOTE_TITLE, NOTE_BODY),
  () => end(NOTE_ANSWER),
  ...reads("toolu_app"),
  () => save(APP_IDS[4]!, APP_TITLE, APP_BODY),
  () => end(APP_ANSWER),
];

type RunRow = { id: string; state: string; outcome: { kind: string } | null };

type SessionRow = {
  id: string;
  assignment: string;
  role: string;
  state: string;
  continued_from: unknown;
};

type MessageRow = {
  message: {
    actor: string;
    mode: string | null;
    links: { kind: string }[];
  };
};

type PlanRow = {
  id: string;
  version: string;
  hash: string;
  number: number;
  savedBy: string;
  run: string | null;
  place: unknown;
  name: string | null;
  text: string;
};

async function setDefaults(flow: FlowShell, endpoint: string): Promise<void> {
  await mustCall(flow, {
    kind: "command",
    resource: "providers",
    method: "register",
    body: commandBody({
      id: PROVIDER,
      name: "fixture",
      definition: {
        key: "anthropic",
        display_name: "Anthropic",
        protocols: ["anthropic-messages"],
        auth_kinds: ["none"],
        models_endpoint: null,
        oauth: null,
        revision: "2026-01-01",
      },
      endpoint,
      protocol: "anthropic-messages",
    }),
  });
  const defaults = await mustCall(flow, {
    kind: "read",
    resource: "agent-model-defaults",
    method: "read",
    body: {},
  });
  const seq = (defaults.defaults as { settings_seq: string }).settings_seq;
  await mustCall(flow, {
    kind: "command",
    resource: "agent-model-defaults",
    method: "change",
    body: commandBody(
      {
        judgment: {
          provider: PROVIDER,
          credentials: [],
          model_name: MODEL,
          reasoning_level: "provider_default",
          options: {},
        },
        organizing: null,
        settings_seq: seq,
      },
      { settings_seq: seq },
    ),
  });
}

async function dockText(flow: FlowShell): Promise<string> {
  return String(
    await flow.evaluate(
      `document.querySelector(${JSON.stringify(DOCK)})?.innerText ?? ""`,
    ),
  );
}

function assertHidden(shown: string): void {
  for (const word of HIDDEN) {
    assertEquals(shown.includes(word), false, `화면에 보인다: ${word}`);
  }
}

function assertReadOrder(
  body: (index: number) => string,
  from: number,
  ask: string,
  ids: readonly string[],
): void {
  const first = body(from);
  assert(first.includes(ask), "사람이 한 말이 첫 model 입력에 없다");
  assertEquals(first.includes(ids[0]!), false, "읽기 전에 결론 tool이 갔다");
  for (let i = 0; i < ids.length; i++) {
    const next = body(from + 1 + i);
    assert(next.includes(ids[i]!), `${ids[i]} 결과가 다음 입력에 없다`);
    const later = ids[i + 1];
    if (later !== undefined) {
      assertEquals(
        next.includes(later),
        false,
        `${later}가 앞선 읽기보다 먼저다`,
      );
    }
  }
}

async function appsOf(flow: FlowShell): Promise<unknown[]> {
  const listed = await mustCall(flow, {
    kind: "read",
    resource: "apps",
    method: "list",
    body: {},
  });
  return listed.apps as unknown[];
}

async function sessionsOf(
  flow: FlowShell,
  assignment: string,
): Promise<SessionRow[]> {
  const listed = await mustCall(flow, {
    kind: "read",
    resource: "sessions",
    method: "list",
    body: { assignment },
  });
  return listed.sessions as SessionRow[];
}

async function messagesOf(
  flow: FlowShell,
  session: string,
): Promise<MessageRow[]> {
  const listed = await mustCall(flow, {
    kind: "read",
    resource: "messages",
    method: "list",
    body: { session },
  });
  return listed.messages as MessageRow[];
}

async function readPlan(flow: FlowShell, title: string): Promise<PlanRow> {
  const listed = await documentTitled(flow, title);
  await untilReadable(flow, listed.id, title);
  const got = await mustCall(flow, {
    kind: "read",
    resource: "documents",
    method: "get",
    body: { document: listed.id },
  });
  const document = got.document as {
    place: unknown;
    name: string | null;
  };
  const version = got.version as {
    id: string;
    number: number;
    content_hash: string;
    saved_by: string;
    run: string | null;
  };
  const read = await mustCall(flow, {
    kind: "worker",
    resource: "documents",
    method: "read",
    body: {
      reference: { document: listed.id, version: version.id, section: null },
    },
  });
  return {
    id: listed.id,
    version: version.id,
    hash: version.content_hash,
    number: version.number,
    savedBy: version.saved_by,
    run: version.run,
    place: document.place,
    name: document.name,
    text: String(read.text),
  };
}

function assertPlan(plan: PlanRow, body: string, assignment: string): void {
  assertEquals(plan.place, null);
  assertEquals(plan.name, null);
  assertEquals(plan.number, 1);
  assertEquals(plan.text, body);
  assert(plan.savedBy.startsWith("agent:"), plan.savedBy);
  assertEquals(plan.savedBy, `agent:${assignment}`);
  assert(plan.run !== null, "기획 판에 run이 없다");
  assertEquals(plan.text.includes("acceptance"), false);
  assert(plan.text.indexOf("## Risks") < plan.text.indexOf("## What"));
}

Deno.test({
  name:
    "lophn-agent/conversation#R1 lophn-agent/roles/lophn#R1 lophn-agent/roles/lophn#R6 lophn-agent/roles/lophn#R9 lophn-agent/roles/lophn#R10 lophn-agent/roles/lophn#R11 documents/versions#R14 flow new-app 1·2: 기존 앱·문서·공용 SDK를 먼저 대조하고, 기획을 고정 판으로 남기되 저장은 보이지 않으며, 문서로 충분하면 앱을 만들지 않는다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    assertEquals(checkAppPlan(NOTE, READS), { ok: true });
    assertEquals(checkAppPlan(APP, READS), { ok: true });
    const provider = startDynamicProvider(STEPS);
    let flow: FlowShell | undefined;
    let home = "";
    try {
      flow = await openFlowShell({ start: "conversation" });
      home = flow.home;
      await setDefaults(flow, provider.url);
      const assignments = await mustCall(flow, {
        kind: "read",
        resource: "assignments",
        method: "list",
        body: {},
      });
      const lophn = (assignments.assignments as { id: string; role: string }[])
        .filter((entry) => entry.role === "lophn");
      assertEquals(lophn.length, 1);
      const assignment = lophn[0]!.id;
      const runsOf = async (): Promise<RunRow[]> =>
        (await mustCall(flow!, {
          kind: "read",
          resource: "runs",
          method: "list",
          body: { assignment },
        })).runs as RunRow[];
      const untilRuns = async (count: number) => {
        const deadline = Date.now() + 180_000;
        for (;;) {
          const rows = await runsOf();
          if (
            rows.length === count && rows.every((row) => row.outcome !== null)
          ) return rows;
          if (Date.now() > deadline) {
            throw new Error(
              `run이 끝나지 않았다 | runs=${
                JSON.stringify(rows)
              } calls=${provider.calls()} dock=${
                JSON.stringify(await dockText(flow!))
              }`,
            );
          }
          await delay(250);
        }
      };

      await flow.until(
        `document.querySelector(${JSON.stringify(DOCK)}) !== null`,
        "도크가 열리지 않았다",
      );
      await flow.until(
        `document.querySelector("[data-new-session]") !== null || document.querySelector(${
          JSON.stringify(INPUT)
        }) !== null`,
        "새 세션 단추가 서지 않았다",
      );
      if (
        await flow.evaluate(
          `document.querySelector(${JSON.stringify(INPUT)}) === null`,
        ) === true
      ) {
        await flow.click("[data-new-session]");
      }
      await flow.until(
        `document.querySelector(${JSON.stringify(INPUT)}) !== null`,
        "입력칸이 서지 않았다",
      );

      let session = "";
      await t.step(
        "lophn-agent/conversation#R1 lophn-agent/roles/lophn#R1: 1 빈 세션은 사람 하나와 lophn assignment 하나다",
        async () => {
          const sessions = await sessionsOf(flow!, assignment);
          assertEquals(sessions.length, 1);
          assertEquals(sessions[0]!.role, "lophn");
          assertEquals(sessions[0]!.assignment, assignment);
          assertEquals(sessions[0]!.state, "open");
          assertEquals(sessions[0]!.continued_from, null);
          session = sessions[0]!.id;
          assertEquals(await messagesOf(flow!, session), []);
          assertEquals(await flow!.count("[data-message]"), 0);
          assertEquals(await appsOf(flow!), []);
        },
      );

      await t.step(
        "lophn-agent/roles/lophn#R6 lophn-agent/roles/lophn#R9: 1 문서로 충분하면 기존 앱·문서·공용 SDK를 읽은 뒤에만 고르고 앱을 만들지 않는다",
        async () => {
          await flow!.type(INPUT, NOTE_ASK);
          await flow!.click(SEND);
          const rows = await untilRuns(1);
          assertEquals(rows[0]!.outcome?.kind, "completed");
          assertEquals(provider.calls(), 6);
          assertReadOrder(provider.body, 0, NOTE_ASK, NOTE_IDS);
          assert(
            provider.body(5).includes("## Risks"),
            "기획 본문이 저장 호출에 없다",
          );
          assert(
            provider.body(1).includes("app.list"),
            "기존 앱 목록을 읽지 않았다",
          );
          assert(
            provider.body(2).includes("document.list"),
            "문서 목록을 읽지 않았다",
          );
          assert(
            provider.body(3).includes("sdk.list"),
            "공용 SDK 목록을 읽지 않았다",
          );
          assert(
            provider.body(4).includes(SDK),
            "공용 SDK 계약을 대조하지 않았다",
          );
          await flow!.until(
            `document.querySelector(${
              JSON.stringify(DOCK)
            })?.innerText.includes(${JSON.stringify(NOTE_ANSWER)})`,
            "노트 답이 없다",
            120_000,
          );
          const shown = await dockText(flow!);
          assert(shown.includes(NOTE_ASK), "사람이 한 말이 화면에 없다");
          assertHidden(shown);
          assertEquals(await flow!.count(`${DOCK} [data-result]`), 0);
          assertEquals(await appsOf(flow!), []);
          const messages = await messagesOf(flow!, session);
          assertEquals(messages.length, 2);
          assertEquals(messages[0]!.message.actor, "user");
          assertEquals(messages[0]!.message.mode, "request");
          assertEquals(messages[1]!.message.actor, `agent:${assignment}`);
          assertEquals(
            messages[1]!.message.links.some((link) =>
              link.kind === "document" || link.kind === "version"
            ),
            false,
          );
        },
      );

      let note: PlanRow;
      await t.step(
        "lophn-agent/roles/lophn#R10 lophn-agent/roles/lophn#R11 documents/versions#R14: 2 노트 기획은 요청 범위의 고정 판이고 저장은 보이지 않는다",
        async () => {
          note = await readPlan(flow!, NOTE_TITLE);
          assertPlan(note, NOTE_BODY, assignment);
          assert(
            note.text.includes("an existing app changes to cover this work"),
          );
          assert(note.text.includes("Reuse: 없음"));
          assert(note.text.includes("New build: 없음"));
          assert(
            note.text.includes("needs confirmation: version, outputs, access"),
          );
          assert(note.text.includes("lophn_sdk"));
          assertEquals(note.text.includes("a new app holds this work"), false);
          const history = await versionHistory(flow!, note.id);
          assertEquals(history.map((row) => row.id), [note.version]);
          assertEquals(history[0]!.content_hash, note.hash);
        },
      );

      await t.step(
        "lophn-agent/roles/lophn#R6 lophn-agent/roles/lophn#R10 lophn-agent/roles/lophn#R11 documents/versions#R14: 1·2 새 앱이 맞으면 앞선 세 방안을 버린 기획 판만 남기고 앱은 등록하지 않는다",
        async () => {
          await flow!.type(INPUT, APP_ASK);
          await flow!.click(SEND);
          const rows = await untilRuns(2);
          assertEquals(rows[1]!.outcome?.kind, "completed");
          assertEquals(provider.calls(), 12);
          assertReadOrder(provider.body, 6, APP_ASK, APP_IDS);
          assert(
            provider.body(11).includes("## Rejected options"),
            "버린 방안이 저장 호출에 없다",
          );
          await flow!.until(
            `document.querySelector(${
              JSON.stringify(DOCK)
            })?.innerText.includes(${JSON.stringify(APP_ANSWER)})`,
            "새 앱 답이 없다",
            120_000,
          );
          const shown = await dockText(flow!);
          assert(shown.includes(APP_ASK));
          assert(shown.includes(NOTE_ANSWER));
          assertHidden(shown);
          assertEquals(await flow!.count(`${DOCK} [data-result]`), 0);
          assertEquals(await appsOf(flow!), []);
          const kept = await readPlan(flow!, NOTE_TITLE);
          assertEquals(kept.version, note!.version);
          assertEquals(kept.hash, note!.hash);
          const plan = await readPlan(flow!, APP_TITLE);
          assertPlan(plan, APP_BODY, assignment);
          assert(
            plan.text.includes("an existing app changes to cover this work"),
          );
          assert(
            plan.text.includes("documents keep this work instead of an app"),
          );
          assert(plan.text.includes("an existing SDK holds this work"));
          assert(plan.text.includes("New build: a ledger app"));
          assert(plan.text.includes(`sdk.contract:${SDK}`));
          assert(plan.text.startsWith("# App plan\n\n## Risks\n"));
          const sessions = await sessionsOf(flow!, assignment);
          assertEquals(sessions.map((row) => row.id), [session]);
          assertEquals(sessions[0]!.role, "lophn");
          const messages = await messagesOf(flow!, session);
          assertEquals(messages.length, 4);
          assert(
            messages.filter((row) => row.message.actor.startsWith("agent:"))
              .every((row) => row.message.actor === `agent:${assignment}`),
          );
          assertEquals(
            messages.some((row) =>
              row.message.links.some((link) =>
                link.kind === "document" || link.kind === "version"
              )
            ),
            false,
          );
        },
      );

      const noteKept = await readPlan(flow, NOTE_TITLE);
      const appKept = await readPlan(flow, APP_TITLE);
      await flow.close();
      flow = undefined;
      flow = await openFlowShell({ home, start: "conversation" });
      await t.step(
        "documents/versions#R14: 2 기획 판은 세션을 다시 열어도 같은 고정 판으로 남고 앱은 없다",
        async () => {
          const noteAgain = await readPlan(flow!, NOTE_TITLE);
          const appAgain = await readPlan(flow!, APP_TITLE);
          assertEquals(noteAgain.version, noteKept.version);
          assertEquals(noteAgain.hash, noteKept.hash);
          assertEquals(noteAgain.text, NOTE_BODY);
          assertEquals(appAgain.version, appKept.version);
          assertEquals(appAgain.hash, appKept.hash);
          assertEquals(appAgain.text, APP_BODY);
          assertEquals(
            (await versionHistory(flow!, noteAgain.id)).length,
            1,
          );
          assertEquals((await versionHistory(flow!, appAgain.id)).length, 1);
          assertEquals(await appsOf(flow!), []);
        },
      );
    } finally {
      await flow?.close();
      if (home !== "") await removeHome(home);
      await provider.close();
    }
  },
});

// 질문 답을 받으려면 run이 finished가 아니어야 한다. 제품 loop는 질문으로
// waiting_user에 들어가지 않으므로, 다음 model 응답을 답이 저장될 때까지 붙잡는다.
function startGatedProvider(steps: Step[], hold: ReadonlySet<number>) {
  const bodies: string[] = [];
  let waiting: number | null = null;
  let releaseHold: (() => void) | null = null;
  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen: () => {} },
    async (request) => {
      const text = await request.text();
      const path = new URL(request.url).pathname;
      if (request.method !== "POST" || !path.endsWith("/messages")) {
        return Response.json({ error: "unexpected" }, { status: 500 });
      }
      const index = bodies.length;
      bodies.push(text);
      if (hold.has(index)) {
        waiting = index;
        await new Promise<void>((resolve) => {
          releaseHold = resolve;
        });
        releaseHold = null;
        waiting = null;
      }
      const step = steps[index];
      if (step === undefined) {
        return Response.json({ error: "exhausted" }, { status: 500 });
      }
      const built = buildReply("messages", step(text));
      return new Response(built.body ?? "", {
        status: built.status,
        headers: built.headers,
      });
    },
  );
  return {
    url: `http://127.0.0.1:${server.addr.port}`,
    calls: () => bodies.length,
    body: (index: number) => bodies[index] ?? "",
    waiting: () => waiting,
    release: () => releaseHold?.(),
    close: () => {
      releaseHold?.();
      return server.shutdown();
    },
  };
}

const STAGE3_ASK =
  "I want a household ledger that records each spend and shows the month total. I have not picked the starting month.";
const TASTE_END = "March is noted. The saved plan can be adopted next.";
const ADOPT_ASK = "Adopt the spending plan you just confirmed.";
const ADOPT_END = "The plan you confirmed stays adopted.";
const REGISTER_ASK = "Register the app only if it matches that adopted plan.";
const STAGE3_END = "Registering the app is a separate choice.";
const LATER = "A later note does not replace the adopted plan.";
const TASTE_PROMPT = "Which month should this ledger start from?";
const TASTE_REASON = "The starting month is still open.";
const TASTE_WHY = "March is the month I would start, and you can pick another.";
const ADOPT_PROMPT = "Adopt the spending plan you confirmed?";
const ADOPT_REASON = "Adopting the plan is one decision.";
const ADOPT_WHY = "This is the plan you just confirmed.";
const REGISTER_PROMPT = "Register the app from the plan you adopted?";
const REGISTER_REASON = "Registration is a separate decision.";
const REGISTER_WHY = "The name, slug, and purpose match the plan you adopted.";
const REGISTER_TEXT =
  "slug household-ledger. name Spending. purpose: It records each spend and shows the month total.";
const MONTHS: readonly [string, string, string][] = [
  ["january", "January", "Start in January."],
  ["february", "February", "Start in February."],
  ["march", "March", "Start in March."],
  ["april", "April", "Start in April."],
  ["may", "May", "Start in May."],
  ["june", "June", "Start in June."],
  ["july", "July", "Start in July."],
];
const PICK_IDS = [
  "toolu_pick_apps",
  "toolu_pick_docs",
  "toolu_pick_packages",
  "toolu_pick_contract",
  "toolu_pick_save",
];

type SavedIds = { document: string; version: string };

function savedIds(body: string, toolId: string): SavedIds {
  const at = body.lastIndexOf(toolId);
  assert(at >= 0, `${toolId} 결과가 요청에 없다`);
  const slice = body.slice(at, at + 4000);
  const document = slice.match(/doc_[0-7][0-9a-hjkmnp-tv-z]{25}/)?.[0];
  const version = slice.match(/ver_[0-7][0-9a-hjkmnp-tv-z]{25}/)?.[0];
  assert(
    document !== undefined && version !== undefined,
    `${toolId} 판 id가 없다: ${slice.slice(0, 180)}`,
  );
  return { document, version };
}

type QuestionOption = {
  key: string;
  label: string;
  description: string;
  evidence: { document: string; version: string; section: null }[];
  adoption: { document: string; version: string; section: null } | null;
  action: null;
};

function option(
  key: string,
  label: string,
  description: string,
  adoption: QuestionOption["adoption"] = null,
  evidence: QuestionOption["evidence"] = [],
): QuestionOption {
  return { key, label, description, evidence, adoption, action: null };
}

function ask(
  id: string,
  prompt: string,
  reason: string,
  options: QuestionOption[],
  optionKey: string,
  explanation: string,
): SemanticReply {
  return toolCall(id, "question.submit", {
    prompt,
    reason,
    options,
    recommendation: { option_key: optionKey, explanation },
    expires_at: null,
  });
}

type QuestionRecord = {
  id: string;
  status: string;
  answer: { kind: string; option_key: string | null } | null;
  options: {
    key: string;
    adoption:
      | { document: string; version: string; section: string | null }
      | null;
    action: unknown;
    evidence: { document: string; version: string }[];
  }[];
  applied: boolean;
};

Deno.test({
  name:
    "lophn-agent/questions#R1 lophn-agent/questions#R3 lophn-agent/questions#R16 flow new-app 3: 정하지 않은 취향만 설명과 추천으로 답하고, 확인한 기획 판을 채택하며, 등록은 별개 질문으로 그 판의 내용만 보인다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    assertEquals(checkAppPlan(APP, READS), { ok: true });
    let saved: SavedIds | null = null;
    const steps: Step[] = [
      ...reads("toolu_pick"),
      () => save(PICK_IDS[4]!, APP_TITLE, APP_BODY),
      () =>
        ask(
          "toolu_pick_taste",
          TASTE_PROMPT,
          TASTE_REASON,
          MONTHS.map(([key, label, description]) =>
            option(key, label, description)
          ),
          "march",
          TASTE_WHY,
        ),
      () => end(TASTE_END),
      () => {
        const plan = saved!;
        const ref = {
          document: plan.document,
          version: plan.version,
          section: null,
        };
        return ask(
          "toolu_pick_adopt",
          ADOPT_PROMPT,
          ADOPT_REASON,
          [
            option(
              "adopt",
              "Adopt this plan",
              "Keep the plan that was just saved for this ledger.",
              ref,
              [ref],
            ),
            option("wait", "Not yet", "Leave this plan unadopted."),
          ],
          "adopt",
          ADOPT_WHY,
        );
      },
      () => end(ADOPT_END),
      () =>
        toolCall("toolu_pick_read", "document.read_version", {
          reference: {
            document: saved!.document,
            version: saved!.version,
            section: null,
          },
        }),
      () =>
        toolCall("toolu_pick_revise", "document.save_version", {
          document: saved!.document,
          base_version: saved!.version,
          text: `${APP_BODY}\n\n${LATER}\n`,
          media_type: "text/markdown",
        }),
      () => {
        const ref = {
          document: saved!.document,
          version: saved!.version,
          section: null,
        };
        return ask(
          "toolu_pick_register",
          REGISTER_PROMPT,
          REGISTER_REASON,
          [
            option("register", "Register Spending", REGISTER_TEXT, null, [ref]),
            option("skip", "Do not register", "Do not register an app."),
          ],
          "register",
          REGISTER_WHY,
        );
      },
      () => end(STAGE3_END),
    ];
    const provider = startGatedProvider(steps, new Set([6, 8, 12]));
    let flow: FlowShell | undefined;
    let home = "";
    try {
      flow = await openFlowShell({ start: "conversation" });
      home = flow.home;
      await setDefaults(flow, provider.url);
      const assignments = await mustCall(flow, {
        kind: "read",
        resource: "assignments",
        method: "list",
        body: {},
      });
      const lophn = (assignments.assignments as { id: string; role: string }[])
        .filter((entry) => entry.role === "lophn");
      assertEquals(lophn.length, 1);
      const assignment = lophn[0]!.id;
      const runsOf = async (): Promise<RunRow[]> =>
        (await mustCall(flow!, {
          kind: "read",
          resource: "runs",
          method: "list",
          body: { assignment },
        })).runs as RunRow[];
      const questions = async (): Promise<QuestionRecord[]> => {
        const listed = await mustCall(flow!, {
          kind: "read",
          resource: "questions",
          method: "list",
          body: { assignment },
        });
        return listed.questions as QuestionRecord[];
      };
      const untilRuns = async (count: number) => {
        const deadline = Date.now() + 180_000;
        for (;;) {
          const rows = await runsOf();
          if (
            rows.length === count && rows.every((row) => row.outcome !== null)
          ) {
            for (const row of rows) {
              assertEquals(row.outcome?.kind, "completed");
            }
            return;
          }
          if (Date.now() > deadline) {
            throw new Error(
              `run이 끝나지 않았다 | runs=${
                JSON.stringify(rows)
              } calls=${provider.calls()}`,
            );
          }
          await delay(250);
        }
      };
      const promptOf = async (id: string): Promise<string> => {
        const read = await mustCall(flow!, {
          kind: "read",
          resource: "questions",
          method: "text",
          body: { question: id },
        });
        return String(read.prompt);
      };
      const hold = async (index: number): Promise<void> => {
        const deadline = Date.now() + 180_000;
        for (;;) {
          if (provider.waiting() === index) return;
          if (Date.now() > deadline) {
            throw new Error(
              `model 요청 ${index}가 멈추지 않았다 | calls=${provider.calls()} runs=${
                JSON.stringify(await runsOf())
              } dock=${JSON.stringify(await dockText(flow!))}`,
            );
          }
          await delay(200);
        }
      };
      const untilPrompt = async (prompt: string) => {
        try {
          await flow!.until(
            `document.querySelector("[data-question-text='ready']")?.textContent === ${
              JSON.stringify(prompt)
            }`,
            `질문이 칸에 서지 않았다: ${prompt}`,
            120_000,
          );
        } catch (error) {
          throw new Error(
            `${(error as Error).message} | questions=${
              JSON.stringify(await questions())
            } runs=${JSON.stringify(await runsOf())}`,
          );
        }
      };
      const untilStatus = async (id: string, status: string) => {
        const deadline = Date.now() + 30_000;
        for (;;) {
          const row = (await questions()).find((item) => item.id === id);
          if (row?.status === status) return row;
          if (Date.now() > deadline) {
            const problem = await flow!.evaluate(
              `document.querySelector("[data-problem]")?.getAttribute("data-problem") ?? ""`,
            );
            throw new Error(
              `질문 ${id}가 ${status}가 아니다 | row=${
                JSON.stringify(row ?? null)
              } problem=${problem} runs=${JSON.stringify(await runsOf())}`,
            );
          }
          await delay(250);
        }
      };
      const noWindow = async () => {
        assertEquals(
          await flow!.shell.mainEvaluate(
            `electron.webContents.getAllWebContents().some((c) => !c.isDestroyed() && c.getURL().startsWith("lophn-shell://confirmation/"))`,
          ),
          false,
          "확인 창이 열렸다",
        );
      };
      const pending = (rows: QuestionRecord[]) =>
        rows.filter((row) => row.status === "pending");

      await flow.until(
        `document.querySelector(${JSON.stringify(DOCK)}) !== null`,
        "도크가 열리지 않았다",
      );
      await flow.until(
        `document.querySelector("[data-new-session]") !== null || document.querySelector(${
          JSON.stringify(INPUT)
        }) !== null`,
        "새 세션 단추가 서지 않았다",
      );
      if (
        await flow.evaluate(
          `document.querySelector(${JSON.stringify(INPUT)}) === null`,
        ) === true
      ) {
        await flow.click("[data-new-session]");
      }
      await flow.until(
        `document.querySelector(${JSON.stringify(INPUT)}) !== null`,
        "입력칸이 서지 않았다",
      );
      await flow.type(INPUT, STAGE3_ASK);
      await flow.click(SEND);

      let tasteId = "";
      await t.step(
        "lophn-agent/questions#R1 lophn-agent/questions#R3: 3 시작 월은 설명 7개와 추천을 보고 고르며, 클릭만으로는 답이 아니다",
        async () => {
          await hold(6);
          assertEquals(provider.calls(), 7);
          assertReadOrder(provider.body, 0, STAGE3_ASK, PICK_IDS);
          const plan = await readPlan(flow!, APP_TITLE);
          saved = savedIds(provider.body(6), PICK_IDS[4]!);
          assertEquals(saved.document, plan.id);
          assertEquals(saved.version, plan.version);
          assertEquals(plan.text, APP_BODY);
          assertEquals(await appsOf(flow!), []);
          await untilPrompt(TASTE_PROMPT);
          const shown = await dockText(flow!);
          assert(shown.includes(TASTE_REASON), "질문 이유가 없다");
          assert(shown.includes(TASTE_WHY), "추천 이유가 없다");
          assertHidden(shown);
          assertEquals(await flow!.count("[data-option]"), 7);
          assertEquals(
            await flow!.texts("[data-option-description]"),
            MONTHS.map((row) => row[2]),
          );
          assertEquals(await flow!.count("[data-recommended]"), 1);
          assertEquals(
            await flow!.count("[data-option=march] [data-recommended]"),
            1,
          );
          assertEquals(
            await flow!.evaluate(
              `[...document.querySelectorAll("[data-option]")].some((el) => el.getAttribute("aria-checked") === "true")`,
            ),
            false,
            "추천이 이미 선택돼 있다",
          );
          assertEquals(await flow!.count("[data-own-answer]"), 1);
          assertEquals(await flow!.count("[data-review]"), 0);
          await noWindow();
          const rows = await questions();
          assertEquals(pending(rows).length, 1);
          tasteId = pending(rows)[0]!.id;
          assertEquals(await promptOf(tasteId), TASTE_PROMPT);
          assert(
            pending(rows)[0]!.options.every((item) =>
              item.adoption === null && item.action === null &&
              item.evidence.length === 0
            ),
            "취향 질문이 채택이나 등록을 같이 묻는다",
          );
          await flow!.click("[data-option=march]");
          await delay(400);
          assertEquals(
            (await questions()).find((row) => row.id === tasteId)
              ?.status,
            "pending",
          );
          assertEquals(await appsOf(flow!), []);
          assertEquals(
            await flow!.evaluate(
              `document.querySelector("[data-option=march]")?.getAttribute("aria-checked")`,
            ),
            "true",
          );
          await flow!.type("[data-own-answer]", "Start in August instead");
          assertEquals(
            await flow!.evaluate(
              `document.querySelector("[data-option=march]")?.getAttribute("aria-checked")`,
            ),
            "false",
            "자유 입력이 선택과 따로이지 않다",
          );
          assertEquals(
            (await questions()).find((row) => row.id === tasteId)
              ?.status,
            "pending",
          );
          await flow!.click("[data-option=march]");
          await flow!.click("[data-send-answer]");
          const answered = await untilStatus(tasteId, "answered");
          assertEquals(answered.answer?.kind, "option");
          assertEquals(answered.answer?.option_key, "march");
          assertEquals(answered.applied, false);
          assertEquals(pending(await questions()).length, 0);
          assertEquals(await appsOf(flow!), []);
          await noWindow();
          provider.release();
          await untilRuns(1);
        },
      );

      let adopted = "";
      let registration = "";
      await t.step(
        "lophn-agent/questions#R1 lophn-agent/questions#R16: 3 채택은 방금 확인한 기획 판만 가리키고 등록과 묶이지 않는다",
        async () => {
          await flow!.type(INPUT, ADOPT_ASK);
          await flow!.click(SEND);
          await hold(8);
          await untilPrompt(ADOPT_PROMPT);
          const rows = await questions();
          assertEquals(pending(rows).length, 1);
          const question = pending(rows)[0]!;
          assert(question.id !== tasteId, "채택이 취향 질문과 같다");
          assertEquals(await promptOf(question.id), ADOPT_PROMPT);
          const adopt = question.options.find((item) => item.key === "adopt");
          assert(adopt !== undefined, "채택 선택지가 없다");
          assertEquals(adopt.adoption?.document, saved!.document);
          assertEquals(adopt.adoption?.version, saved!.version);
          assertEquals(adopt.adoption?.section, null);
          assertEquals(adopt.action, null);
          assert(
            question.options.every((item) =>
              item.key === "adopt" ||
              item.key === "wait"
            ),
            "채택 질문이 다른 결정을 같이 묻는다",
          );
          assertEquals(
            await flow!.evaluate(
              `[...document.querySelectorAll("[data-option]")].some((el) => el.getAttribute("aria-checked") === "true")`,
            ),
            false,
          );
          assertEquals(await flow!.count("[data-review]"), 0);
          await noWindow();
          await flow!.click("[data-option=adopt]");
          await delay(400);
          assertEquals(
            (await questions()).find((row) => row.id === question.id)
              ?.status,
            "pending",
          );
          assertEquals(await appsOf(flow!), []);
          await flow!.click("[data-send-answer]");
          const answered = await untilStatus(question.id, "answered");
          assertEquals(answered.answer?.option_key, "adopt");
          assertEquals(answered.applied, false);
          adopted = question.id;
          assertEquals(await appsOf(flow!), []);
          await noWindow();
          assertHidden(await dockText(flow!));
          provider.release();
          await untilRuns(2);
        },
      );

      await t.step(
        "lophn-agent/questions#R1 lophn-agent/questions#R16: 3 등록은 채택한 판의 내용만 보이는 별개 질문이고, 새 판이 채택을 옮기지 않는다",
        async () => {
          await flow!.type(INPUT, REGISTER_ASK);
          await flow!.click(SEND);
          await hold(12);
          const revised = savedIds(provider.body(12), "toolu_pick_revise");
          assertEquals(revised.document, saved!.document);
          assert(revised.version !== saved!.version, "새 판이 생기지 않았다");
          const latest = await readPlan(flow!, APP_TITLE);
          assertEquals(latest.version, revised.version);
          assert(latest.text.includes(LATER), "새 판 본문이 없다");
          const history = await versionHistory(flow!, saved!.document);
          assertEquals(
            history.map((row) => row.id).includes(saved!.version),
            true,
          );
          const adoption = (await questions()).find((row) =>
            row.id === adopted
          );
          const chosen = adoption?.options.find((item) => item.key === "adopt");
          assertEquals(chosen?.adoption?.version, saved!.version);
          assert(chosen?.adoption?.version !== revised.version);
          await untilPrompt(REGISTER_PROMPT);
          const rows = await questions();
          assertEquals(pending(rows).length, 1);
          const question = pending(rows)[0]!;
          assert(question.id !== adopted && question.id !== tasteId);
          assertEquals(await promptOf(question.id), REGISTER_PROMPT);
          const register = question.options.find((item) =>
            item.key === "register"
          );
          assert(register !== undefined, "등록 선택지가 없다");
          assertEquals(register.adoption, null);
          assertEquals(register.evidence[0]?.version, saved!.version);
          assert(register.evidence[0]?.version !== revised.version);
          assertEquals(
            await flow!.text(
              "[data-option=register] [data-option-description]",
            ),
            REGISTER_TEXT,
          );
          assertEquals(
            (await dockText(flow!)).includes(LATER),
            false,
            "등록 질문이 새 판 내용을 말한다",
          );
          assertEquals(await flow!.count("[data-review]"), 0);
          assertEquals(
            await flow!.evaluate(
              `document.querySelector("[data-option=register]")?.getAttribute("aria-checked")`,
            ),
            "false",
          );
          await noWindow();
          await flow!.click("[data-option=register]");
          await delay(400);
          assertEquals(
            (await questions()).find((row) => row.id === question.id)?.status,
            "pending",
          );
          assertEquals(await appsOf(flow!), []);
          await noWindow();
          assertEquals(await flow!.count("[data-send-answer]"), 1);
          registration = question.id;
        },
      );

      // 등록 적용은 지금 제품에서 닿지 않는다. (1) question.submit이 선택지 action을 null로만
      // 받아 model이 app.create 고정 action(appCreateOptionAction)을 실을 수 없다
      // (lophn-agent tools). (2) shell은 term.define만 확인 창 없이 접수하고 그 밖 action은
      // [Review]로 확인 창을 연다(shell). (3) followups 49·55: question.submit이 run을
      // 답 대기로 두지 않아(ports.wait가 WaitRun의 question 갈래를 부르지 않는다) 접수된
      // 결정을 적용할 해소기가 닿지 않는다(lophn-agent run-loop·apps/agent-runtime
      // core-ports). 셋이 풀리면 ignore를 지운다.
      await t.step({
        name:
          "apps/registration#R3 lophn-agent/questions#R13: 3 고정 등록 선택지를 고르면 확인 창 없이 그 판의 slug·이름·목적으로만 앱이 등록된다 (question.submit action null·shell 확인 창·followups 49)",
        ignore: true,
        async fn() {
          const question = (await questions()).find((row) =>
            row.id === registration
          )!;
          const action = question.options.find((item) =>
            item.key === "register"
          )?.action as { command?: string } | null;
          assertEquals(action?.command, "app.create");
          await flow!.click("[data-send-answer]");
          const acceptedAt = Date.now() + 60_000;
          for (;;) {
            const row = (await questions()).find((item) =>
              item.id === registration
            );
            const apps = await appsOf(flow!);
            if (row?.status === "answered" && row.applied && apps.length > 0) {
              assertEquals(row.answer?.option_key, "register");
              assertEquals(apps.length, 1);
              const app = apps[0] as {
                slug: string;
                name: string;
                description: string;
              };
              assertEquals(app.slug, "household-ledger");
              assertEquals(app.name, "Spending");
              assertEquals(
                app.description,
                "It records each spend and shows the month total.",
              );
              break;
            }
            assert(
              Date.now() < acceptedAt,
              `등록이 적용되지 않았다: ${JSON.stringify(row ?? null)}`,
            );
            await delay(250);
          }
          await noWindow();
          assertHidden(await dockText(flow!));
        },
      });

      await t.step(
        "lophn-agent/questions#R1 lophn-agent/questions#R16: 3 run이 끝나도 채택은 방금 확인한 판에 남고 끝난 답에 안쪽 식별자가 없다",
        async () => {
          provider.release();
          await untilRuns(3);
          assertEquals(provider.calls(), 13);
          const again = (await questions()).find((row) => row.id === adopted);
          assertEquals(
            again?.options.find((item) => item.key === "adopt")?.adoption
              ?.version,
            saved!.version,
          );
          await flow!.until(
            `document.querySelector(${
              JSON.stringify(DOCK)
            })?.innerText.includes(${JSON.stringify(STAGE3_END)})`,
            "끝난 답이 없다",
            120_000,
          );
          const shown = await dockText(flow!);
          assert(shown.includes(STAGE3_ASK));
          assertHidden(shown);
          assertEquals(await flow!.count(`${DOCK} [data-result]`), 0);
          await noWindow();
        },
      );
    } finally {
      await flow?.close();
      if (home !== "") await removeHome(home);
      await provider.close();
    }
  },
});
