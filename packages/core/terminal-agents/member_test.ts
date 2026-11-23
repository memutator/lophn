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
import type { WorkflowOrigin } from "../../protocol/workflows/values.ts";
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
  // ledger 쪽. 팀원마다의 queue, 남긴 답 글, 닫은 turn, 실패로 돌려준 call.
  const queues = new Map<string, MemberInput[]>();
  const queueOf = (session: string) => {
    let list = queues.get(session);
    if (list === undefined) {
      list = [];
      queues.set(session, list);
    }
    return list;
  };
  const answers = new Map<string, string>();
  const finished = new Map<string, MemberTurnEnd>();
  const failed: string[] = [];
  const listeners = new Set<(session: string) => void>();
  let lateCredential: (() => void) | null = null;
  let startHold: Promise<void> | null = null;
  let holding = false;
  // 열린 팀원 session의 ledger 모습과, 탭을 열지 못해 비운 queue.
  const rows = new Map<
    string,
    {
      project: string;
      harness: "claude-code";
      cli_session: string | null;
      team: boolean;
      workflow_origin?: WorkflowOrigin | null;
    }
  >([
    [
      SESSION,
      {
        project: PROJECT,
        harness: "claude-code",
        cli_session: "cli-1",
        team: false,
      },
    ],
  ]);
  const emptied: string[] = [];
  const takenSeen: string[][] = [];
  let ensured = 0;
  const members: HarnessMembers = {
    ensure: async (input) => {
      ensured += 1;
      takenSeen.push([...input.taken]);
      return ok(SESSION);
    },
    describe: (session) => rows.get(session) ?? null,
    forget: async () => ok(0),
    holding: () => holding,
    failQueued: async (session) => {
      emptied.push(session);
      queueOf(session).splice(0);
      return ok(undefined);
    },
    bind: async () => ok(undefined),
    next: async (session) => queueOf(session)[0] ?? null,
    start: async (session, message) => {
      if (startHold !== null) await startHold;
      assert.equal(queueOf(session).shift()?.message, message);
      return ok(issue());
    },
    credential: () =>
      lateCredential === null
        ? Promise.resolve(ok(issue()))
        : new Promise((resolve) => {
            lateCredential = () => resolve(ok(issue()));
          }),
    record: async (_session, turn, part) => {
      if (part.kind === "text") answers.set(turn, part.text);
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
  const opens: {
    project: string;
    harness: string;
    cli_session: string | null;
    workflow_origin?: WorkflowOrigin | null;
  }[] = [];
  const closed: string[] = [];
  let opensFail = false;
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
        : ok(opens.length === 1 ? TERMINAL : id("trm", opens.length));
    },
    closeTerminal: (ref) => void closed.push(ref),
    log: () => {},
  });
  gui.listen();

  // 탭의 handle. adapter가 낼 갱신을 test가 직접 낸다.
  let seq = 0;
  const tab = (terminal: string) => {
    let state: AcpState = EMPTY_ACP_STATE;
    const sent: AcpInput[] = [];
    const attached = new Set<Parameters<TabHandle["attach"]>[0]>();
    const handle = {
      id: `win_${terminal}`,
      terminal,
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
    const open = async (cli = "cli-1") => {
      gui.opened(handle);
      await publish({
        type: "session_changed",
        session: { cli_session: cli, capabilities: {} },
      } as unknown as AcpUpdate);
    };
    return { handle, publish, sent, open };
  };
  const main = tab(TERMINAL);
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
  const queueCall = async (n: number, session = SESSION) => {
    queueOf(session).push({
      message: id("msg", n),
      kind: "call",
      call: id("cal", n),
      reply: "result",
      prompt: `<lophn-call from="lead" call="${id("cal", n)}" reply="result">\nask\n</lophn-call>`,
    });
    for (const listener of listeners) listener(session);
    await settle();
  };
  const fileToken = () => {
    const path = files.pathOf(TERMINAL);
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  };
  const live = async (token: string) => (await registry.authenticate(token)).ok;
  return {
    root,
    gui,
    tab,
    handle: main.handle,
    publish: main.publish,
    sent: main.sent,
    open: () => main.open(),
    message,
    ended,
    queueCall,
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
    closed,
    emptied,
    takenSeen,
    ensured: () => ensured,
    hold: (value: boolean) => {
      holding = value;
    },
    failOpens: () => {
      opensFail = true;
    },
    holdStart: () => {
      let release = () => {};
      startHold = new Promise((resolve) => {
        release = () => {
          startHold = null;
          resolve();
        };
      });
      return release;
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
        team: false,
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

const turnStarted = (turn: string): AcpUpdate => ({
  type: "turn_started",
  turn,
  at,
});

// 결정 B: core가 연 탭은 project마다 일하는 것이 8개까지다. 아홉째는 자리가 날 때까지 줄 서고, 자리는 일하던 탭이 끝나면 난다.
test("a ninth call in a project waits for a free slot instead of failing back, and opens when a working tab ends", async () => {
  const kit = setup();
  try {
    for (let n = 1; n <= 9; n += 1) {
      kit.rows.set(id("ses", 100 + n), {
        project: PROJECT,
        harness: "claude-code",
        cli_session: null,
        team: false,
      });
      await kit.queueCall(n, id("ses", 100 + n));
    }
    assert.equal(kit.opens.length, 8);
    assert.deepEqual(kit.emptied, []);
    // 일하는 탭 하나가 끝나 자리가 나면 줄 선 팀원이 열린다.
    kit.gui.terminalEnded(TERMINAL);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(kit.opens.length, 9);
  } finally {
    kit.cleanup();
  }
});

test("a failed call turn keeps the adapter's error in the ledger turn, and a tab holding open work is not closed", async () => {
  for (const held of [false, true]) {
    const kit = setup();
    try {
      kit.hold(held);
      await kit.queueCall(1);
      await kit.open();
      await kit.publish(turnStarted("acp_c"));
      await kit.publish(kit.message(id("msg", 1), "acp_c", "user", "call"));
      await kit.publish({
        ...kit.ended("acp_c", "failed"),
        error: { code: "internal", message: "No conversation found" },
      } as AcpUpdate);
      assert.deepEqual(kit.failed, [id("cal", 1)]);
      assert.match([...kit.answers.values()].join(), /No conversation found/);
      assert.deepEqual(kit.closed, held ? [] : [TERMINAL]);
    } finally {
      kit.cleanup();
    }
  }
});

test("only one tab opens for a member even when two calls arrive at once", async () => {
  const kit = setup();
  try {
    await Promise.all([kit.queueCall(1), kit.queueCall(2)]);
    assert.equal(kit.opens.length, 1);
  } finally {
    kit.cleanup();
  }
});

// 결정 B: core가 call을 받으려고 연 탭은 할 일이 끝나면 닫는다. 팀원과 사람이 손댄 탭은 두고, 사람이 연 탭은 닫지 않는다.
test("a tab core opened for a call closes when its work is done, unless it is a team member or the person used it", async () => {
  for (const variant of ["plain", "team", "touched", "person"] as const) {
    const kit = setup();
    try {
      kit.rows.set(SESSION, {
        project: PROJECT,
        harness: "claude-code",
        cli_session: "cli-1",
        team: variant === "team",
      });
      if (variant === "person") await kit.open();
      if (variant === "touched") {
        await kit.queueCall(9);
        // core가 연 탭이 서기 전에 사람이 그 탭에서 turn을 하나 돌렸다.
        await kit.open();
        await kit.publish(turnStarted("acp_person"));
        await kit.publish(kit.message("msg_p", "acp_person", "user", "hi"));
        await kit.publish(kit.ended("acp_person"));
        // 그 사이 들어간 call 9를 끝낸다.
        await kit.publish(turnStarted("acp_9"));
        await kit.publish(kit.message(id("msg", 9), "acp_9", "user", "call"));
        await kit.publish(kit.message("msg_a9", "acp_9", "agent", "ok"));
        await kit.publish(kit.ended("acp_9"));
      }
      await kit.queueCall(1);
      if (variant === "plain" || variant === "team") await kit.open();
      await kit.publish(turnStarted("acp_c"));
      await kit.publish(kit.message(id("msg", 1), "acp_c", "user", "call"));
      await kit.publish(kit.message("msg_a", "acp_c", "agent", "done"));
      await kit.publish(kit.ended("acp_c"));
      assert.deepEqual(
        kit.closed,
        variant === "plain" ? [TERMINAL] : [],
        variant,
      );
    } finally {
      kit.cleanup();
    }
  }
});

// 결정 D: call의 turn 중에 사람이 넣은 steer는 그 turn을 사람의 것으로 바꾸지 않는다.
test("a person's steer during a call's turn keeps the turn as the call's, and its last text is the answer", async () => {
  const kit = setup();
  try {
    await kit.open();
    await kit.queueCall(1);
    await kit.publish(turnStarted("acp_c"));
    await kit.publish(kit.message(id("msg", 1), "acp_c", "user", "call"));
    await kit.publish(kit.message("msg_steer", "acp_c", "user", "be brief"));
    await kit.publish(kit.message("msg_a", "acp_c", "agent", "brief answer"));
    await kit.publish(kit.ended("acp_c"));
    assert.deepEqual([...kit.answers.values()], ["brief answer"]);
    assert.deepEqual(kit.failed, []);
  } finally {
    kit.cleanup();
  }
});

// 결함 1: 탭이 닫혀도 queue에 남은 call은 다시 연 탭으로 가고, core가 연 탭이 GUI 전에 닫히면 기다리던 call은 실패로 돌아간다.
test("a tab closed with a call still queued reopens for it, and a tab closed before its chat view fails the waiting call back", async () => {
  const kit = setup();
  try {
    await kit.open();
    await kit.queueCall(1);
    await kit.queueCall(2);
    kit.gui.terminalEnded(TERMINAL);
    await settle();
    assert.deepEqual(kit.failed, [id("cal", 1)]);
    assert.equal(kit.opens.length, 1, "the member's tab opens again");
    kit.gui.terminalEnded(TERMINAL);
    await settle();
    assert.deepEqual(kit.emptied, [SESSION]);
  } finally {
    kit.cleanup();
  }
});

// 결함 2: GUI가 늦게 서도 같은 팀원에 둘째 탭을 열지 않고, 다른 탭이 그 팀원을 잇지 않는다.
test("a slow opened tab is kept until it ends: no second tab opens for its member and no other tab takes that member", async () => {
  const kit = setup();
  try {
    await kit.queueCall(1);
    kit.timers[0]!();
    await settle();
    assert.deepEqual(kit.emptied, [SESSION]);
    await kit.queueCall(2);
    assert.equal(kit.opens.length, 1);
    assert.deepEqual(kit.emptied, [SESSION, SESSION]);
    // 사람이 다른 탭에서 같은 CLI session을 열어도 그 팀원은 기다리는 탭의 것이다.
    const other = kit.tab(id("trm", 50));
    await other.open();
    assert.ok(kit.takenSeen.at(-1)?.includes(SESSION));
  } finally {
    kit.cleanup();
  }
});

// 결함 3: call은 그 입력이 연 turn에서만 답한다.
test("a call taken into a turn a person message started is never answered from that turn and fails back", async () => {
  const kit = setup();
  try {
    await kit.open();
    await kit.queueCall(1);
    await kit.publish(turnStarted("acp_x"));
    await kit.publish(kit.message("msg_person", "acp_x", "user", "2+2?"));
    await kit.publish(kit.message(id("msg", 1), "acp_x", "user", "call"));
    await kit.publish(kit.message("msg_a", "acp_x", "agent", "4"));
    await kit.publish(kit.ended("acp_x"));
    assert.equal(kit.answers.size, 0);
    assert.deepEqual([...kit.finished.values()], ["stopped"]);
    assert.deepEqual(kit.failed, [CALL]);
  } finally {
    kit.cleanup();
  }
});

test("a person turn that starts while the call's ledger turn opens delays the call until the tab is idle again", async () => {
  const kit = setup();
  try {
    await kit.open();
    const release = kit.holdStart();
    await kit.queueCall(1);
    await kit.publish(turnStarted("acp_p"));
    await kit.publish(kit.message("msg_person", "acp_p", "user", "hi"));
    release();
    await settle();
    assert.equal(kit.sent.length, 0, "not sent into the person's turn");
    await kit.publish(kit.ended("acp_p"));
    assert.equal(kit.sent.length, 1);
  } finally {
    kit.cleanup();
  }
});

// 결함 4: 한도가 지나 실패로 돌려준 call이 adapter의 줄에 남아 나중에 사람 turn으로 돌지 않는다.
test("a call that times out while still queued in the adapter is removed from that queue", async () => {
  const kit = setup();
  try {
    await kit.open();
    await kit.queueCall(1);
    await kit.publish({
      type: "message_queued",
      queued: { id: id("msg", 1), at, content: [] },
    } as unknown as AcpUpdate);
    kit.timers.at(-1)!();
    await settle();
    assert.deepEqual(
      kit.sent.map((input) => input.type),
      ["send", "remove_queued"],
    );
    assert.deepEqual(kit.failed, [CALL]);
  } finally {
    kit.cleanup();
  }
});

test("a turn first seen as the person's and then found to be the call's ends the person credential", async () => {
  const kit = setup();
  try {
    await kit.open();
    await kit.queueCall(1);
    await kit.publish(turnStarted("acp_c"));
    const personToken = kit.tokens.at(-1)!;
    await kit.publish(kit.message(id("msg", 1), "acp_c", "user", "call"));
    assert.equal(await kit.live(personToken), false);
    assert.notEqual(kit.fileToken(), personToken);
  } finally {
    kit.cleanup();
  }
});

test("stopping the member binding removes every credential file", async () => {
  const kit = setup();
  try {
    await kit.open();
    await kit.publish(turnStarted("acp_1"));
    assert.ok(kit.fileToken() !== null);
    kit.gui.stop();
    assert.equal(kit.fileToken(), null);
  } finally {
    kit.cleanup();
  }
});

// workflow_origin이 다른 project를 가리켜도 PTY는 실행 project에 열고, UI 창이 그 workflow workspace를 보지 않아
// tab_open이 대기 중이어도 PTY의 GUI handle이 서면 OPEN_WAIT_MS가 풀려 timeout하지 않는다.
test("a member with cross-project workflow_origin opens in its exec project, forwards origin, and clears OPEN_WAIT_MS when GUI attaches", async () => {
  const kit = setup();
  const origin: WorkflowOrigin = {
    project: id("prj", 9) as WorkflowOrigin["project"],
    workflow: "ship-it",
    instance: id("wfi", 7) as WorkflowOrigin["instance"],
    step: "implement",
  };
  try {
    kit.rows.set(SESSION, {
      project: PROJECT,
      harness: "claude-code",
      cli_session: "cli-1",
      team: false,
      workflow_origin: origin,
    });
    await kit.queueCall(1);
    assert.deepEqual(kit.opens, [
      {
        project: PROJECT,
        harness: "claude",
        cli_session: "cli-1",
        workflow_origin: origin,
      },
    ]);
    assert.equal(kit.timers.length, 1);
    // UI 창이 workflow workspace를 보지 않아도 PTY가 바로 띄운 GUI handle이 붙으면 OPEN_WAIT_MS timer가 해제된다.
    await kit.open();
    assert.equal(kit.emptied.length, 0);
    assert.equal(kit.sent.length, 1);
    // 남아 있는 timer는 OPEN_WAIT_MS가 아니라 INJECT_WAIT_MS 하나뿐이다.
    assert.equal(kit.timers.length, 1);
  } finally {
    kit.cleanup();
  }
});
