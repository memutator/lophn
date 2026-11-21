import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { cryptoRandom, err, manualClock, ok } from "../../base/mod.ts";
import type { AcpInput, AcpState, AcpUpdate } from "../../protocol/acp/mod.ts";
import { EMPTY_ACP_STATE, reduceAcp } from "../../protocol/acp/reduce.ts";
import { callReply } from "../../protocol/lophn-agent/calls.ts";
import { CredentialRegistry } from "../server/identity/registry.ts";
import { createCredentialFiles } from "./credential-file.ts";
import type { TabHandle } from "./gui.ts";
import {
  createGuiMembers,
  type HarnessMembers,
  type MemberInput,
  type MemberTurnEnd,
} from "./member.ts";

// GUI 탭 팀원의 규칙. 자격은 그 turn에만 산다(turn 밖의 CLI가 그 session의 agent로 부르지 않는다). call의 답은 그 call을 가져간
// turn의 마지막 agent 글뿐이다(사람이 친 turn의 글이 남의 call에 답으로 가지 않는다). 답 없이 끝나거나 turn이 열리지 않은 call은
// 보낸 쪽에 실패로 돌아간다(영영 기다리지 않는다).
const id = (prefix: string, n: number) =>
  `${prefix}_${String(n).padStart(26, "0")}`;
const TERMINAL = id("trm", 1);
const SESSION = id("ses", 1);
const PROJECT = id("prj", 1);
const CALL = id("cal", 1);
const at = "2026-11-21T00:00:00.000Z";
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const settle = async () => {
  for (let i = 0; i < 8; i += 1) await flush();
};

