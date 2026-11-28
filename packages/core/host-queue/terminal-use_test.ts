import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createIdSource,
  err,
  manualClock,
  ok,
  seededRandom,
} from "../../base/mod.ts";
import type { Id } from "../../protocol/base/ids.ts";
import type {
  TerminalOutput,
  TerminalRuntime,
} from "../../protocol/coding-agent/terminals.ts";
import {
  TERMINAL_PERSON_CONTROLLING_MESSAGE,
  type TerminalModes,
} from "../../protocol/lophn-agent/terminal-use.ts";
import type { TuiScreenSnapshot } from "../terminals/host/screen.ts";
import type { Terminals } from "../terminals/ports.ts";
import { createHostQueue } from "./queue.ts";
import { createTerminalUseDriver } from "./terminal-use.ts";

const OWNER = "ses_owner" as Id<"ses">;
const OTHER = "ses_other" as Id<"ses">;
const HOME = { kind: "home" } as const;

const BASE_MODES: TerminalModes = {
  application_cursor_keys: false,
  bracketed_paste: false,
  alt_screen: false,
  cursor_visible: true,
  mouse_tracking: "none",
  mouse_encoding: "default",
  kitty_keyboard_flags: 0,
};

function fakeTerminals() {
  let runtime: TerminalRuntime = {
    terminal_ref: "trm_1",
    generation: 1,
    project: "home",
    folder_ref: "home_0",
    cwd_at_start: "/home/alice",
    program_path: "/bin/bash",
    columns: 120,
    rows: 36,
    state: "running",
    exit_code: null,
    exit_signal: null,
    failure_reason: null,
    output_seq: 1,
    dropped_output: false,
  };
  let screen = "ready $";
  let title = "bash";
  let visualHash = "hash-1";
  let scrollback = "old line";
  let highlights = [{ row: 0, col_start: 0, col_end: 5, text: "ready" }];
  let modes: TerminalModes = { ...BASE_MODES };
  const writes: string[] = [];
  const resizes: { columns: number; rows: number }[] = [];
  const outputListeners = new Set<(chunks: TerminalOutput[]) => void>();
  const runtimeListeners = new Set<(rt: TerminalRuntime) => void>();

  const makeSnap = (opts?: { scrollback?: number }): TuiScreenSnapshot => ({
    seq: runtime.output_seq,
    columns: runtime.columns,
    rows: runtime.rows,
    title,
    cursor: { x: 7, y: 0, visible: true },
    modes,
    screen,
    ...(opts?.scrollback ? { scrollback } : {}),
    highlights,
    truncated: false,
    visual_hash: visualHash,
  });

  const api: Pick<
    Terminals,
    | "tuiState"
    | "tuiSnapshot"
    | "write"
    | "resize"
    | "runtime"
    | "onOutput"
    | "onRuntime"
  > = {
    async tuiState(ref) {
      if (ref !== runtime.terminal_ref) {
        return err({ code: "not_found", message: "missing" });
      }
      return ok({
        runtime,
        state: {
          seq: runtime.output_seq,
          columns: runtime.columns,
          rows: runtime.rows,
          title,
          cursor: { x: 7, y: 0, visible: true },
          modes,
          visual_hash: visualHash,
        },
      });
    },
    async tuiSnapshot(ref, options) {
      if (ref !== runtime.terminal_ref) {
        return err({ code: "not_found", message: "missing" });
      }
      return ok({ runtime, snapshot: makeSnap(options) });
    },
    async write(ref, text) {
      if (ref !== runtime.terminal_ref) {
        return err({ code: "not_found", message: "missing" });
      }
      writes.push(text);
      return ok(undefined);
    },
    async resize(ref, _gen, size) {
      if (ref !== runtime.terminal_ref) {
        return err({ code: "not_found", message: "missing" });
      }
      resizes.push(size);
      runtime = { ...runtime, columns: size.columns, rows: size.rows };
      return ok(runtime);
    },
    runtime(ref) {
      return ref === runtime.terminal_ref ? runtime : null;
    },
    onOutput(listener) {
      outputListeners.add(listener);
      return () => outputListeners.delete(listener);
    },
    onRuntime(listener) {
      runtimeListeners.add(listener);
      return () => runtimeListeners.delete(listener);
    },
  };

  return {
    api,
    writes,
    resizes,
    setModes(next: Partial<TerminalModes>) {
      modes = { ...modes, ...next };
    },
    setContent(next: {
      screen?: string;
      title?: string;
      visualHash?: string;
      scrollback?: string;
      highlights?: TuiScreenSnapshot["highlights"];
    }) {
      if (next.screen !== undefined) screen = next.screen;
      if (next.title !== undefined) title = next.title;
      if (next.visualHash !== undefined) visualHash = next.visualHash;
      if (next.scrollback !== undefined) scrollback = next.scrollback;
      if (next.highlights !== undefined) highlights = next.highlights;
      runtime = { ...runtime, output_seq: runtime.output_seq + 1 };
      const chunk: TerminalOutput = {
        terminal_ref: runtime.terminal_ref,
        generation: runtime.generation,
        seq: runtime.output_seq,
        chunk: next.screen ?? "",
        dropped_output: false,
      };
      for (const listener of outputListeners) listener([chunk]);
    },
    exit(code: number) {
      runtime = { ...runtime, state: "exited", exit_code: code };
      for (const listener of runtimeListeners) listener(runtime);
    },
  };
}

