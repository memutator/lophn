// 화면 context와 agent 주석(apps/agent-context#R1–R6, apps/sdk#R39). 실제 runtime entrypoint의
// command 경계(서명 연결 검사·입력 검사·handler 호출·오류 응답)에 SDK 등록 handler를 올려 본다.
// 실제 core의 grant·agent connection은 screen-context-world_test.ts가 본다.
import { assert, assertEquals, assertThrows } from "@std/assert";
import { validateBlueprint } from "../../apps/blueprint/mod.ts";
import {
  APP,
  connection,
  handleInvoke,
  REL,
  shaKey,
  startRuntime,
} from "../../apps/runtime/testing/mod.ts";
import { clockAt, startLine } from "../../apps/runtime/entrypoint/testing.ts";
import { handleControl } from "../../apps/runtime/entrypoint/control.ts";
import { handleScreen } from "../../apps/runtime/entrypoint/screens.ts";
import {
  CommandRejection,
  registerAnnotationTarget,
  registerScreenContext,
} from "./mod.ts";

type Attempt = { n: number; result: string };
type View = {
  code: string;
  attempts: Attempt[];
  private_note: string;
  revision: number;
};

const SECRET = "private-note-9f3c";
const views = new Map<string, View>();
const hints: { view: string; text: string; revision: string }[] = [];
let readFault: Error | undefined;
let gatedRuns = 0;

function command(
  key: string,
  effect: "read" | "write",
  extra: Record<string, unknown> = {},
) {
  return {
    key,
    label: key,
    description: `${key} purpose`,
    effect,
    confirm: false,
    input: null,
    revert: { supported: false },
    ...extra,
  };
}

const HINT_INPUT = {
  type: "object",
  properties: {
    screen: { type: "string" },
    view_session: { type: "string" },
    expected_revision: { type: "string" },
    target: { type: "string" },
    text: { type: "string", maxLength: 500 },
  },
  required: ["screen", "view_session", "expected_revision", "target", "text"],
  additionalProperties: false,
};

function contextBlueprint() {
  const parsed = validateBlueprint({
    name: "Editor",
    description: "Edits code with a hint box",
    screens: [
      {
        key: "editor",
        label: "Editor",
        path: "/editor",
        sizes: ["full", "panel"],
      },
      { key: "journal", label: "Journal", path: "/journal", sizes: ["full"] },
    ],
    commands: [
      command("editor.context", "read", {
        input: {
          type: "object",
          properties: {
            screen: { type: "string" },
            view_session: { type: "string" },
            detail: { type: "boolean", default: false },
          },
          required: ["screen", "view_session"],
          additionalProperties: false,
        },
      }),
      command("editor.hint", "write", { input: HINT_INPUT }),
      command("editor.gated", "write", { input: HINT_INPUT, confirm: true }),
      command("journal.read", "read"),
    ],
    automatic_tasks: [],
    permissions: [],
    problem_codes: [],
    documents: [],
    agent_context: [{
      screen: "editor",
      read_command: "editor.context",
      sensitive_paths: ["/data/private_note"],
      annotation_targets: [
        { key: "hint", label: "Hint", write_command: "editor.hint" },
        { key: "gated", label: "Gated", write_command: "editor.gated" },
      ],
    }],
    app_connections: [],
    sdk_dependencies: [],
  });
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
}

// 앱이 한 번 등록하는 자리(템플릿 예제와 같은 모양). 상태는 앱이 view session마다 갖는다.
function summaryOf(view: View): string {
  const last = view.attempts.at(-1);
  return `Editing ${view.code.length} chars of code; ${view.attempts.length} attempts${
    last ? `, last ${last.result}` : ""
  }. ${view.code}`;
}

