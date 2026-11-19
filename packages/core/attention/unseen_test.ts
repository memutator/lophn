import assert from "node:assert/strict";
import { test } from "node:test";
import { manualClock } from "../../base/mod.ts";
import type { BusEvent } from "../../protocol/events/mod.ts";
import { createAttention, type PushMessage } from "./mod.ts";

const SESSION = "ses_a";

function setup(opened_by_app = false) {
  const clock = manualClock(1_700_000_000_000);
  const changed: string[] = [];
  const attention = createAttention({
    clock,
    lookup: async () => ({
      title: "t",
      agent: "a",
      harness: null,
      opened_by_app,
    }),
    deviceKind: (principal) =>
      principal.startsWith("device:") ? "phone" : null,
    unseenChanged: (session) => changed.push(session),
  });
  const send = (type: string, payload: unknown = {}) =>
    attention.event({ type, session: SESSION, payload } as unknown as BusEvent);
  const ended = () =>
    send("TurnEnded", { outcome: { kind: "completed" }, active_ms: 1000 });
  const sessions = () => attention.unseenList().map((item) => item.session);
  return { clock, attention, send, ended, sessions, changed };
}

test("unseen은 앞에 있는 host가 보고 있지 않을 때만 서고 다른 host가 보면 꺼진다", async () => {
  const { attention, ended, sessions, changed } = setup();
  // 앞에 있지만 다른 session을 보는 desktop: 선다.
  attention.report("user", {
    focused: true,
    idle_ms: 0,
    looking: ["ses_other"],
  });
  await ended();
  assert.deepEqual(sessions(), [SESSION]);
  assert.deepEqual(changed, [SESSION]);
  // 폰이 앞에서 그 session을 보면 꺼진다.
  attention.report("device:dev_1", { focused: true, looking: [SESSION] });
  assert.deepEqual(sessions(), []);
  // 이미 보고 있는 동안 끝나면 서지 않는다.
  await ended();
  assert.deepEqual(sessions(), []);
  // 앞에 있지 않은(focus 없음) host가 보고 있다고 해도 본 것이 아니다.
  attention.forgetReporter("device:dev_1");
  attention.report("user", { focused: false, idle_ms: 0, looking: [SESSION] });
  await ended();
  assert.deepEqual(sessions(), [SESSION]);
});

test("승인·질문 대기와 app이 연 session의 끝은 unseen을 세우지 않고 다음 turn이 끄고 사람이 지운다", async () => {
  const { send, ended, sessions, attention } = setup();
  await send("TurnRequestOpened", { request: { to_parent: false } });
  await send("QuestionAsked", { to_parent: false });
  assert.deepEqual(sessions(), []);
  await ended();
  assert.deepEqual(sessions(), [SESSION]);
  await send("TurnStarted");
  assert.deepEqual(sessions(), []);
  await ended();
  assert.equal(attention.dismiss(SESSION), true);
  assert.equal(attention.dismiss(SESSION), false);

  const app = setup(true);
  await app.ended();
  assert.deepEqual(app.sessions(), []);
});