test("소유권 격리와 take control: 남의 탭은 not_found, 사람이 가져간 동안 act·resize는 conflict이고 read·snapshot·wait는 된다", async () => {
  const clock = manualClock(1_700_000_000_000);
  const ids = createIdSource({ clock, random: seededRandom(1) });
  const queue = createHostQueue({ clock, ids });
  const term = fakeTerminals();
  const driver = createTerminalUseDriver({
    queue,
    terminals: term.api,
    clock,
    redact: (text) => text,
  });

  const tab = queue.openTab({
    owner: OWNER,
    workspace: HOME,
    target: { terminal: { terminal_ref: "trm_1" } },
    relation: "work",
    source: OWNER,
    drivableTerminal: true,
  });

  // coding/tui처럼 drivableTerminal 표시가 없는 터미널 탭은 terminal-use로 다루지 못한다.
  const codingTab = queue.openTab({
    owner: OWNER,
    workspace: HOME,
    target: { terminal: { terminal_ref: "trm_1" } },
    relation: "aside",
    source: OWNER,
  });
  const codingRead = await driver.read(codingTab, OWNER);
  assert.ok(!codingRead.ok && codingRead.error.code === "not_found");

  // 다른 session에게는 없는 탭과 같은 not_found다.
  const otherRead = await driver.read(tab, OTHER);
  assert.ok(!otherRead.ok && otherRead.error.code === "not_found");
  const otherAct = await driver.act(OTHER, { tab, type: "type", text: "ls" });
  assert.ok(!otherAct.ok && otherAct.error.code === "not_found");

  // 주인은 정상적으로 DECCKM 모드를 반영해 키를 보낸다.
  term.setModes({ application_cursor_keys: true });
  const acted = await driver.act(OWNER, { tab, type: "press", keys: ["Up"] });
  assert.ok(acted.ok);
  assert.deepEqual(term.writes, ["\x1bOA"]);

  // 사람이 take control하면 쓰기·리사이즈는 고정 conflict 문장, 읽기·스냅샷·wait는 허용된다.
  assert.equal(queue.setTerminalControl("trm_1", true), true);
  const blockedAct = await driver.act(OWNER, { tab, type: "type", text: "hi" });
  assert.ok(!blockedAct.ok);
  assert.equal(blockedAct.error.code, "conflict");
  assert.equal(blockedAct.error.message, TERMINAL_PERSON_CONTROLLING_MESSAGE);

  const blockedResize = await driver.resize(tab, OWNER, {
    columns: 100,
    rows: 30,
  });
  assert.ok(!blockedResize.ok && blockedResize.error.code === "conflict");

  const readWhileHeld = await driver.read(tab, OWNER);
  assert.ok(readWhileHeld.ok);
  assert.equal(readWhileHeld.value.person_controlling, true);
  const snapWhileHeld = await driver.snapshot(tab, OWNER);
  assert.ok(snapWhileHeld.ok);
  assert.equal(snapWhileHeld.value.person_controlling, true);
  const waitWhileHeld = await driver.wait(OWNER, { tab, text: "ready $" });
  assert.ok(waitWhileHeld.ok && waitWhileHeld.value.matched);

  // Hand back 뒤 다시 쓸 수 있다.
  assert.equal(queue.setTerminalControl("trm_1", false), true);
  const resized = await driver.resize(tab, OWNER, { columns: 100, rows: 30 });
  assert.ok(resized.ok);
  assert.deepEqual(term.resizes, [{ columns: 100, rows: 30 }]);
});