registerScreenContext({
  screen: "editor",
  command: "editor.context",
  read({ view_session, detail }) {
    if (readFault) throw readFault;
    const view = views.get(view_session);
    if (!view) return undefined;
    return {
      revision: `r${view.revision}`,
      summary: summaryOf(view),
      data: detail
        ? {
          code: view.code,
          attempts: view.attempts,
          private_note: view.private_note,
        }
        : undefined,
    };
  },
  revision(view_session) {
    const view = views.get(view_session);
    return view ? `r${view.revision}` : undefined;
  },
});
for (const target of ["hint", "gated"]) {
  registerAnnotationTarget({
    screen: "editor",
    target,
    command: target === "hint" ? "editor.hint" : "editor.gated",
    async write({ view_session, text, revision }) {
      const view = views.get(view_session)!;
      // 쓰기 안에 await가 있어도 같은 view의 다른 쓰기가 끼지 않는다.
      await Promise.resolve();
      if (target === "gated") gatedRuns += 1;
      hints.push({ view: view_session, text, revision });
      view.revision += 1;
      return { revision: `r${view.revision}`, result: { saved: true } };
    },
  });
}

let broker: unknown[] = [];

function open() {
  views.clear();
  hints.length = 0;
  readFault = undefined;
  gatedRuns = 0;
  broker = [];
  let sequence = 0;
  const started = startRuntime({
    line: startLine(),
    blueprint: contextBlueprint(),
    key: shaKey(),
    clock: clockAt(),
    ids: {
      newId: (prefix) =>
        `${prefix}_01h455vb4pex5v6nkc6gd5f${
          String(++sequence).padStart(3, "0")
        }`,
    },
    broker: (request) => {
      broker.push(request.body);
      return Promise.resolve({ status: 200, body: { accepted: true } });
    },
    dataSchema: 0,
  });
  started.state.accepting = true;
  return started.state;
}

function addView(
  state: ReturnType<typeof open>,
  id: string,
  view: Partial<View> = {},
) {
  views.set(id, {
    code: "print('hi')",
    attempts: [{ n: 1, result: "failed" }],
    private_note: SECRET,
    revision: 1,
    ...view,
  });
  state.views.set(id, { id, screen: "editor", size: "full" });
}

let calls = 0;
async function invoke(
  state: ReturnType<typeof open>,
  commandKey: string,
  input: unknown,
  over: Record<string, unknown> = {},
) {
  calls += 1;
  return await handleInvoke(
    state,
    "/_lophn/commands/invoke",
    new TextEncoder().encode(JSON.stringify({
      request_key: `call-${calls}`,
      release: REL,
      command: commandKey,
      input,
    })),
    connection({
      screens: ["editor", "journal"],
      screen_sizes: { editor: ["full", "panel"], journal: ["full"] },
      commands: [
        "editor.context",
        "editor.hint",
        "editor.gated",
        "journal.read",
      ],
      ...over,
    }) as never,
  );
}

type Context = {
  app: string;
  release: string;
  screen: string;
  view_session: string;
  revision: string;
  summary: string;
  data?: Record<string, unknown> | null;
  redacted: string[];
};

async function read(
  state: ReturnType<typeof open>,
  view: string,
  detail = false,
): Promise<Context> {
  const outcome = await invoke(state, "editor.context", {
    screen: "editor",
    view_session: view,
    detail,
  });
  assertEquals(outcome.status, 200, JSON.stringify(outcome));
  return (outcome.body as { result: { result: Context } }).result.result;
}

function hint(view: string, revision: string, text = "try a retry") {
  return {
    screen: "editor",
    view_session: view,
    expected_revision: revision,
    target: "hint",
    text,
  };
}

