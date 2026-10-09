// flow new-app(docs/flows/new-app.md)의 1·2단계만. 실제 headless shell·core를 임시
// LOPHN_HOME으로 띄우고 model은 이 테스트의 loopback 응답 server가 낸다. 실제 ~/.lophn,
// 실제 provider, 실제 coding agent는 쓰지 않는다.
// - 1: conversation 화면에서 사람이 하고 싶은 일을 말한다. lophn 역할은 기존 앱 변경,
//   문서로 남기기, 공용 SDK를 먼저 읽고 새 앱이 필요한지 판단한다. 문서로 충분하면
//   앱을 만들지 않는다.
// - 2: 고른 방안·버린 이유·재사용할 것·새로 만들 것·위험·근거를 기획 문서의 고정 판으로
//   남긴다. 저장과 판 보존은 대화 화면에 보이지 않는다.
// 3~13(질문·등록·handoff·ticket·[Start]·claim·release·preview·적용·acceptance)은
// 이 테스트가 돌리지 않는다.
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