test("known-value redaction은 화면·제목·scrollback·highlights에서 비밀을 지우고, redactor 실패 시 unavailable로 차단한다", async () => {
  const clock = manualClock(1_700_000_000_000);
  const ids = createIdSource({ clock, random: seededRandom(2) });
  const queue = createHostQueue({ clock, ids });
  const term = fakeTerminals();
  const SECRET = "sk-live-secret-999";
  term.setContent({
    screen: `token=${SECRET}`,
    title: `title ${SECRET}`,
    scrollback: `prev ${SECRET}`,
    highlights: [{ row: 0, col_start: 0, col_end: 20, text: SECRET }],
    visualHash: "hash-sec",
  });

  const tab = queue.openTab({
    owner: OWNER,
    workspace: HOME,
    target: { terminal: { terminal_ref: "trm_1" } },
    relation: "work",
    source: OWNER,
    drivableTerminal: true,
  });

  const redacted = createTerminalUseDriver({
    queue,
    terminals: term.api,
    clock,
    redact: (text) => text.replaceAll(SECRET, "[REDACTED]"),
  });
  const snap = await redacted.snapshot(tab, OWNER, { scrollback: 10 });
  assert.ok(snap.ok);
  assert.equal(snap.value.screen, "token=[REDACTED]");
  assert.equal(snap.value.title, "title [REDACTED]");
  assert.equal(snap.value.scrollback, "prev [REDACTED]");
  assert.equal(snap.value.highlights[0]?.text, "[REDACTED]");

  const failing = createTerminalUseDriver({
    queue,
    terminals: term.api,
    clock,
    redact: () => null,
  });
  const blockedSnap = await failing.snapshot(tab, OWNER);
  assert.ok(!blockedSnap.ok && blockedSnap.error.code === "unavailable");
  const blockedRead = await failing.read(tab, OWNER);
  assert.ok(!blockedRead.ok && blockedRead.error.code === "unavailable");
});

test("wait는 프로세스 종료 시 비-exit 대기를 즉시 깨우고, 시간 초과 시 matched=false와 최신 스냅샷을 돌려준다", async () => {
  const clock = manualClock(1_700_000_000_000);
  const ids = createIdSource({ clock, random: seededRandom(3) });
  const queue = createHostQueue({ clock, ids });
  const term = fakeTerminals();
  const driver = createTerminalUseDriver({
    queue,
    terminals: term.api,
    clock,
    redact: (text) => text,
  });

  const tab = queue.openTab({
    owner: OWNER,
    workspace: HOME,
    target: { terminal: { terminal_ref: "trm_1" } },
    relation: "work",
    source: OWNER,
    drivableTerminal: true,
  });

  // 시간 초과: 오류가 아니라 matched=false + 최신 스냅샷.
  const timedOut = await driver.wait(OWNER, {
    tab,
    text: "never-appears",
    timeout_ms: 100,
  });
  assert.ok(timedOut.ok);
  assert.equal(timedOut.value.matched, false);
  assert.equal(timedOut.value.reason, "timeout");
  assert.equal(timedOut.value.snapshot.screen, "ready $");

  // text 대기 중 프로세스가 종료되면 즉시 exited로 깬다.
  const waiting = driver.wait(OWNER, {
    tab,
    text: "still-not-there",
    timeout_ms: 5_000,
  });
  setTimeout(() => term.exit(1), 20);
  const exited = await waiting;
  assert.ok(exited.ok);
  assert.equal(exited.value.matched, false);
  assert.equal(exited.value.reason, "exited");
  assert.equal(exited.value.snapshot.exit_code, 1);
});