Deno.test("apps/agent-context#R1 apps/sdk#R39: a declared screen returns code and attempts and an undeclared screen or target is refused", async () => {
  const state = open();
  addView(state, "view-a");
  const context = await read(state, "view-a", true);
  assertEquals(context.app, APP);
  assertEquals(context.release, REL);
  assertEquals(context.screen, "editor");
  assertEquals(context.data?.code, "print('hi')");
  assertEquals(context.data?.attempts, [{ n: 1, result: "failed" }]);
  assert(context.summary.includes("1 attempts"));

  // 선언하지 않은 화면은 context를 주지 않는다.
  const undeclared = await invoke(state, "editor.context", {
    screen: "journal",
    view_session: "view-a",
  });
  assertEquals(undeclared.status, 400);
  assertEquals(undeclared.error?.code, "invalid_input");
  // 선언하지 않은 자리와 다른 command의 자리는 되쓰기를 받지 않는다.
  for (
    const input of [
      { ...hint("view-a", context.revision), target: "elsewhere" },
      { ...hint("view-a", context.revision), screen: "journal" },
    ]
  ) {
    const refused = await invoke(state, "editor.hint", input);
    assertEquals(refused.status, 400);
    assertEquals(refused.error?.code, "invalid_input");
  }
  assertEquals(hints, []);
  // context 선언이 없는 화면의 command는 그냥 앱의 command다. 별도 통로가 생기지 않는다.
  assertEquals(state.blueprint.agent_context.map((item) => item.screen), [
    "editor",
  ]);
  // 입력 모양이 틀리면 handler 전에 거절한다.
  const malformed = await invoke(state, "editor.context", {
    screen: "editor",
    view_session: "view-a",
    detail: "yes",
  });
  assertEquals(malformed.status, 400);
});

Deno.test("apps/agent-context#R1 apps/sdk#R39: registering a screen the blueprint does not declare fails", () => {
  open();
  assertThrows(
    () =>
      registerScreenContext({
        screen: "journal",
        command: "journal.read",
        read: () => undefined,
      }),
    TypeError,
    "not declared",
  );
  assertThrows(
    () =>
      registerAnnotationTarget({
        screen: "editor",
        target: "elsewhere",
        command: "editor.hint",
        write: () => ({ revision: "x" }),
      }),
    TypeError,
    "not declared",
  );
  // 같은 screen·target을 두 번 등록할 수 없다.
  assertThrows(
    () =>
      registerScreenContext({
        screen: "editor",
        command: "editor.context",
        read: () => undefined,
      }),
    Error,
    "already registered",
  );
});

Deno.test("apps/agent-context#R2: two views of one app return their own state and revision and a closed view is unavailable", async () => {
  const state = open();
  addView(state, "view-a", { code: "alpha", revision: 3 });
  addView(state, "view-b", {
    code: "beta beta",
    attempts: [{ n: 1, result: "failed" }, { n: 2, result: "passed" }],
    revision: 9,
  });
  const first = await read(state, "view-a");
  const second = await read(state, "view-b");
  assertEquals([first.view_session, first.revision], ["view-a", "r3"]);
  assertEquals([second.view_session, second.revision], ["view-b", "r9"]);
  assert(first.summary.includes("alpha"));
  assert(second.summary.includes("beta beta"));
  assert(second.summary.includes("2 attempts"));

  // 앱이 그 view의 상태를 버리면(탭을 닫음) 옛 상태를 최신으로 내보내지 않는다.
  views.delete("view-a");
  const closed = await invoke(state, "editor.context", {
    screen: "editor",
    view_session: "view-a",
  });
  assertEquals(closed.status, 503);
  assertEquals(closed.error?.code, "unavailable");
  assert(!JSON.stringify(closed).includes("alpha"));
  // 다른 view는 그대로다.
  assertEquals((await read(state, "view-b")).revision, "r9");

  // runtime이 연 적 없는 session은 닫힌 view와 같은 답이다(열려 있는지 새지 않는다).
  views.set("view-ghost", {
    code: "ghost",
    attempts: [],
    private_note: "",
    revision: 1,
  });
  const ghost = await invoke(state, "editor.context", {
    screen: "editor",
    view_session: "view-ghost",
  });
  assertEquals(ghost.status, 503);
  assertEquals(ghost.error, closed.error);
  // 다른 화면에 묶인 session은 이 화면의 context가 아니다.
  state.views.set("view-journal", {
    id: "view-journal",
    screen: "journal",
    size: "full",
  });
  views.set("view-journal", views.get("view-ghost")!);
  const other = await invoke(state, "editor.context", {
    screen: "editor",
    view_session: "view-journal",
  });
  assertEquals(other.status, 400);
  assertEquals(other.error?.code, "invalid_input");
});