function setup() {
  const root = mkdtempSync(join(tmpdir(), "lophn-member-"));
  const registry = new CredentialRegistry({
    epoch: "epoch",
    random: cryptoRandom,
    clock: manualClock(Date.parse(at)),
    operations: [
      { name: callReply.name, actors: callReply.actors, kind: "command" },
    ],
  });
  let turns = 0;
  const tokens: string[] = [];
  const issue = () => {
    const turn = id("trn", ++turns);
    const issued = registry.issue({
      actor: `agent:${SESSION}`,
      principal: `agent:${SESSION}`,
      scope: {
        operations: [callReply.name],
        targets: { session: SESSION, turn },
      },
      conditions: { session: SESSION, turn, process: "harness" },
    });
    assert.ok(issued.ok);
    tokens.push(issued.value.token);
    return { turn, token: issued.value.token };
  };
  // ledger 쪽. queue, 남긴 답 글, 닫은 turn, 실패로 돌려준 call.
  const queue: MemberInput[] = [];
  const answers = new Map<string, string>();
  const finished = new Map<string, MemberTurnEnd>();
  const failed: string[] = [];
  const listeners = new Set<(session: string) => void>();
  let lateCredential: (() => void) | null = null;
  // 열린 팀원 session의 ledger 모습과, 탭을 열지 못해 비운 queue.
  const rows = new Map<
    string,
    { project: string; harness: "claude-code"; cli_session: string | null }
  >([
    [
      SESSION,
      { project: PROJECT, harness: "claude-code", cli_session: "cli-1" },
    ],
  ]);
  const emptied: string[] = [];
  let ensured = 0;
  const members: HarnessMembers = {
    ensure: async () => {
      ensured += 1;
      return ok(SESSION);
    },
    describe: (session) => rows.get(session) ?? null,
    failQueued: async (session) => {
      emptied.push(session);
      queue.splice(0);
      return ok(undefined);
    },
    bind: async () => ok(undefined),
    next: async () => queue[0] ?? null,
    start: async (_session, message) => {
      assert.equal(queue.shift()?.message, message);
      return ok(issue());
    },
    credential: () =>
      lateCredential === null
        ? Promise.resolve(ok(issue()))
        : new Promise((resolve) => {
            lateCredential = () => resolve(ok(issue()));
          }),
    record: async (_session, turn, text) => {
      answers.set(turn, text);
      return ok(undefined);
    },
    finish: async (turn, end) => {
      finished.set(turn, end);
      return ok(undefined);
    },
    failCall: async (_session, call) => {
      failed.push(call);
      return ok(undefined);
    },
    end: (turn) => void registry.endBy("turn", turn),
    onQueued: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
  const timers: (() => void)[] = [];
  const files = createCredentialFiles({
    root: join(root, "credentials"),
    fs: {
      mkdir: (path, mode) => void mkdirSync(path, { recursive: true, mode }),
      write: (path, text, mode) => writeFileSync(path, text, { mode }),
      remove: (path) => rmSync(path, { force: true }),
    },
  });
  const gui = createGuiMembers({
    members: () => members,
    files,
    projectOf: () => PROJECT,
    after: (_ms, run) => {
      timers.push(run);
      return () => {
        const at = timers.indexOf(run);
        if (at >= 0) timers.splice(at, 1);
      };
    },
    openTerminal: async (input) => {
      opens.push(input);
      return opensFail
        ? err({ code: "conflict", message: "busy" })
        : ok(TERMINAL);
    },
    log: () => {},
  });
  gui.listen();
  const opens: {
    project: string;
    harness: string;
    cli_session: string | null;
  }[] = [];
  let opensFail = false;

  // 탭의 handle. adapter가 낼 갱신을 test가 직접 낸다.
  let state: AcpState = EMPTY_ACP_STATE;
  let seq = 0;
  const sent: AcpInput[] = [];
  const attached = new Set<Parameters<TabHandle["attach"]>[0]>();
  const handle = {
    id: "win_1",
    terminal: TERMINAL,
    harness: "claude",
    handoff: "restart",
    cwd: "/work",
    state: () => state,
    attach(listener) {
      listener.snapshot(state);
      attached.add(listener);
      return () => void attached.delete(listener);
    },
    input: (input: AcpInput) => void sent.push(input),
    close() {
      for (const listener of [...attached]) listener.closed();
      attached.clear();
    },
  } satisfies TabHandle;
  const publish = async (update: AcpUpdate) => {
    state = reduceAcp(state, update);
    for (const listener of attached) listener.update(update);
    await settle();
  };
  const message = (
    messageId: string,
    turn: string | null,
    actor: "user" | "agent",
    text: string,
  ): AcpUpdate => ({
    type: "message_added",
    item: {
      kind: "message",
      id: messageId,
      seq: ++seq,
      at,
      actor,
      sender: null,
      call: null,
      reply_to: null,
      delivery: "next_turn",
      turn,
      origin: null,
      content: [{ type: "text", text }],
      reasoning: null,
      cards: [],
      complete: true,
    },
  });
  const ended = (
    turn: string,
    outcome: "completed" | "stopped" | "failed" = "completed",
  ): AcpUpdate => ({
    type: "turn_ended",
    turn,
    at,
    outcome,
    active_ms: 1,
    error: null,
    messages: [],
    seq: ++seq,
  });
  const queueCall = async (n: number) => {
    queue.push({
      message: id("msg", n),
      kind: "call",
      call: CALL,
      reply: "result",
      prompt: `<lophn-call from="lead" call="${CALL}" reply="result">\nask\n</lophn-call>`,
    });
    for (const listener of listeners) listener(SESSION);
    await settle();
  };
  const open = async () => {
    gui.opened(handle);
    await publish({
      type: "session_changed",
      session: { cli_session: "cli-1", capabilities: {} },
    } as unknown as AcpUpdate);
  };
  const fileToken = () => {
    const path = files.pathOf(TERMINAL);
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  };
  const live = async (token: string) => (await registry.authenticate(token)).ok;
  return {
    root,
    gui,
    handle,
    publish,
    message,
    ended,
    queueCall,
    open,
    sent,
    files,
    fileToken,
    live,
    answers,
    finished,
    failed,
    timers,
    tokens,
    rows,
    opens,
    emptied,
    ensured: () => ensured,
    failOpens: () => {
      opensFail = true;
    },
    holdCredential: () => {
      lateCredential = () => {};
      return () => lateCredential?.();
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("a tab turn's credential lives in a 0600 file in a 0700 folder only during that turn, and the next turn gets another", async () => {
  const kit = setup();
  try {
    await kit.open();
    const tokens: string[] = [];
    for (const turn of ["acp_1", "acp_2"]) {
      await kit.publish({ type: "turn_started", turn, at });
      const token = kit.fileToken();
      assert.ok(token !== null, "the turn has a credential file");
      assert.equal(await kit.live(token), true);
      const path = kit.files.pathOf(TERMINAL);
      assert.equal(statSync(path).mode & 0o777, 0o600);
      assert.equal(statSync(dirname(path)).mode & 0o777, 0o700);
      tokens.push(token);
      await kit.publish(kit.ended(turn));
      assert.equal(kit.fileToken(), null, "the file is gone after the turn");
      assert.equal(await kit.live(token), false, "the credential ended");
    }
    assert.notEqual(tokens[0], tokens[1]);
  } finally {
    kit.cleanup();
  }
});

test("a credential that arrives after its turn ended, or a terminal that ends mid-turn, leaves no file and no live credential", async () => {
  const kit = setup();
  try {
    await kit.open();
    await kit.publish({ type: "turn_started", turn: "acp_1", at });
    const token = kit.fileToken()!;
    kit.gui.terminalEnded(TERMINAL);
    await settle();
    assert.equal(kit.fileToken(), null);
    assert.equal(await kit.live(token), false);

    await kit.open();
    const release = kit.holdCredential();
    await kit.publish({ type: "turn_started", turn: "acp_2", at });
    await kit.publish(kit.ended("acp_2"));
    release();
    await settle();
    assert.equal(kit.fileToken(), null);
    assert.equal(await kit.live(kit.tokens.at(-1)!), false);
  } finally {
    kit.cleanup();
  }
});

test("a call queued while the person's message waits for its turn is answered by its own turn, not by the person's", async () => {
  const kit = setup();
  try {
    await kit.open();
    // adapter가 사람 글을 먼저 올리고 turn은 아직 열지 않았다.
    await kit.publish(kit.message("msg_person", null, "user", "what is 2+2"));
    await kit.queueCall(1);
    assert.equal(kit.sent.length, 0, "nothing is injected while it waits");

    await kit.publish({ type: "turn_started", turn: "acp_p", at });
    await kit.publish({
      type: "message_taken",
      message: "msg_person",
      seq: 0,
      delivery: "next_turn",
      turn: "acp_p",
    } as unknown as AcpUpdate);
    await kit.publish(kit.message("msg_a1", "acp_p", "agent", "4"));
    await kit.publish(kit.ended("acp_p"));
    assert.equal(
      kit.sent.length,
      1,
      "the call goes in after the person's turn",
    );

    // 넣은 뒤 사람이 먼저 turn을 열어도(adapter가 call을 줄 세움) 그 turn은 call의 것이 아니다.
    await kit.publish({ type: "turn_started", turn: "acp_p2", at });
    await kit.publish(kit.message("msg_a2", "acp_p2", "agent", "5"));
    await kit.publish(kit.ended("acp_p2"));
    await kit.publish({ type: "turn_started", turn: "acp_c", at });
    await kit.publish(kit.message(id("msg", 1), "acp_c", "user", "call"));
    await kit.publish(kit.message("msg_a3", "acp_c", "agent", "hello"));
    await kit.publish(kit.ended("acp_c"));

    assert.deepEqual([...kit.answers.values()], ["hello"]);
    assert.deepEqual([...kit.finished.values()], ["completed"]);
    assert.deepEqual(kit.failed, []);
  } finally {
    kit.cleanup();
  }
});

test("a call turn that is stopped or fails sends no answer and the call fails back", async () => {
  for (const outcome of ["stopped", "failed"] as const) {
    const kit = setup();
    try {
      await kit.open();
      await kit.queueCall(1);
      await kit.publish({ type: "turn_started", turn: "acp_c", at });
      await kit.publish(kit.message(id("msg", 1), "acp_c", "user", "call"));
      await kit.publish(kit.message("msg_a", "acp_c", "agent", "half"));
      await kit.publish(kit.ended("acp_c", outcome));
      assert.equal(kit.answers.size, 0, outcome);
      assert.deepEqual([...kit.finished.values()], [outcome]);
      assert.deepEqual(kit.failed, [CALL]);
    } finally {
      kit.cleanup();
    }
  }
});

test("a call whose send never opens a turn is closed within the bound, with no file, no live credential, and fails back", async () => {
  const kit = setup();
  try {
    await kit.open();
    await kit.queueCall(1);
    assert.equal(kit.sent.length, 1);
    assert.equal(kit.timers.length, 1);
    kit.timers[0]!();
    await settle();
    assert.equal(kit.fileToken(), null);
    assert.equal(await kit.live(kit.tokens[0]!), false);
    assert.deepEqual([...kit.finished.values()], ["closed"]);
    assert.deepEqual(kit.failed, [CALL]);
  } finally {
    kit.cleanup();
  }
});

test("a call for a member with no tab opens a tab in its project, resuming its CLI session or starting fresh, and is delivered there", async () => {
  for (const cli of ["cli-1", null]) {
    const kit = setup();
    try {
      kit.rows.set(SESSION, {
        project: PROJECT,
        harness: "claude-code",
        cli_session: cli,
      });
      await kit.queueCall(1);
      assert.deepEqual(kit.opens, [
        { project: PROJECT, harness: "claude", cli_session: cli },
      ]);
      // core가 연 터미널의 GUI가 서면 그 팀원으로 묶이고(새로 찾지 않는다) 기다리던 call이 들어간다.
      kit.gui.opened(kit.handle);
      await kit.publish({
        type: "session_changed",
        session: { cli_session: "cli-new", capabilities: {} },
      } as unknown as AcpUpdate);
      assert.equal(kit.ensured(), 0);
      assert.equal(kit.sent.length, 1);
      assert.equal(kit.timers.length, 1, "only the injection wait remains");
    } finally {
      kit.cleanup();
    }
  }
});

test("a call for a member whose tab cannot be opened, or whose opened tab never shows its chat view, fails back", async () => {
  const kit = setup();
  try {
    kit.failOpens();
    await kit.queueCall(1);
    assert.deepEqual(kit.emptied, [SESSION]);
  } finally {
    kit.cleanup();
  }
  const late = setup();
  try {
    await late.queueCall(1);
    assert.equal(late.opens.length, 1);
    late.timers[0]!();
    await settle();
    assert.deepEqual(late.emptied, [SESSION]);
  } finally {
    late.cleanup();
  }
});

test("a call turn cut by toggling a restart tab to the TUI fails back, and a call not yet taken waits for the GUI", async () => {
  const kit = setup();
  try {
    await kit.open();
    await kit.queueCall(1);
    await kit.publish({ type: "turn_started", turn: "acp_c", at });
    await kit.publish(kit.message(id("msg", 1), "acp_c", "user", "call"));
    kit.handle.close();
    await settle();
    assert.deepEqual([...kit.finished.values()], ["closed"]);
    assert.deepEqual(kit.failed, [CALL]);

    // 탭이 TUI를 보이는 동안(handle 없음) 온 call은 그대로 기다리고 새 탭을 열지 않는다.
    await kit.queueCall(2);
    assert.equal(kit.sent.length, 1);
    assert.equal(kit.opens.length, 0);
    assert.deepEqual(kit.failed, [CALL]);
  } finally {
    kit.cleanup();
  }
});