test("GUI 탭 coding session의 승인·질문 AcpUpdated는 push를 보내고 TUI hook과 겹치지 않으며 unseen을 맞춘다", async () => {
  const GUI_SESSION = "ses_01h455vb4pex5v6nkc6gd5f010";
  const GUI_TERMINAL = "trm_01h455vb4pex5v6nkc6gd5f010";
  const TUI_TERMINAL = "trm_01h455vb4pex5v6nkc6gd5f011";
  const clock = manualClock(1_700_000_000_000);
  const pushed: PushMessage[] = [];
  let guiActive = true;

  const attention = createAttention({
    clock,
    lookup: async () => null,
    codingSession: (session) =>
      guiActive && session === GUI_SESSION
        ? {
            terminal_ref: GUI_TERMINAL,
            harness: "claude",
            title: "Fix bug",
          }
        : null,
    isGuiTerminal: (terminalRef) => guiActive && terminalRef === GUI_TERMINAL,
    deviceKind: (principal) =>
      principal.startsWith("device:") ? "phone" : null,
    unseenChanged: () => {},
  });
  attention.bindPush({
    host: () => "host-key",
    devices: () => [
      {
        id: "dev_1",
        token: "ExponentPushToken[1]",
        prefs: {
          needs_you: true,
          long_finish: true,
          app_update: true,
          job_missed: true,
          app_notify: true,
          quiet_when_present: true,
          show_names: true,
        },
      },
    ],
    send: async (message) => {
      pushed.push(message);
      return "sent";
    },
  });

  const acpEvent = (session: string, update: unknown) =>
    attention.event({
      type: "AcpUpdated",
      session,
      subject: null,
      at: clock.now(),
      payload: { session, update },
    } as unknown as BusEvent);

  // 1) GUI 탭 승인 열림 -> term:<탭>으로 needs-you high push.
  await acpEvent(GUI_SESSION, {
    type: "approval_opened",
    approval: {
      id: "apr_1",
      subject: { kind: "shell", command: "rm -rf /tmp/x" },
      choices: ["once", "reject"],
      always_patterns: [],
    },
  });
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0]!.channelId, "needs-you");
  assert.equal(pushed[0]!.priority, "high");
  assert.equal(pushed[0]!.title, "Fix bug is waiting for you");
  assert.equal(pushed[0]!.body, "claude asks for approval.");
  assert.deepEqual(pushed[0]!.data, {
    host: "host-key",
    kind: "session",
    session: `term:${GUI_TERMINAL}`,
  });

  // 2) GUI 탭 질문과 subagent(child_update) 승인도 push를 보낸다.
  await acpEvent(GUI_SESSION, {
    type: "question_asked",
    group: "grp_1",
    tool_call: "tcl_1",
    questions: null,
  });
  await acpEvent(GUI_SESSION, {
    type: "child_update",
    child: "child_1",
    update: {
      type: "approval_opened",
      approval: {
        id: "apr_2",
        subject: { kind: "shell", command: "ls" },
        choices: ["once", "reject"],
        always_patterns: [],
      },
    },
  });
  assert.equal(pushed.length, 3);
  assert.equal(pushed[1]!.title, "Fix bug has a question");
  assert.equal(pushed[2]!.title, "Fix bug is waiting for you");

  // 3) lophn session의 AcpUpdated(codingSession이 null)는 중복 push하지 않는다.
  await acpEvent("ses_01h455vb4pex5v6nkc6gd5f099", {
    type: "approval_opened",
    approval: {
      id: "apr_3",
      subject: { kind: "shell", command: "ls" },
      choices: ["once", "reject"],
      always_patterns: [],
    },
  });
  assert.equal(pushed.length, 3);

  // 4) GUI view인 동안 같은 터미널의 hook waiting signal은 중복 push하지 않고, TUI 터미널은 그대로 push한다.
  attention.signal({
    terminal_ref: GUI_TERMINAL,
    harness: "claude",
    title: "Fix bug",
    kind: "waiting",
    active_ms: null,
  });
  assert.equal(pushed.length, 3);
  attention.signal({
    terminal_ref: TUI_TERMINAL,
    harness: "codex",
    title: "TUI",
    kind: "waiting",
    active_ms: null,
  });
  assert.equal(pushed.length, 4);

  // 5) GUI 탭의 turn_ended는 unseen을 세우고, turn_started는 지운다.
  await acpEvent(GUI_SESSION, {
    type: "turn_ended",
    turn: "trn_1",
    at: clock.now(),
    outcome: "completed",
    active_ms: null,
    error: null,
    messages: [],
    seq: 1,
  });
  assert.deepEqual(
    attention.unseenList().map((item) => item.session),
    [`term:${GUI_TERMINAL}`],
  );
  await acpEvent(GUI_SESSION, {
    type: "turn_started",
    turn: "trn_2",
    at: clock.now(),
  });
  assert.deepEqual(attention.unseenList(), []);

  // 6) desktop이 앞에 있으면 quiet_when_present 규칙이 GUI 탭 승인에도 똑같이 적용된다.
  attention.report("user", { focused: true, idle_ms: 0, looking: [] });
  await acpEvent(GUI_SESSION, {
    type: "approval_opened",
    approval: {
      id: "apr_4",
      subject: { kind: "shell", command: "ls" },
      choices: ["once", "reject"],
      always_patterns: [],
    },
  });
  assert.equal(pushed.length, 4);

  // 7) TUI view로 전환된 뒤에는 background handle의 AcpUpdated는 무시된다.
  attention.report("user", { focused: false, idle_ms: 0, looking: [] });
  guiActive = false;
  await acpEvent(GUI_SESSION, {
    type: "approval_opened",
    approval: {
      id: "apr_5",
      subject: { kind: "shell", command: "ls" },
      choices: ["once", "reject"],
      always_patterns: [],
    },
  });
  assert.equal(pushed.length, 4);
});