Deno.test("apps/agent-context#R3: a huge code input keeps the summary within 2048 bytes and detail comes only from a detail read", async () => {
  const state = open();
  const code = "한글 코드 ".repeat(4000);
  addView(state, "view-a", {
    code,
    attempts: Array.from({ length: 200 }, (_, n) => ({ n, result: "failed" })),
  });
  const summary = await read(state, "view-a");
  assert(new TextEncoder().encode(summary.summary).byteLength <= 2048);
  assert(!("data" in summary));
  const detail = await read(state, "view-a", true);
  assert(new TextEncoder().encode(detail.summary).byteLength <= 2048);
  assertEquals(detail.data?.code, code);
  assertEquals((detail.data?.attempts as unknown[]).length, 200);
});

Deno.test("apps/agent-context#R4 apps/sdk#R39: the sensitive field is absent from summary, detail and errors", async () => {
  const state = open();
  addView(state, "view-a");
  const summary = await read(state, "view-a");
  const detail = await read(state, "view-a", true);
  for (const context of [summary, detail]) {
    assert(!JSON.stringify(context).includes(SECRET));
  }
  assertEquals(detail.data?.private_note, undefined);
  assertEquals(detail.redacted, ["/data/private_note"]);

  // 요약에 민감 값을 옮겨 쓴 앱은 요약을 보내지 못한다(생략 사실만 남는다).
  views.get("view-a")!.code = `note: ${SECRET}`;
  const copied = await read(state, "view-a", true);
  assertEquals(copied.summary, "");
  assertEquals(copied.data?.code, undefined);
  assertEquals(
    copied.redacted,
    ["/data/code", "/data/private_note", "/summary"],
  );
  assert(!JSON.stringify(copied).includes(SECRET));

  // 앱 provider의 오류 원문은 호출자에게 가지 않는다.
  readFault = new Error(`failed on ${SECRET}`);
  const failed = await invoke(state, "editor.context", {
    screen: "editor",
    view_session: "view-a",
    detail: true,
  });
  assertEquals(failed.status, 503);
  assertEquals(failed.error?.code, "unavailable");
  assert(!JSON.stringify(failed).includes(SECRET));
  assert(!JSON.stringify(broker).includes(SECRET));
});

Deno.test("apps/agent-context#R4: when the host is missing nothing is returned", async () => {
  const state = open();
  addView(state, "view-a");
  const store = globalThis as Record<symbol, unknown>;
  const port = Symbol.for("lophn.screen-context");
  const saved = store[port];
  delete store[port];
  try {
    const outcome = await invoke(state, "editor.context", {
      screen: "editor",
      view_session: "view-a",
    });
    assertEquals(outcome.status, 503);
    assertEquals(outcome.error?.code, "unavailable");
    assert(!JSON.stringify(outcome).includes("print"));
  } finally {
    store[port] = saved;
  }
});

Deno.test("apps/agent-context#R5 apps/sdk#R39: an annotation applies against the read revision and a stale revision is a conflict", async () => {
  const state = open();
  addView(state, "view-a");
  const read1 = await read(state, "view-a");
  const applied = await invoke(
    state,
    "editor.hint",
    hint("view-a", read1.revision),
  );
  assertEquals(applied.status, 200, JSON.stringify(applied));
  assertEquals(
    (applied.body as { result: { result: unknown } }).result.result,
    { revision: "r2", result: { saved: true } },
  );
  assertEquals(hints, [{
    view: "view-a",
    text: "try a retry",
    revision: "r1",
  }]);

  // 사람이 코드를 고쳐 revision이 바뀐 뒤 옛 revision의 주석은 적용되지 않는다.
  views.get("view-a")!.revision = 5;
  const stale = await invoke(
    state,
    "editor.hint",
    hint("view-a", "r2", "old hint"),
  );
  assertEquals(stale.status, 409);
  assertEquals(stale.error?.code, "conflict");
  assert(stale.error?.message.includes("read the current screen again"));
  assertEquals(hints.length, 1);
  // 새로 읽은 revision으로는 쓸 수 있다.
  const fresh = await read(state, "view-a");
  assertEquals(fresh.revision, "r5");
  assertEquals(
    (await invoke(state, "editor.hint", hint("view-a", fresh.revision, "new")))
      .status,
    200,
  );
  assertEquals(hints.map((item) => item.text), ["try a retry", "new"]);
});

