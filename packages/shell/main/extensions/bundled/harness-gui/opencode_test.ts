import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { manualClock } from "../../../../../base/clock.ts";
import { createIdSource } from "../../../../../base/id.ts";
import { seededRandom } from "../../../../../base/random.ts";
import type { AcpInput } from "../../../../../protocol/acp/input.ts";
import {
  EMPTY_ACP_STATE,
  reduceAcp,
} from "../../../../../protocol/acp/reduce.ts";
import type { AcpState } from "../../../../../protocol/acp/state.ts";
import type {
  AcpSessionHandle,
  ExtensionProcess,
} from "../../../../../protocol/extensions/mod.ts";
import { createOpencodeAdapter, type OpencodeTransport } from "./opencode.ts";

// 녹화(fixtures/opencode)로 adapter를 돌린다. 실제 `opencode`는 띄우지 않고, server와 말하는 길을 녹화를 재생하는 대역으로
// 바꾼다. 녹화는 GUI 쪽 client(A)가 본 것이다: adapter가 부른 요청마다 녹화된 응답을 주고, 그 사이에 녹화된 event를 흘린다.

type Entry = { kind: string; data: Record<string, unknown> };
const fixtures = fileURLToPath(
  new URL("./fixtures/opencode/", import.meta.url),
);
const recording = (name: string): Entry[] =>
  readFileSync(`${fixtures}${name}.jsonl`, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

async function setup(name: string) {
  const rec = [...recording("start"), ...recording(name)];
  type Waiter = {
    method: string;
    path: string;
    body: unknown;
    resolve(value: unknown): void;
    reject(error: Error): void;
  };
  const waiting: Waiter[] = [];
  // adapter가 보낸 요청(method, path, body)을 순서대로.
  const requests: { method: string; path: string; body: unknown }[] = [];
  let emit: (event: Record<string, unknown>) => void = () => {};
  const transport: OpencodeTransport = {
    request: (method, path, options) =>
      new Promise((resolve, reject) => {
        requests.push({ method, path, body: options?.body });
        waiting.push({
          method,
          path,
          body: options?.body,
          resolve: resolve as (value: unknown) => void,
          reject,
        });
      }),
    events(onEvent) {
      emit = onEvent;
      return { close() {} };
    },
  };

  let at = 0;
  async function pump() {
    for (let round = 0; round < 50; round++) {
      await flush();
      const entry = rec[at];
      if (entry === undefined) return;
      const data = entry.data;
      if (entry.kind === "event" && data.client === "A") {
        emit(data.event as Record<string, unknown>);
      } else if (entry.kind === "http" && data.client === "A") {
        const index = waiting.findIndex(
          (one) => one.method === data.method && one.path === data.path,
        );
        const found = waiting[index];
        if (found === undefined) return;
        waiting.splice(index, 1);
        if (data.error !== undefined) {
          found.reject(
            Object.assign(new Error(String(data.error)), {
              status: data.status,
            }),
          );
        } else found.resolve(data.response);
      }
      at += 1;
    }
  }

  const stdout: ((text: string) => void)[] = [];
  const spawned: { command: string; args: readonly string[]; env?: unknown }[] =
    [];
  const proc: ExtensionProcess = {
    pid: 1,
    write() {},
    end() {},
    kill() {},
    onStdout: (listener) => {
      stdout.push(listener);
      setImmediate(() => listener('{"url":"http://127.0.0.1:1"}\n'));
    },
    onStderr() {},
    onExit() {},
  };

  let state: AcpState = EMPTY_ACP_STATE;
  let listener: ((input: AcpInput) => void) | undefined;
  const session: AcpSessionHandle = {
    id: "win_test",
    publish: (update) => void (state = reduceAcp(state, update)),
    onInput: (fn) => void (listener = fn),
    onClose() {},
    close() {},
  };
  const secrets: string[] = [];
  const adapter = createOpencodeAdapter({
    connect: () => transport,
    async writeSecret(text) {
      secrets.push(text);
      return { path: "/tmp/lophn-opencode-x/password", remove: async () => {} };
    },
  });
  const clock = manualClock(Date.UTC(2026, 10, 5));
  let started: Awaited<ReturnType<typeof adapter.start>> | undefined;
  void adapter
    .start({
      terminal: null,
      cwd: "/work",
      session,
      spawn: (command, args, options) => {
        spawned.push({ command, args, env: options?.env });
        return proc;
      },
      clock,
      ids: createIdSource({ clock, random: seededRandom(1) }),
    })
    .then((result) => void (started = result));
  for (let round = 0; round < 50 && started === undefined; round++)
    await pump();
  assert.equal(started?.ok, true);
  await pump();

  return {
    get state() {
      return state;
    },
    requests,
    spawned,
    secrets,
    run: started?.ok === true ? started.value : undefined,
    pump,
    async input(input: Record<string, unknown>) {
      listener?.({ session: "ses_x", ...input } as AcpInput);
      await flush();
    },
    send: (id: string, text: string) => ({
      type: "send",
      id: `msg_${id}`,
      key: id,
      content: [{ type: "text", text }],
      delivery: "next_turn",
    }),
  };
}

// 녹화에서 model이 먼저 codemode의 `execute`를 잘못 불러 tool 줄이 둘이다. 승인이 걸리는 것은 `shell`이다.
const shellTool = (state: AcpState) =>
  state.items.flatMap((item) =>
    item.kind === "tool" && item.tool === "shell" ? [item] : [],
  )[0];
const ends = (state: AcpState) =>
  state.items.flatMap((item) =>
    item.kind === "notice" && item.notice.type === "turn_end"
      ? [item.notice.outcome]
      : [],
  );
const replies = (requests: { method: string; path: string; body: unknown }[]) =>
  requests.filter((one) => one.path.endsWith("/reply"));

// 승인 요청이 떠 있는 데까지 간다.
async function untilAsked(name: string) {
  const t = await setup(name);
  await t.input(
    t.send(
      "1",
      "Use your shell tool to run exactly this command: touch once.txt .",
    ),
  );
  await t.pump();
  const approval = t.state.pending.approval;
  assert.ok(approval);
  return { t, approval };
}

test("permission 요청은 창이 답하기 전까지 reply가 나가지 않고, 답하면 once가 나간다", async () => {
  const { t, approval } = await untilAsked("approve_once");
  assert.equal(approval.subject.kind, "shell");
  assert.equal(t.state.turn?.phase, "waiting");
  assert.equal(shellTool(t.state)?.state, "running");
  assert.equal(replies(t.requests).length, 0);

  await t.input({
    type: "decide",
    request: approval.id,
    choice: { kind: "once" },
  });
  await t.pump();

  assert.deepEqual(
    replies(t.requests).map((one) => one.body),
    [{ decision: "once" }],
  );
  assert.equal(shellTool(t.state)?.state, "ok");
  // server가 돌려준 표지로 우리가 보낸 메시지를 알아보므로 사람 메시지는 한 번만 그려진다.
  const users = t.state.items.flatMap((item) =>
    item.kind === "message" && item.actor === "user" ? [item.id] : [],
  );
  assert.deepEqual(users, ["msg_1"]);
  assert.equal(t.state.pending.approval, null);
  assert.deepEqual(ends(t.state), ["completed"]);
  assert.equal(t.state.reread, false);
});

test("거절하면 reply가 reject와 이유를 싣고, 그 tool은 거절로 끝나며 turn은 stopped로 그려지지 않는다", async () => {
  const { t, approval } = await untilAsked("deny_reason");
  await t.input({
    type: "decide",
    request: approval.id,
    choice: { kind: "reject", reason: "Do not create files here." },
  });
  await t.pump();

  assert.deepEqual(
    replies(t.requests).map((one) => one.body),
    [{ decision: "reject", message: "Do not create files here." }],
  );
  assert.equal(shellTool(t.state)?.state, "denied");
  assert.deepEqual(ends(t.state), ["completed"]);
  const closed = t.state.items.find((item) => item.kind === "approval");
  assert.equal(closed?.kind === "approval" && closed.outcome, "denied");
  assert.equal(
    closed?.kind === "approval" && closed.reason,
    "Do not create files here.",
  );
});

test("다른 client가 먼저 답하면 이쪽 카드가 답 없이 닫힌다", async () => {
  // 녹화에서는 B가 답하고, A는 `permission.replied`를 받는다. adapter는 reply를 보내지 않는다.
  const t = await setup("approve_other");
  await t.input(
    t.send(
      "1",
      "Use your shell tool to run exactly this command: touch once.txt .",
    ),
  );
  await t.pump();

  assert.equal(t.state.pending.approval, null);
  assert.equal(replies(t.requests).length, 0);
  const closed = t.state.items.find((item) => item.kind === "approval");
  assert.equal(closed?.kind === "approval" && closed.outcome, "allowed");
  assert.equal(t.state.reread, false);
  assert.deepEqual(ends(t.state), ["completed"]);
});

test("이 session 동안 허락은 session.update permissions와 once만 보내고 always를 보내지 않는다. always는 영구로 표시된 선택에서만 나간다", async () => {
  const session = await untilAsked("approve_session");
  // always는 사람의 project에 영구 규칙으로 남는 선택이라 영구라고 적어 내놓는다.
  assert.deepEqual(session.approval.choices, [
    "once",
    "session",
    "always",
    "reject",
  ]);
  assert.match(session.approval.always_patterns.join(" "), /permanent/i);
  await session.t.input({
    type: "decide",
    request: session.approval.id,
    choice: { kind: "session" },
  });
  await session.t.pump();

  const patch = session.t.requests.find((one) => one.method === "PATCH");
  assert.deepEqual(patch?.body, {
    permissions: [{ action: "shell", resource: "touch *", effect: "allow" }],
  });
  assert.deepEqual(
    replies(session.t.requests).map((one) => one.body),
    [{ decision: "once" }],
  );
  const closed = session.t.state.items.find((item) => item.kind === "approval");
  assert.equal(closed?.kind === "approval" && closed.choice, "session");

  const always = await untilAsked("approve_once");
  await always.t.input({
    type: "decide",
    request: always.approval.id,
    choice: { kind: "always" },
  });
  await always.t.pump();
  assert.deepEqual(
    replies(always.t.requests).map((one) => one.body),
    [{ decision: "always" }],
  );
});

test("tab 전용 server의 password는 spawn env의 그 칸과 0600 file에만 있고 TUI 명령 글에는 없다", async () => {
  const t = await setup("approve_once");
  const [spawn] = t.spawned;
  assert.deepEqual(spawn?.args, ["serve", "--stdio", "--port", "0"]);
  const env = spawn?.env as Record<string, string>;
  // login shell env를 덮지 않도록 바꾸는 칸만 넘긴다.
  assert.deepEqual(Object.keys(env), ["OPENCODE_PASSWORD"]);
  const password = env.OPENCODE_PASSWORD;
  assert.equal(t.secrets[0], password);

  const command = t.run?.tuiCommand();
  assert.ok(command !== undefined && !command.includes(password ?? ""));
  assert.match(
    command ?? "",
    /^OPENCODE_PASSWORD="\$\(cat '\/tmp\/lophn-opencode-x\/password'\)" opencode --server http:\/\/127\.0\.0\.1:1 --session ses_test$/,
  );
});
