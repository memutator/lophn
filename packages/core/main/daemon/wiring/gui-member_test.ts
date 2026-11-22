// lophn agent가 GUI 탭 팀원에게 보낸 call이 그 탭의 turn이 되고, 그 turn의 마지막 agent 글이 답으로 돌아가 call이 done이 된다.
// 깨지면 call이 영영 accepted로 남아 보낸 쪽이 기다리거나, 남의 글이 답으로 간다. 실제 Router(메모리 port), 실제 입력 봉투(`inputParts`),
// 실제 GUI 연결(`member.ts`)과 자동 답 판정(`createCustomReply`), 녹화한 `agy acp` text를 재생하는 실제 Antigravity adapter를 잇는다.
// CLI도 model도 띄우지 않는다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { err, ok } from "../../../../base/mod.ts";
import { manualClock } from "../../../../base/clock.ts";
import { createIdSource } from "../../../../base/id.ts";
import { seededRandom } from "../../../../base/random.ts";
import type { AcpTerminal, CliProcess } from "../../../../protocol/acp/mod.ts";
import type { AgentCallRow } from "../../../../protocol/lophn-agent/calls.ts";
import { DEFAULT_CALL_POLICY } from "../../../../protocol/lophn-agent/call-policy.ts";
import { textBlocks } from "../../../../protocol/lophn-agent/content-block.ts";
import { lophnIdOf } from "../../../../protocol/lophn-agent/workspaces.ts";
import type { Tx } from "../../../../protocol/server/mod.ts";
import { type AcpHandle, createAcp } from "../../../terminal-agents/acp.ts";
import { createAntigravityAdapter } from "../../../harness-gui/antigravity.ts";
import { receivedSends } from "../../../harness-gui/received.ts";
import { inputParts } from "../../../lophn-agent/run-loop/input-text.ts";
import type {
  CallStore,
  RoutedInput,
  TargetSession,
} from "../../../router/ports.ts";
import { createRouter } from "../../../router/router.ts";
import {
  createGuiMembers,
  type HarnessMembers,
} from "../../../terminal-agents/member.ts";
import { createCustomReply } from "./custom-reply.ts";

type Frame = Record<string, unknown>;
type Entry = { kind: string; data: Frame };
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const settle = async () => {
  for (let i = 0; i < 12; i += 1) await flush();
};

const LEAD = "ses_lead";
const MEMBER = "ses_member";
const TERMINAL = `trm_${"0".repeat(25)}1`;

// Router와 메모리 port. 팀원 session은 harness transport이고 그 queue는 GUI 연결만 가져간다.
function router() {
  let counter = 0;
  const tx = {
    now: () => "2026-11-21T00:00:00.000Z",
    newId: (prefix: string) => `${prefix}_${++counter}`,
  } as unknown as Tx;
  const lophn = { agent: lophnIdOf(null), workspace: null } as const;
  const sessions: Record<string, TargetSession> = {
    [LEAD]: {
      session: LEAD as TargetSession["session"],
      transport: "lophn",
      agent: lophn,
      accepting: true,
      open: true,
      spawned_by: null,
      opened_by_machine: null,
      runs_on: null,
    },
    [MEMBER]: {
      session: MEMBER as TargetSession["session"],
      transport: "harness",
      agent: lophn,
      accepting: true,
      open: true,
      spawned_by: null,
      opened_by_machine: null,
      runs_on: null,
    },
  };
  const rows = new Map<string, AgentCallRow>();
  const toLead: RoutedInput[] = [];
  const memberQueue: (RoutedInput & { message: string })[] = [];
  const queued = new Set<(session: string) => void>();
  const store: CallStore = {
    insert: (_tx, row) => {
      rows.set(row.call, row);
      return ok(undefined);
    },
    byDedup: () => null,
    read: (_tx, call) => rows.get(call) ?? null,
    memberCall: () => null,
    move: (_tx, call, to, reason, result) => {
      const moved = {
        ...rows.get(call)!,
        state: to,
        fail_reason: reason,
        result: result ?? null,
      };
      rows.set(call, moved);
      return ok(moved);
    },
    markConsumed: () => ok(undefined),
    setDelivery: () => ok(undefined),
    lost: () => [],
    openReceivedBy: () => [],
    openAsksSentBy: () => [],
    openSentFromRemote: () => [],
  };
  const r = createRouter({
    directory: {
      find: (session) => sessions[session] ?? null,
      resolveAddress: () => ok(lophn),
      archive: () => ok(false),
      membersOn: () => [],
      membersUnder: () => [],
      openMember: () => err({ code: "forbidden", message: "not in this test" }),
      open: () => ok(sessions[MEMBER]!),
      app: () => null,
      accepts: () => null,
      listOpen: () => [],
      projectOfIdentity: () => null,
      identityOfProject: () => ok("pri_test"),
      appIdOf: () => ok("app_x" as never),
    },
    store,
    // 이 test는 한 컴퓨터 안의 call만 본다. 다른 컴퓨터로 가는 길은 쓰이지 않는다.
    outbox: {} as never,
    seen: {} as never,
    self: () => "mch_self",
    steps: {} as never,
    callPolicy: () => DEFAULT_CALL_POLICY,
    announce: () => {},
    transport: {
      deliver: (_tx, to, input) => {
        if (to.session === LEAD) toLead.push(input);
        else {
          memberQueue.push({ ...input, message: `msg_${++counter}` });
          // commit 뒤 harness queue에 넣는 것과 같다.
          setImmediate(() => {
            for (const listener of queued) listener(MEMBER);
          });
        }
        return ok(undefined);
      },
      cancel: () => ok(undefined),
    },
  });
  return { tx, router: r, rows, toLead, memberQueue, queued };
}

