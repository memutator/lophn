import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createIdSource } from "../../base/id.ts";
import { manualClock, ok, seededRandom } from "../../base/mod.ts";
import type {
  AcpInput,
  AcpSessionHandle,
  AcpTabRequest,
  AcpUpdate,
  GuiHarness,
  HarnessCatalogResult,
  HarnessLaunchConfig,
} from "../../protocol/acp/mod.ts";
import { AGENT_CREDENTIAL_FILE_ENV } from "../../protocol/coding-agent/credential-env.ts";
import type {
  HarnessRecordPart,
  HarnessRuntime,
} from "../../protocol/lophn-agent/mod.ts";
import { createAcp } from "./acp.ts";
import { createBackgroundMembers } from "./background.ts";
import { createCredentialFiles } from "./credential-file.ts";
import type {
  BackgroundSessionInfo,
  HarnessMembers,
  MemberInput,
  MemberTurnEnd,
} from "./member.ts";

const id = (prefix: string, n: number) =>
  `${prefix}_${String(n).padStart(26, "0")}`;
const SESSION = id("ses", 1);
const AT = "2026-11-23T00:00:00.000Z";
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const settle = async () => {
  for (let i = 0; i < 8; i += 1) await flush();
};

function setup(options?: {
  harness?: HarnessRuntime;
  launch?: HarnessLaunchConfig;
  held?: boolean;
  approve?: HarnessMembers["approve"];
}) {
  const root = mkdtempSync(join(tmpdir(), "lophn-bg-member-"));
  const clock = manualClock(Date.parse(AT));
  const ids = createIdSource({ clock, random: seededRandom(1) });
  const files = createCredentialFiles({
    root: join(root, "credentials"),
    fs: {
      mkdir: (path, mode) => void mkdirSync(path, { recursive: true, mode }),
      write: (path, text, mode) => writeFileSync(path, text, { mode }),
      remove: (path) => rmSync(path, { force: true }),
    },
  });

  const queues = new Map<string, MemberInput[]>();
  const queueOf = (session: string) => {
    let list = queues.get(session);
    if (list === undefined) {
      list = [];
      queues.set(session, list);
    }
    return list;
  };
  let turnSeq = 0;
  const recorded: { session: string; turn: string; part: HarnessRecordPart }[] =
    [];
  const finished: { turn: string; end: MemberTurnEnd }[] = [];
  const endedCredentials: string[] = [];
  const failedCalls: string[] = [];
  const boundSessions: { session: string; cli: string }[] = [];
  const catalogSeen: {
    harness: GuiHarness;
    cwd: string | undefined;
    result: HarnessCatalogResult;
  }[] = [];
  const queuedListeners = new Set<(session: string) => void>();
  const turnClosedListeners = new Set<
    (event: { session: string; turn: string }) => void
  >();

  const info: BackgroundSessionInfo = {
    harness: options?.harness ?? "claude-code",
    agent: "agt_00000000000000000000000001",
    cli_session: null,
    fork_from: null,
    held: options?.held ?? false,
  };

  const members: HarnessMembers = {
    ensure: async () => ok(SESSION),
    bind: async (session, cli) => {
      boundSessions.push({ session, cli });
      info.cli_session = cli;
      return ok(undefined);
    },
    next: async (session) => (info.held ? null : (queueOf(session)[0] ?? null)),
    start: async (session, message) => {
      const head = queueOf(session).shift();
      assert.equal(head?.message, message);
      const turn = id("trn", ++turnSeq);
      return ok({ turn, token: `tok_${turn}` });
    },
    credential: async () => ok({ turn: id("trn", ++turnSeq), token: "tok" }),
    record: async (session, turn, part) => {
      recorded.push({ session, turn, part });
      return ok(undefined);
    },
    finish: async (turn, end) => {
      finished.push({ turn, end });
      return ok(undefined);
    },
    failCall: async (_session, call) => {
      failedCalls.push(call);
      return ok(undefined);
    },
    describe: () => null,
    background: (session) => (session === SESSION ? info : null),
    waiting: () =>
      [...queues.entries()].flatMap(([session, list]) =>
        list.length > 0 ? [session] : [],
      ),
    cwd: async () => "/work/bg",
    definition: async () =>
      ok({
        ...(options?.launch === undefined
          ? {}
          : { harness_config: options.launch }),
      }),
    ...(options?.approve === undefined ? {} : { approve: options.approve }),
    forget: async () => ok(0),
    failQueued: async () => ok(undefined),
    end: (turn) => void endedCredentials.push(turn),
    onQueued: (listener) => {
      queuedListeners.add(listener);
      return () => void queuedListeners.delete(listener);
    },
    onTurnClosed: (listener) => {
      turnClosedListeners.add(listener);
      return () => void turnClosedListeners.delete(listener);
    },
  };

  const requests: AcpTabRequest[] = [];
  const receivedInputs: AcpInput[] = [];
  let activeSession: AcpSessionHandle | null = null;
  let closedCount = 0;

  const afterTimers: { ms: number; fn: () => void; cancelled: boolean }[] = [];
  let sweepFn: (() => void) | null = null;

  let tabOpenedCount = 0;
  const { acp } = createAcp(
    ids,
    () => {
      tabOpenedCount += 1;
    },
    (handle) => bg.opened(handle),
  );

  const bg = createBackgroundMembers({
    members: () => members,
    files,
    handlers: () => ({
      async gui(request) {
        requests.push(request);
        const session = acp.open({
          terminal: request.terminal,
          ...(request.key === undefined ? {} : { key: request.key }),
          harness: request.harness,
          title: request.harness,
          handoff: "restart",
        });
        activeSession = session;
        session.onInput((input) => receivedInputs.push(input));
        session.onClose(() => {
          closedCount += 1;
        });
      },
      tui() {},
      running: () => null,
      sessions: async () => [],
      rewindPreview: async () => null,
    }),
    after: (ms, fn) => {
      const entry = { ms, fn, cancelled: false };
      afterTimers.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
    every: (_ms, fn) => {
      sweepFn = fn;
      return () => {
        sweepFn = null;
      };
    },
    onCatalog: (harness, cwd, result) =>
      catalogSeen.push({ harness, cwd, result }),
    log: (message) => assert.fail(`unexpected log: ${message}`),
  });

  const enqueue = async (prompt: string, n = 1) => {
    queueOf(SESSION).push({
      message: id("msg", n),
      kind: "message",
      call: null,
      reply: null,
      prompt,
    });
    for (const listener of queuedListeners) listener(SESSION);
    await settle();
  };

  const emit = async (update: AcpUpdate) => {
    assert.ok(activeSession !== null, "expected open background session");
    activeSession.publish(update);
    await settle();
  };

  const credFile = () => {
    const path = files.pathOf(SESSION);
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  };

  return {
    bg,
    info,
    requests,
    receivedInputs,
    recorded,
    finished,
    endedCredentials,
    failedCalls,
    boundSessions,
    catalogSeen,
    afterTimers,
    tabOpenedCount: () => tabOpenedCount,
    closedCount: () => closedCount,
    credFile,
    enqueue,
    emit,
    sweep: () => sweepFn?.(),
    emitTurnClosed: (turn: string) => {
      for (const listener of turnClosedListeners) {
        listener({ session: SESSION, turn });
      }
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("background run writes/clears credential file, records text and tool parts, binds cli_session, warms catalog, and closes after idle linger", async () => {
  const launch: HarnessLaunchConfig = {
    model: "claude-opus-4-7",
    options: { effort: "high" },
  };
  const kit = setup({ launch });
  try {
    kit.bg.start();
    await kit.enqueue("inspect repo");

    // tab callback은 절대 불리지 않고 background handle만 열린다.
    assert.equal(kit.tabOpenedCount(), 0);
    assert.equal(kit.requests.length, 1);
    assert.equal(kit.requests[0]?.terminal, null);
    assert.equal(kit.requests[0]?.key, `bg:${SESSION}`);
    assert.equal(kit.requests[0]?.cwd, "/work/bg");
    assert.deepEqual(kit.requests[0]?.launch, launch);
    assert.ok(kit.requests[0]?.env?.[AGENT_CREDENTIAL_FILE_ENV]);
    assert.equal(kit.credFile(), `tok_${id("trn", 1)}`);
    assert.equal(kit.bg.isAlive(SESSION), true);

    assert.equal(kit.receivedInputs.length, 1);
    assert.equal(kit.receivedInputs[0]?.type, "send");

    // session_changed로 cli_session 바인딩과 passive catalog warming이 동작한다.
    await kit.emit({
      type: "session_changed",
      session: {
        cli_session: "cli-bg-1",
        capabilities: {},
        models: [
          {
            id: "default",
            label: "Models",
            models: [{ id: "claude-opus-4-7", label: "Opus", axes: [] }],
          },
        ],
        model: {
          model: "claude-opus-4-7",
          label: "Opus",
          options: { effort: "high" },
          layer: null,
        },
      },
    } as unknown as AcpUpdate);
    assert.deepEqual(kit.boundSessions, [
      { session: SESSION, cli: "cli-bg-1" },
    ]);
    assert.equal(kit.catalogSeen.length, 1);
    assert.equal(kit.catalogSeen[0]?.harness, "claude");

    // tool과 agent text가 모두 ledger에 기록된다.
    await kit.emit({ type: "turn_started", turn: "acp_1", at: AT });
    await kit.emit({
      type: "tool_started",
      item: {
        id: "tcl_1",
        seq: 1,
        at: AT,
        kind: "tool",
        by: "agent",
        turn: "acp_1",
        tool: "shell.run",
        category: "command",
        title: "git status",
        state: "running",
        duration_ms: null,
        detail: { kind: "generic" },
        body: null,
      },
    });
    await kit.emit({
      type: "tool_ended",
      tool_call: "tcl_1",
      state: "ok",
      at: AT,
      detail: null,
      body: null,
    });
    await kit.emit({
      type: "message_recorded",
      turn: "acp_1",
      message: "msg_a1",
      model_call: null,
      seq: 2,
      at: AT,
      body: {
        content: [{ type: "text", text: "Repo is clean." }],
        reasoning: null,
        cards: [],
      },
    });
    await kit.emit({
      type: "turn_ended",
      turn: "acp_1",
      at: AT,
      outcome: "completed",
      active_ms: 100,
      error: null,
      messages: [],
      seq: 3,
    });

    assert.equal(kit.credFile(), null);
    assert.deepEqual(kit.endedCredentials, [id("trn", 1)]);
    assert.deepEqual(
      kit.recorded.map((entry) => entry.part),
      [
        {
          kind: "harness_tool",
          name: "shell.run",
          summary: "git status",
          status: "done",
        },
        { kind: "text", text: "Repo is clean." },
      ],
    );
    assert.deepEqual(kit.finished, [{ turn: id("trn", 1), end: "completed" }]);

    // idle linger timer가 걸리고, 시간이 지나면 handle을 닫는다.
    assert.equal(kit.bg.isAlive(SESSION), true);
    const activeTimer = kit.afterTimers.find((one) => !one.cancelled);
    assert.ok(activeTimer !== undefined);
    activeTimer.fn();
    await settle();
    assert.equal(kit.bg.isAlive(SESSION), false);
    assert.equal(kit.closedCount(), 1);
  } finally {
    await kit.bg.stop();
    kit.cleanup();
  }
});

test("background run auto-rejects approvals and auto-cancels questions with recorded notes", async () => {
  const kit = setup();
  try {
    kit.bg.start();
    await kit.enqueue("run checks");
    await kit.emit({ type: "turn_started", turn: "acp_1", at: AT });

    await kit.emit({
      type: "approval_opened",
      approval: {
        id: id("apr", 1),
        subject: { kind: "shell", command: "rm -rf /tmp/x" },
        choices: ["once", "reject"],
        always_patterns: [],
      },
    });
    await kit.emit({
      type: "question_asked",
      group: "grp_1",
      tool_call: id("tcl", 2),
      questions: [
        {
          question: "Continue?",
          header: "Confirm",
          options: [
            { label: "Yes", description: "Proceed" },
            { label: "No", description: "Cancel" },
          ],
          multiSelect: false,
        },
      ],
    });

    const decide = kit.receivedInputs.find((one) => one.type === "decide");
    assert.ok(decide !== undefined && decide.type === "decide");
    assert.equal(decide.choice.kind, "reject");

    const answer = kit.receivedInputs.find((one) => one.type === "answer");
    assert.ok(answer !== undefined && answer.type === "answer");
    assert.equal(answer.answers[0]?.status, "unanswered");

    await kit.emit({
      type: "message_recorded",
      turn: "acp_1",
      message: "msg_a1",
      model_call: null,
      seq: 2,
      at: AT,
      body: {
        content: [{ type: "text", text: "Stopped after denial." }],
        reasoning: null,
        cards: [],
      },
    });
    await kit.emit({
      type: "turn_ended",
      turn: "acp_1",
      at: AT,
      outcome: "completed",
      active_ms: 50,
      error: null,
      messages: [],
      seq: 3,
    });

    const texts = kit.recorded
      .map((entry) => entry.part)
      .filter((part) => part.kind === "text")
      .map((part) => part.text);
    assert.ok(texts.some((text) => text.includes("denied: rm -rf /tmp/x")));
    assert.ok(texts.some((text) => text.includes("denied: agent asked")));
  } finally {
    await kit.bg.stop();
    kit.cleanup();
  }
});

test("background run delegates approval_opened to members.approve: allows permitted calls and rejects denied ones", async () => {
  const kit = setup({
    harness: "antigravity",
    approve: async (_session, subject) => {
      if (subject.kind === "shell" && subject.command.startsWith("git ")) {
        return "allow";
      }
      return { reject: "denied by rule (shell_rule)" };
    },
  });
  try {
    kit.bg.start();
    await kit.enqueue("create worktree");
    await kit.emit({
      type: "turn_started",
      turn: "acp_1",
      at: AT,
    });

    await kit.emit({
      type: "approval_opened",
      approval: {
        id: id("apr", 1),
        subject: { kind: "shell", command: "git worktree add ../wt main" },
        choices: ["once", "reject"],
        always_patterns: [],
      },
    });
    await kit.emit({
      type: "approval_opened",
      approval: {
        id: id("apr", 2),
        subject: { kind: "shell", command: "sudo rm -rf /" },
        choices: ["once", "reject"],
        always_patterns: [],
      },
    });
    await settle();

    const decisions = kit.receivedInputs.filter(
      (one): one is Extract<AcpInput, { type: "decide" }> =>
        one.type === "decide",
    );
    assert.equal(decisions.length, 2);
    assert.deepEqual(decisions[0]?.choice, { kind: "once" });
    assert.deepEqual(decisions[1]?.choice, {
      kind: "reject",
      reason: "denied by rule (shell_rule)",
    });

    const texts = kit.recorded
      .map((entry) => entry.part)
      .filter((part) => part.kind === "text")
      .map((part) => part.text);
    assert.ok(!texts.some((text) => text.includes("git worktree add")));
    assert.ok(texts.some((text) => text.includes("denied: sudo rm -rf /")));
  } finally {
    await kit.bg.stop();
    kit.cleanup();
  }
});

test("background run skips held sessions and evicts idle handles", async () => {
  const heldKit = setup({ held: true });
  try {
    heldKit.bg.start();
    await heldKit.enqueue("hello while held");
    assert.equal(heldKit.requests.length, 0);

    // hold가 풀린 뒤 sweep이 대기 입력을 시작한다.
    heldKit.info.held = false;
    heldKit.sweep();
    await settle();
    assert.equal(heldKit.requests.length, 1);

    // turn 진행 중에는 evict되지 않고, turn 종료 후 유휴 상태에서는 즉시 evict된다.
    assert.equal(heldKit.bg.evict(SESSION), false);
    await heldKit.emit({
      type: "message_recorded",
      turn: "acp_1",
      message: "msg_a",
      model_call: null,
      seq: 1,
      at: AT,
      body: {
        content: [{ type: "text", text: "ok" }],
        reasoning: null,
        cards: [],
      },
    });
    await heldKit.emit({
      type: "turn_ended",
      turn: "acp_1",
      at: AT,
      outcome: "completed",
      active_ms: 10,
      error: null,
      messages: [],
      seq: 2,
    });
    assert.equal(heldKit.bg.evict(SESSION), true);
    assert.equal(heldKit.bg.isAlive(SESSION), false);
  } finally {
    await heldKit.bg.stop();
    heldKit.cleanup();
  }
});

test("human Stop sends ACP stop without double-finishing, and core stop() finishes active turns as closed", async () => {
  const stopKit = setup();
  try {
    stopKit.bg.start();
    await stopKit.enqueue("long task");
    await stopKit.emit({ type: "turn_started", turn: "acp_stop", at: AT });

    // 사람이 StopTurn으로 ledger turn을 닫으면 ACP stop만 보내고 finish()는 다시 부르지 않는다.
    stopKit.emitTurnClosed(id("trn", 1));
    await settle();
    assert.equal(stopKit.credFile(), null);
    assert.ok(
      stopKit.receivedInputs.some(
        (one) => one.type === "stop" && one.turn === "acp_stop",
      ),
    );
    await stopKit.emit({
      type: "turn_ended",
      turn: "acp_stop",
      at: AT,
      outcome: "stopped",
      active_ms: 10,
      error: null,
      messages: [],
      seq: 2,
    });
    assert.deepEqual(stopKit.finished, []);
  } finally {
    await stopKit.bg.stop();
    stopKit.cleanup();
  }

  const shutdownKit = setup();
  try {
    shutdownKit.bg.start();
    await shutdownKit.enqueue("work during shutdown");
    await shutdownKit.emit({ type: "turn_started", turn: "acp_down", at: AT });
    assert.ok(shutdownKit.credFile() !== null);

    await shutdownKit.bg.stop();
    assert.equal(shutdownKit.credFile(), null);
    assert.equal(shutdownKit.bg.isAlive(SESSION), false);
    assert.deepEqual(shutdownKit.finished, [
      { turn: id("trn", 1), end: "closed" },
    ]);
  } finally {
    shutdownKit.cleanup();
  }
});