test("넘긴 터미널 탭은 agent가 닫지 못하고(forbidden), session 종료 시 agent가 연 터미널만 PTY 정리 대상으로 알린다", () => {
  const clock = manualClock(1_700_000_000_000);
  const ids = createIdSource({ clock, random: seededRandom(4) });
  const removed: { ref: string; agentOpened: boolean; reason: string }[] = [];
  const queue = createHostQueue({
    clock,
    ids,
    terminalRemoved: (info) =>
      removed.push({
        ref: info.ref,
        agentOpened: info.agentOpened,
        reason: info.reason,
      }),
  });

  const agentTab = queue.openTab({
    owner: OWNER,
    workspace: HOME,
    target: { terminal: { terminal_ref: "trm_agent" } },
    relation: "work",
    source: OWNER,
    drivableTerminal: true,
  });
  const handed = queue.handTerminal(
    { owner: OWNER, workspace: HOME, terminal: "trm_person" },
    () => true,
  );
  assert.ok(handed.ok);

  // 넘겨받은 터미널은 agent가 닫지 못한다.
  const closeHanded = queue.close(handed.value, OWNER);
  assert.ok(!closeHanded.ok && closeHanded.error.code === "forbidden");

  // agent가 연 터미널은 tab give로 자식에게 넘길 수 있다.
  assert.ok(queue.give(agentTab, OWNER, OTHER, () => true).ok);
  assert.ok(queue.terminalTab(agentTab, OTHER).ok);
  assert.ok(!queue.terminalTab(agentTab, OWNER).ok);
  assert.ok(queue.give(agentTab, OWNER, OWNER, () => true).ok);

  // 주인 session이 끝나면: agent가 연 터미널은 agentOpened=true(PTY 닫기 대상), 넘긴 터미널은 agentOpened=false(사람 탭·프로세스 유지).
  queue.ended(OWNER, (s) => s !== OWNER);
  assert.deepEqual(
    removed.toSorted((a, b) => a.ref.localeCompare(b.ref)),
    [
      { ref: "trm_agent", agentOpened: true, reason: "session_ended" },
      { ref: "trm_person", agentOpened: false, reason: "session_ended" },
    ],
  );
});

test("UI 닫기(reported_closed)도 agentOpened 터미널 정리 대상으로 알리고, handTerminal은 tab open 터미널 우회를 막고 재알리기 시 personControlling을 지킨다", () => {
  const clock = manualClock(1_700_000_000_000);
  const ids = createIdSource({ clock, random: seededRandom(5) });
  const removed: { ref: string; agentOpened: boolean; reason: string }[] = [];
  const queue = createHostQueue({
    clock,
    ids,
    terminalRemoved: (info) =>
      removed.push({
        ref: info.ref,
        agentOpened: info.agentOpened,
        reason: info.reason,
      }),
  });

  // 사람 token이 `tab open --terminal`로 연 탭과 `--tui`/`--coding`으로 연 탭은 handTerminal로 넘길 수 없다.
  const personOpened = queue.openTab({
    owner: "person",
    workspace: HOME,
    target: { terminal: { terminal_ref: "trm_person_cli" } },
    relation: null,
    source: null,
    drivableTerminal: true,
  });
  const codingTab = queue.openTab({
    owner: OWNER,
    workspace: HOME,
    target: { terminal: { terminal_ref: "trm_coding" } },
    relation: "aside",
    source: OWNER,
  });

  for (const attempt of [
    queue.handTerminal(
      { owner: OWNER, workspace: HOME, terminal: "trm_person_cli" },
      () => true,
    ),
    queue.handTerminal(
      {
        tab: personOpened,
        owner: OWNER,
        workspace: HOME,
        terminal: "trm_person_cli",
      },
      () => true,
    ),
    queue.handTerminal(
      { owner: OTHER, workspace: HOME, terminal: "trm_coding" },
      () => true,
    ),
    queue.handTerminal(
      { tab: codingTab, owner: OTHER, workspace: HOME, terminal: "trm_coding" },
      () => true,
    ),
  ]) {
    assert.ok(!attempt.ok && attempt.error.code === "conflict");
  }

  // 사람이 연 일반 터미널을 넘기고 take control한 뒤 재알리기해도 personControlling=true가 유지된다.
  const handed = queue.handTerminal(
    { owner: OWNER, workspace: HOME, terminal: "trm_ui" },
    () => true,
  );
  assert.ok(handed.ok);
  assert.equal(queue.setTerminalControl("trm_ui", true), true);
  const rehanded = queue.handTerminal(
    { tab: handed.value, owner: OWNER, workspace: HOME, terminal: "trm_ui" },
    () => true,
  );
  assert.ok(rehanded.ok);
  const state = queue.terminalTab(handed.value, OWNER);
  assert.ok(state.ok && state.value.personControlling === true);

  // 이미 넘긴 탭을 다른 session에 새 id로 다시 넘기기는 허용된다.
  const handedAgain = queue.handTerminal(
    { owner: OTHER, workspace: HOME, terminal: "trm_ui" },
    () => true,
  );
  assert.ok(handedAgain.ok && handedAgain.value !== handed.value);

  // UI 닫기(reported_closed): tab open --terminal 탭은 agentOpened=true, 넘긴 탭은 agentOpened=false로 알린다.
  queue.report(personOpened, "closed");
  queue.report(handed.value, "closed");
  assert.deepEqual(removed, [
    { ref: "trm_person_cli", agentOpened: true, reason: "reported_closed" },
    { ref: "trm_ui", agentOpened: false, reason: "reported_closed" },
  ]);
});