// 녹화한 `agy acp` text 시나리오를 재생하는 CLI(antigravity_test.ts와 같은 재생).
function recordedAgy() {
  const rec: Entry[] = readFileSync(
    fileURLToPath(
      new URL(
        "../../../harness-gui/fixtures/antigravity/text.jsonl",
        import.meta.url,
      ),
    ),
    "utf8",
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const sendsOf = (method: string) =>
    rec.flatMap((e, at) =>
      e.kind === "send" && e.data.method === method ? [at] : [],
    );
  const written: Frame[] = [];
  const counts = new Map<string, number>();
  let cursor = 0;
  let out: (text: string) => void = () => {};
  const emit = (frame: Frame) =>
    out(`${JSON.stringify({ jsonrpc: "2.0", ...frame })}\n`);
  const ourId = (recorded: unknown) => {
    const at = rec.findIndex(
      (e) => e.kind === "send" && e.data.id === recorded,
    );
    const method = rec[at]?.data.method as string;
    const nth = sendsOf(method).indexOf(at);
    return written.filter((b) => b.method === method)[nth]?.id;
  };
  const replay = (e: Entry) => {
    if (e.data.method === undefined && e.data.id !== undefined) {
      const id = ourId(e.data.id);
      if (id !== undefined) emit({ ...e.data, id });
    } else emit(e.data);
  };
  const proc: CliProcess = {
    pid: 1,
    write(text) {
      const body = JSON.parse(text) as Frame;
      written.push(body);
      const method = body.method as string | undefined;
      if (method === undefined || body.id === undefined) return;
      const nth = counts.get(method) ?? 0;
      counts.set(method, nth + 1);
      const at = sendsOf(method)[nth];
      if (method === "session/prompt") {
        if (at !== undefined) cursor = Math.max(cursor, at + 1);
        return;
      }
      setImmediate(() => {
        if (at === undefined) return emit({ id: body.id, result: {} });
        let next = at + 1;
        for (; rec[next]?.kind === "recv"; next += 1) replay(rec[next]!);
        cursor = Math.max(cursor, next);
      });
    },
    end() {},
    kill() {},
    onStdout: (fn) => void (out = fn),
    onStderr() {},
    onExit() {},
  };
  return {
    proc,
    written,
    async playToEnd() {
      for (; cursor < rec.length; cursor += 1) {
        const e = rec[cursor];
        if (e?.kind === "recv") {
          replay(e);
          await flush();
        }
      }
    },
  };
}

test("a call to a GUI tab member becomes one turn of that tab and its last agent text answers the call", async () => {
  const { tx, router: r, rows, toLead, memberQueue, queued } = router();
  const clock = manualClock(Date.UTC(2026, 10, 21));
  const ids = createIdSource({ clock, random: seededRandom(1) });

  // ledger 쪽(harness wiring)을 대신하는 메모리. turn 끝은 자동 답 판정으로 간다.
  const turns = new Map<string, { input: RoutedInput; text: string | null }>();
  const autoReply = createCustomReply({
    turn: async (turn) =>
      ok({ session: MEMBER, input_message: turn, unattended: false }),
    resultCallOf: async (turn) => {
      const input = turns.get(turn)!.input;
      return ok(
        input.kind === "call" && input.reply === "result" ? input.call : null,
      );
    },
    callOpen: async (call, session) => {
      const row = rows.get(call);
      return ok(row?.state === "accepted" && row.receiver_session === session);
    },
    isCustom: async () => ok(true),
    answer: async (_session, turn) => ok(turns.get(turn)!.text),
    reply: async (input) => {
      const replied = r.reply(
        tx,
        { session: input.session },
        {
          call: input.call,
          body: textBlocks(input.text),
          refs: [],
          auto: true,
        },
      );
      return replied.ok ? ok(undefined) : replied;
    },
  });
  const members: HarnessMembers = {
    ensure: async () => ok(MEMBER),
    bind: async () => ok(undefined),
    next: async () => {
      const head = memberQueue[0];
      if (head === undefined) return null;
      const prompt = inputParts(head, "antigravity")
        .flatMap((p) => (p.kind === "text" ? [p.text] : []))
        .join("\n");
      return {
        message: head.message,
        kind: head.kind,
        call: head.call,
        reply: head.reply,
        prompt,
      };
    },
    start: async (_session, message) => {
      const input = memberQueue.shift()!;
      assert.equal(input.message, message);
      const turn = `trn_${message}`;
      turns.set(turn, { input, text: null });
      return ok({ turn, token: "token" });
    },
    credential: async () => ok({ turn: "trn_typed", token: "token" }),
    record: async (_session, turn, text) => {
      turns.get(turn)!.text = text;
      return ok(undefined);
    },
    finish: async (turn, end) =>
      autoReply({ turn, outcome: { kind: end } }) as never,
    failCall: async () => ok(undefined),
    describe: () => null,
    canOpen: () => true,
    forget: async () => ok(0),
    failQueued: async () => ok(undefined),
    end: () => {},
    onQueued: (listener) => {
      queued.add(listener);
      return () => void queued.delete(listener);
    },
  };
  const gui = createGuiMembers({
    members: () => members,
    files: null,
    projectOf: () => `prj_${"0".repeat(25)}2`,
    after: () => () => {},
    openTerminal: async () => assert.fail("the tab is open"),
    closeTerminal: () => assert.fail("a tab the person opened stays"),
    log: (message) => assert.fail(message),
  });

  // 탭의 handle(core 쪽)과 adapter 쪽. core는 handle이 열리면 묶는다.
  let tab: AcpHandle | undefined;
  const { acp } = createAcp(ids, (handle) => {
    tab = handle;
    gui.opened(handle);
  });
  const session = acp.open({
    terminal: { id: TERMINAL, cwd: "/work/member" } as AcpTerminal,
    harness: "antigravity",
    title: "antigravity",
    handoff: "restart",
  });
  const agy = recordedAgy();
  const started = await createAntigravityAdapter({
    home: "/home/test",
    readFile: () => Promise.reject(new Error("no files")),
    exists: () => Promise.resolve(false),
  }).start({
    terminal: null,
    cwd: "/work/member",
    session: receivedSends(session),
    spawn: () => agy.proc,
    clock,
    ids,
  });
  assert.equal(started.ok, true);
  await settle();

  // lead가 팀원에게 결과를 받는 call을 보낸다.
  const sent = r.route(tx, {
    from: { kind: "agent", session: LEAD },
    to: { session: MEMBER },
    reply: "result",
    body: textBlocks("Say hello."),
    refs: [],
    reply_to: null,
    kind: "call",
    delivery: "next_turn",
    dedup: "tool-1",
  } as never);
  assert.ok(sent.ok && sent.value.call !== null);
  const call = sent.value.call;
  await settle();

  // call은 lophn tag로 싸여 CLI의 prompt가 되고, 탭에는 사람 말이 아니라 받은 메시지로 보인다.
  const prompt = JSON.stringify(
    agy.written.find((b) => b.method === "session/prompt")?.params,
  );
  assert.ok(prompt.includes("lophn-call"), prompt);
  const taken = tab
    ?.state()
    .items.find((item) => item.kind === "message" && item.call === call);
  assert.equal(taken?.kind === "message" && taken.actor, "received");

  await agy.playToEnd();
  await settle();

  // 답은 lead에게 reply 입력으로 가고 call은 done이다.
  const back = toLead.find((input) => input.kind === "reply");
  assert.equal(back?.reply_to, call);
  const answer = back?.body
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("");
  assert.ok(answer !== undefined && answer.trim() !== "");
  assert.equal(rows.get(call)?.state, "done");
});

// 팀원이 답하지 못한 call 하나를 닫는 길은 그 session이 받은 열린 call에만 닿는다. 깨지면 남의 call이나 이미 끝난 call이 실패로 바뀐다.
test("failing a member's call closes only an open call that member received, and tells the sender once", async () => {
  const { tx, router: r, rows, toLead } = router();
  const sent = r.route(tx, {
    from: { kind: "agent", session: LEAD },
    to: { session: MEMBER },
    reply: "result",
    body: textBlocks("Say hello."),
    refs: [],
    reply_to: null,
    kind: "call",
    delivery: "next_turn",
    dedup: "tool-2",
  } as never);
  assert.ok(sent.ok && sent.value.call !== null);
  const call = sent.value.call;
  assert.deepEqual(r.failReceived(tx, LEAD, call), ok(false));
  assert.equal(rows.get(call)?.state, "accepted");
  assert.deepEqual(r.failReceived(tx, MEMBER, call), ok(true));
  assert.equal(rows.get(call)?.state, "failed");
  assert.equal(rows.get(call)?.fail_reason, "receiver_ended");
  const told = toLead.filter((input) => input.call === call);
  assert.equal(told.length, 1);
  assert.deepEqual(r.failReceived(tx, MEMBER, call), ok(false));
  assert.equal(toLead.filter((input) => input.call === call).length, 1);
});