Deno.test("apps/agent-context#R5: a closed view refuses the annotation and writes nothing", async () => {
  const state = open();
  addView(state, "view-a");
  const current = await read(state, "view-a");
  views.delete("view-a");
  const refused = await invoke(
    state,
    "editor.hint",
    hint("view-a", current.revision),
  );
  assertEquals(refused.status, 503);
  assertEquals(refused.error?.code, "unavailable");
  const unknown = await invoke(state, "editor.hint", hint("view-b", "r1"));
  assertEquals(unknown.status, 503);
  assertEquals(hints, []);
});

Deno.test("apps/agent-context#R5: concurrent annotations on one revision apply only once", async () => {
  const state = open();
  addView(state, "view-a");
  const current = await read(state, "view-a");
  const [first, second] = await Promise.all([
    invoke(state, "editor.hint", hint("view-a", current.revision, "one")),
    invoke(state, "editor.hint", hint("view-a", current.revision, "two")),
  ]);
  assertEquals([first.status, second.status].sort(), [200, 409]);
  assertEquals(hints.length, 1);
});

Deno.test("apps/agent-context#R5: a rejected annotation is recorded as rejected with no effect, not as a failed write", async () => {
  const state = open();
  addView(state, "view-a");
  await read(state, "view-a");
  const stale = await invoke(state, "editor.hint", hint("view-a", "r9"));
  assertEquals(stale.status, 409);
  // 같은 접수를 다시 보내도 같은 거절이고 handler는 다시 실행되지 않는다.
  const again = await handleInvoke(
    state,
    "/_lophn/commands/invoke",
    new TextEncoder().encode(JSON.stringify({
      request_key: `call-${calls}`,
      release: REL,
      command: "editor.hint",
      input: hint("view-a", "r9"),
    })),
    connection({
      screens: ["editor", "journal"],
      screen_sizes: { editor: ["full", "panel"], journal: ["full"] },
      commands: ["editor.hint"],
    }) as never,
  );
  assertEquals(again.status, 409);
  assertEquals(again.error?.code, "conflict");
  await new Promise((resolve) => setTimeout(resolve, 10));
  const finishes = broker.filter((body) =>
    (body as { fact?: string }).fact === "finish"
  ) as { summary: { summary: Record<string, unknown>; status: string } }[];
  assertEquals(finishes.length, 1);
  assertEquals(finishes[0].summary.status, "failed");
  assertEquals(finishes[0].summary.summary.error, "conflict");
  assert(!("effects" in finishes[0].summary.summary));
});

Deno.test("apps/agent-context#R6: a command outside the connection is refused before the handler even with the screen open", async () => {
  const state = open();
  addView(state, "view-a");
  const current = await read(state, "view-a");
  // agent connection의 command는 agent.commands grant와 역할 범위의 교집합이다. grant를 거두면
  // 연결에서 빠진다(실제 core의 grant는 screen-context-world_test.ts).
  const withoutGrant = { commands: [] };
  const readRefused = await invoke(
    state,
    "editor.context",
    { screen: "editor", view_session: "view-a" },
    withoutGrant,
  );
  assertEquals(readRefused.status, 403);
  assertEquals(readRefused.error?.code, "forbidden");
  const writeRefused = await invoke(
    state,
    "editor.hint",
    hint("view-a", current.revision),
    withoutGrant,
  );
  assertEquals(writeRefused.status, 403);
  assertEquals(hints, []);
});

