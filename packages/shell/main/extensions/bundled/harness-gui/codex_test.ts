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
import type { AcpState, AcpUpdate } from "../../../../../protocol/acp/state.ts";
import type {
  AcpSessionHandle,
  ExtensionProcess,
} from "../../../../../protocol/extensions/mod.ts";
import { codexAdapter } from "./codex.ts";

// 녹화(fixtures/codex)로 adapter를 돌린다. 실제 `codex`는 띄우지 않고, spawn이 돌려주는 process가 녹화의 `recv` 줄을
// 내보내고 adapter가 쓴 줄을 모은다.

type Entry = {
  kind: "send" | "recv";
  data: {
    id?: number;
    method?: string;
    params?: Record<string, unknown>;
    result?: unknown;
  };
};
const fixtures = fileURLToPath(new URL("./fixtures/codex/", import.meta.url));
const recording = (name: string): Entry[] =>
  readFileSync(`${fixtures}${name}.jsonl`, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

type Written = {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
};

async function setup(scenario: string, options: { resume?: string } = {}) {
  const written: Written[] = [];
  let emit: (text: string) => void = () => {};
  let spawned: { command: string; args: readonly string[] } | undefined;
  const proc: ExtensionProcess = {
    pid: 1,
    write: (text) => void written.push(JSON.parse(text)),
    end() {},
    kill() {},
    onStdout: (listener) => void (emit = listener),
    onStderr() {},
    onExit() {},
  };

  let state: AcpState = EMPTY_ACP_STATE;
  let listener: ((input: AcpInput) => void) | undefined;
  const session: AcpSessionHandle = {
    id: "win_test",
    publish(update: AcpUpdate) {
      state = reduceAcp(state, update);
    },
    onInput: (fn) => void (listener = fn),
    onClose() {},
    close() {},
  };
  const clock = manualClock(Date.UTC(2026, 10, 5));
  const started = await codexAdapter.start({
    terminal: null,
    cwd: `/work/${scenario}`,
    ...(options.resume === undefined ? {} : { resume: options.resume }),
    session,
    spawn: (command, args) => {
      spawned = { command, args };
      return proc;
    },
    clock,
    ids: createIdSource({ clock, random: seededRandom(1) }),
  });
  assert.equal(started.ok, true);

  const rec = recording(scenario);
  let at = 0;
  let sent = 0;
  let answered = 0;
  const unanswered = () =>
    written.filter((one) => one.id !== undefined && one.method !== undefined);

  return {
    rec,
    written,
    get spawned() {
      return spawned;
    },
    get state() {
      return state;
    },
    async input(input: Record<string, unknown>) {
      listener?.({ session: "ses_x", ...input } as AcpInput);
      await flush();
    },
    send: (id: string, text: string, delivery = "next_turn") => ({
      type: "send",
      id: `msg_${id}`,
      key: id,
      content: [{ type: "text", text }],
      delivery,
    }),
    /**
     * 녹화를 이어서 돌린다. `send` 줄은 adapter가 같은 순서로 썼는지 보고(요청 id는 adapter의 것으로 맞춘다), `recv`
     * 줄은 내보낸다. 승인 요청을 내보냈거나, 시험이 입력으로 만들어야 하는 `send`(steer, interrupt, 승인 답)에
     * 닿으면 그 줄을 돌려준다.
     */
    async play(): Promise<Entry | undefined> {
      while (at < rec.length) {
        const entry = rec[at] as Entry;
        const data = entry.data;
        if (entry.kind === "send") {
          await flush();
          if (written.length <= sent) return entry;
          const line = written[sent++] as Written;
          if (data.method === undefined) assert.deepEqual(line, data);
          else assert.equal(line.method, data.method);
          at += 1;
          continue;
        }
        at += 1;
        // 응답의 id는 adapter가 붙인 요청 id다.
        const isResponse = data.method === undefined;
        const line = isResponse
          ? { ...data, id: unanswered()[answered++]?.id }
          : data;
        emit(`${JSON.stringify(line)}\n`);
        await flush();
        if (!isResponse && data.id !== undefined) return entry;
      }
      return undefined;
    },
  };
}

const tools = (state: AcpState) =>
  state.items.flatMap((item) => (item.kind === "tool" ? [item] : []));
const users = (state: AcpState) =>
  state.items.flatMap((item) =>
    item.kind === "message" && item.actor === "user" ? [item] : [],
  );
const contiguous = (state: AcpState) =>
  assert.deepEqual(
    state.items.map((item) => item.seq),
    state.items.map((_, index) => index + 1),
  );
const ends = (state: AcpState) =>
  state.items.flatMap((item) =>
    item.kind === "notice" && item.notice.type === "turn_end"
      ? [item.notice.outcome]
      : [],
  );
const firstPrompt = (rec: Entry[]) =>
  (
    rec.find((one) => one.data.method === "turn/start")?.data.params?.input as {
      text: string;
    }[]
  )[0]?.text as string;

const approvalRows = [
  {
    name: "deny",
    choice: { kind: "reject" },
    tool: "denied",
    decision: "decline",
  },
  { name: "patch", choice: { kind: "once" }, tool: "ok", decision: "accept" },
] as const;

for (const row of approvalRows) {
  test(`승인 요청은 창이 답하기 전까지 답하지 않고 답대로 끝난다 (${row.name})`, async () => {
    const t = await setup(row.name);
    assert.equal(t.spawned?.command, "codex");
    assert.deepEqual(t.spawned?.args, ["app-server"]);
    await t.play();
    // 사람의 설정이 never + danger-full-access여도 승인을 묻고 작업 폴더에서만 쓴다.
    const opened = t.written.find((one) => one.method === "thread/start");
    assert.equal(opened?.params?.approvalPolicy, "on-request");
    assert.equal(opened?.params?.sandbox, "workspace-write");

    await t.input(t.send("1", firstPrompt(t.rec)));
    const asked = (await t.play()) as Entry;
    assert.ok(asked.data.method?.endsWith("/requestApproval"));

    // 창이 답하기 전: app-server에 승인도 거절도 가지 않았고 카드가 떠 있다.
    const approval = t.state.pending.approval;
    assert.ok(approval);
    assert.equal(t.state.turn?.phase, "waiting");
    assert.equal(tools(t.state)[0]?.state, "running");
    assert.equal(
      t.written.some((one) => one.result !== undefined),
      false,
    );

    await t.input({ type: "decide", request: approval.id, choice: row.choice });
    const answer = t.written.find((one) => one.result !== undefined);
    assert.deepEqual(answer, {
      id: asked.data.id,
      result: { decision: row.decision },
    });
    await t.play();

    assert.equal(tools(t.state)[0]?.state, row.tool);
    if (row.name === "patch") {
      const detail = tools(t.state)[0]?.detail;
      assert.ok(detail?.kind === "edit");
      assert.deepEqual(
        [detail.path, detail.added, detail.removed],
        ["note.txt", 1, 0],
      );
    }
    assert.equal(t.state.pending.approval, null);
    assert.equal(t.state.turn?.phase, "ended");
    assert.equal(t.state.reread, false);
    contiguous(t.state);
  });
}

for (const scenario of ["steer", "interrupt"] as const) {
  test(`도는 중 steer와 stop은 app-server 요청이 되고 turn이 이어진다 (${scenario})`, async () => {
    const t = await setup(scenario);
    await t.play();
    await t.input(t.send("1", firstPrompt(t.rec)));
    const driven = (await t.play()) as Entry;
    assert.equal(driven.data.method, `turn/${scenario}`);

    if (scenario === "steer") {
      const text = (driven.data.params?.input as { text: string }[])[0]
        ?.text as string;
      await t.input(t.send("2", text, "steer"));
      assert.equal(t.state.queued.length, 0);
      const line = t.written.at(-1);
      assert.equal(line?.method, "turn/steer");
      assert.equal(
        line?.params?.expectedTurnId,
        driven.data.params?.expectedTurnId,
      );
    } else {
      await t.input({ type: "stop", turn: "trn_x", key: "stop" });
      assert.equal(t.written.at(-1)?.method, "turn/interrupt");
    }
    await t.play();

    if (scenario === "steer") {
      // 같은 turn 안의 두 번째 메시지다.
      assert.deepEqual(
        users(t.state).map((item) => item.id),
        ["msg_1", "msg_2"],
      );
      assert.equal(users(t.state)[0]?.turn, users(t.state)[1]?.turn);
      assert.deepEqual(ends(t.state), ["completed"]);
    } else {
      assert.deepEqual(ends(t.state), ["stopped"]);
    }
    assert.equal(t.state.reread, false);
    contiguous(t.state);
  });
}

test("resume은 thread/resume으로 열고 앞 대화를 응답의 turn으로 다시 그린다", async () => {
  const id = "01a1a6cf-c594-7db3-adc5-2cc81b9f9455";
  const t = await setup("resume", { resume: id });
  await t.play();
  const opened = t.written.find((one) => one.method === "thread/resume");
  assert.equal(opened?.params?.threadId, id);
  assert.equal(opened?.params?.approvalPolicy, "on-request");
  assert.equal(opened?.params?.sandbox, "workspace-write");

  const texts = t.state.items.flatMap((item) =>
    item.kind === "message" ? [[item.actor, item.content[0]]] : [],
  );
  assert.deepEqual(texts, [
    [
      "user",
      {
        type: "text",
        text: "Reply with exactly this sentence and nothing else: Hello from the GUI fixture.",
      },
    ],
    ["agent", { type: "text", text: "Hello from the GUI fixture." }],
  ]);
  assert.equal(t.state.turn?.phase, "ended");
  contiguous(t.state);
});