Deno.test("apps/agent-context#R6: an annotation command that needs a person's decision does not run without the signed proof", async () => {
  const state = open();
  addView(state, "view-a");
  const current = await read(state, "view-a");
  const outcome = await invoke(state, "editor.gated", {
    ...hint("view-a", current.revision),
    target: "gated",
  });
  assert(outcome.status >= 400, JSON.stringify(outcome));
  assertEquals(gatedRuns, 0);
  assertEquals(hints, []);
});

Deno.test("apps/agent-context#R6: the context handlers are ordinary commands without reserved names", () => {
  const state = open();
  assertEquals(
    state.blueprint.commands.map((item) => item.key).sort(),
    ["editor.context", "editor.gated", "editor.hint", "journal.read"],
  );
  assert(CommandRejection.name === "CommandRejection");
});

function closeView(
  state: ReturnType<typeof open>,
  view: string,
  over: Record<string, unknown> = {},
  nonce = state.identity.processNonce,
) {
  return handleControl(
    state,
    "/_lophn/control/view-closed",
    { process_nonce: nonce, view_session: view },
    connection({ actor: "machine", ...over }) as never,
  );
}

Deno.test("apps/agent-context#R2 apps/agent-context#R5: a closed or replaced view is unavailable for read and annotation without the app dropping its state", async () => {
  const state = open();
  addView(state, "view-a");
  addView(state, "view-b");
  const current = await read(state, "view-a");
  // 앱은 view-a의 상태를 그대로 갖고 있다. runtime이 닫힘을 알리면 조회·주석 모두 닫힌다.
  const closed = closeView(state, "view-a");
  assertEquals(closed.status, 200);
  assert(views.has("view-a"));
  const refusedRead = await invoke(state, "editor.context", {
    screen: "editor",
    view_session: "view-a",
  });
  assertEquals(refusedRead.status, 503);
  assertEquals(refusedRead.error?.code, "unavailable");
  const refusedWrite = await invoke(
    state,
    "editor.hint",
    hint("view-a", current.revision),
  );
  assertEquals(refusedWrite.status, 503);
  assertEquals(hints, []);
  // 같은 session을 다시 알려도 같고 다른 view는 그대로다.
  assertEquals(closeView(state, "view-a").status, 200);
  assertEquals((await read(state, "view-b")).view_session, "view-b");
  // 교체: 새 session을 열고 옛 session을 닫으면 옛 것만 닫힌다.
  addView(state, "view-a2");
  assertEquals(closeView(state, "view-b").status, 200);
  assertEquals((await read(state, "view-a2")).view_session, "view-a2");
  assertEquals(
    (await invoke(state, "editor.context", {
      screen: "editor",
      view_session: "view-b",
    })).status,
    503,
  );
});

Deno.test("apps/agent-context#R2: a late screen request cannot reopen a closed view session", () => {
  const state = open();
  addView(state, "view-a");
  closeView(state, "view-a");
  const url = new URL(
    "http://lophn.invalid/screens/editor/app.js?size=full&view_session=view-a",
  );
  const reopened = handleScreen(
    state,
    url,
    connection({
      screens: ["editor"],
      screen_sizes: { editor: ["full"] },
    }) as never,
  );
  assert("error" in reopened);
  assertEquals(reopened.status, 409);
  assertEquals(state.views.has("view-a"), false);
});

Deno.test("apps/agent-context#R6: only the platform connection with the current nonce can close a view", async () => {
  const state = open();
  addView(state, "view-a");
  // 사람·agent 연결은 제어 경로를 쓰지 못한다.
  for (const over of [{ actor: "user" }, { actor: "user", caller: null }]) {
    const refused = closeView(state, "view-a", over);
    assertEquals(refused.status, 403);
  }
  const stale = closeView(state, "view-a", {}, "other-nonce");
  assertEquals(stale.status, 401);
  const malformed = handleControl(
    state,
    "/_lophn/control/view-closed",
    { process_nonce: state.identity.processNonce },
    connection({ actor: "machine" }) as never,
  );
  assertEquals(malformed.status, 401);
  assertEquals(state.views.has("view-a"), true);
  assertEquals((await read(state, "view-a")).view_session, "view-a");
});
