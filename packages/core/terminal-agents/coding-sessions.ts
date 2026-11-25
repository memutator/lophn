// coding session: 사람 터미널에서 도는 coding agent CLI 하나다. 목록은 tracker가 runtime에 실은 agent와 GUI handle에서 만들고,
// GUI 대화는 handle의 상태를 그대로 읽어 기존 ACP 길(`acp/snapshot`, `acp/send`, `AcpUpdated`)과 `coding_sessions/*`로 낸다. ledger에는
// 아무것도 없다. 밖으로 나가는 대화(snapshot, 갱신, tool 본문)는 모두 제품 redactor를 지난다(`acp.md`).
import {
  type Clock,
  err,
  type LophnError,
  ok,
  type Result,
} from "../../base/mod.ts";
import { GUI_HANDOFF, isGuiHarness } from "../../protocol/acp/gui-session.ts";
import {
  type AcpInput,
  type AcpState,
  withoutToolBodies,
} from "../../protocol/acp/mod.ts";
import { HARNESS_ADAPTERS } from "../../protocol/coding-agent/harness-adapter.ts";
import type {
  CodingSession,
  SwitchStops,
} from "../../protocol/coding-agent/relay.ts";
import type { TerminalRuntime } from "../../protocol/coding-agent/terminals.ts";
import type { BusEvent } from "../../protocol/events/bus.ts";
import {
  publishStateChanged,
  type StateChange,
} from "../../protocol/events/changes.ts";
import type { TerminalSessionReport } from "../../protocol/lophn-agent/session-lifecycle.ts";
import { guiSessionId } from "../../protocol/lophn-agent/session-tag.ts";
import { attachBatched, type TabGui } from "./gui.ts";

// session마다 기억하는 입력 key 수. 폰은 다시 붙은 뒤 같은 key로 다시 보내고 adapter는 key를 거르지 않는다.
export const INPUT_KEYS_MAX = 200;
// 다시 보낸 switch를 알아보는 key 수(전체).
const SWITCH_KEYS_MAX = 200;

const SESSION_GONE = "The coding session is not open on the computer.";
const NOT_READY =
  "The computer is still loading its secrets; try again shortly.";

type SwitchPlan = {
  to: "gui" | "tui";
  stops: SwitchStops;
  blocked: "no_session" | "not_running" | "unsupported_os" | null;
};

export type CodingSessionsDeps = {
  clock: Clock;
  terminals: { list(): readonly TerminalRuntime[] };
  gui: TabGui;
  after(ms: number, run: () => void): () => void;
  // `AcpUpdated`와 `StateChanged`를 Bus에 낸다.
  publish(event: BusEvent): void;
  // 제품 redactor로 값 안의 모든 글을 거른다. 알려진 secret을 아직 다 모르면 null이다(내지 않는다).
  redact<T>(value: T): T | null;
  // core가 도는 OS(`process.platform`). 터미널과 같은 기계다.
  platform: string;
};

// 다시 보내도 한 번만 가야 하는 입력의 key다. key가 없는 입력(decide, answer, 줄 고치기)은 같은 대상에 두 번 가도 adapter가 거른다.
function inputKey(input: AcpInput): string | null {
  if (!("key" in input)) return null;
  return input.type === "send"
    ? `send:${input.id}:${input.key}`
    : `${input.type}:${input.key}`;
}

const running = (state: AcpState) =>
  state.turn !== null && state.turn.phase !== "ended";

function lastActiveOf(state: AcpState): string | null {
  let last: string | null = state.turn?.started_at ?? null;
  for (const item of state.items) {
    if (last === null || item.at > last) last = item.at;
  }
  return last;
}

const labelOf = (harness: string) =>
  (HARNESS_ADAPTERS as Record<string, { label: string } | undefined>)[harness]
    ?.label ?? harness;

// coding session id(`ses_<ULID>`)의 터미널(`trm_<ULID>`)이다.
const terminalOf = (session: string) => `trm_${session.slice(4)}`;

export function createCodingSessions(deps: CodingSessionsDeps) {
  const { gui } = deps;
  const inputKeys = new Map<string, Set<string>>();
  const switches = new Map<string, Promise<Result<{ ok: true }>>>();
  const listeners = new Set<() => void>();
  let listed = "";

  // 터미널마다 지금 도는 coding agent. service가 runtime.agent에 통합 상태(`source: "gui" | "pty"`)를 싣는다.
  // standalone unit test처럼 runtime.agent에 source가 없을 때만 GUI handle(`gui.tabSessions()`)을 보조로 읽는다.
  function reports(): TerminalSessionReport[] {
    const tabs = new Map(
      gui.tabSessions().map((tab) => [tab.terminal_ref, tab]),
    );
    return deps.terminals.list().flatMap((runtime) => {
      if (runtime.dedicated) return [];
      const { agent } = runtime;
      const tab = tabs.get(runtime.terminal_ref);
      const unifiedGui = agent?.source === "gui";
      const guided =
        !unifiedGui &&
        tab !== undefined &&
        (tab.view === "gui" || agent === undefined);
      if (
        (agent === undefined && !guided) ||
        runtime.state === "exited" ||
        runtime.state === "unknown"
      ) {
        return [];
      }
      const foreground = agent?.foreground === true;
      const harness = guided ? tab.harness : (agent?.harness ?? "");
      return [
        {
          terminal_ref: runtime.terminal_ref,
          project: runtime.project,
          harness,
          state: guided ? tab.state : (agent?.state ?? "unknown"),
          cli_session: guided
            ? (tab.cli_session ?? agent?.session ?? null)
            : (agent?.session ?? tab?.cli_session ?? null),
          title: guided
            ? (tab.title ?? agent?.name ?? agent?.title ?? null)
            : (agent?.name ?? agent?.title ?? tab?.title ?? null),
          cwd: runtime.cwd_at_start,
          shell_pid: runtime.shell_pid ?? null,
          view: unifiedGui ? "gui" : (tab?.view ?? "tui"),
          // handle이 있으면 그 adapter의 것, 없으면 foreground TUI를 GUI로 넘길 때의 것이다.
          handoff:
            tab?.handoff ??
            ((unifiedGui || foreground) && isGuiHarness(harness)
              ? GUI_HANDOFF[harness]
              : null),
          foreground,
        },
      ];
    });
  }

  const reportOf = (session: string) =>
    reports().find((one) => guiSessionId(one.terminal_ref) === session);

  // 터미널에 GUI handle이 있으면 이미 view만 바꾸면 된다. 아니면 tracker가 아는 TUI와 그 CLI session이 있어야 GUI로 다시 연다
  // (`TabGui.toggle`과 같은 판정).
  function blockedOf(report: TerminalSessionReport): SwitchPlan["blocked"] {
    if (report.view === "gui") return null;
    if (deps.platform === "win32") return "unsupported_os";
    if (gui.current(report.terminal_ref) !== null) return null;
    if (!report.foreground || report.handoff === null) return "not_running";
    if (report.cli_session === null) return "no_session";
    return null;
  }

  function row(report: TerminalSessionReport): CodingSession {
    const state = gui.current(report.terminal_ref)?.handle.state();
    const blocked = blockedOf(report);
    return {
      session: guiSessionId(report.terminal_ref) as CodingSession["session"],
      terminal: report.terminal_ref,
      harness: report.harness,
      label: labelOf(report.harness),
      project: report.project,
      cwd: report.cwd,
      title: report.title,
      state: report.state,
      view: report.view,
      handoff: report.handoff,
      cli_session: report.cli_session,
      last_active_at: state === undefined ? null : lastActiveOf(state),
      switch: blocked === null ? null : { blocked },
    };
  }

  function list(project?: string): CodingSession[] {
    return reports()
      .filter((one) => project === undefined || one.project === project)
      .map(row);
  }

  function publishChanges(changes: StateChange[]) {
    publishStateChanged(
      { publish: (event) => deps.publish(event as BusEvent) },
      deps.clock.now(),
      changes,
    );
  }

  const handleOf = (session: string) =>
    gui.current(terminalOf(session))?.handle;

  // 대화를 내보내는 화면은 handle마다 붙는다. snapshot이 바뀌면(열림, 닫힘) 화면이 `acp/snapshot`을 다시 읽게 알린다.
  const attached = new Map<string, () => void>();
  const offHandle = gui.onHandle((handle) => {
    const session = guiSessionId(handle.terminal);
    attached.get(session)?.();
    const stop = attachBatched(handle, deps.after, {
      snapshot: () =>
        publishChanges([{ name: "coding_sessions", id: session }]),
      updates(updates) {
        const redacted = deps.redact(updates);
        // 알려진 secret을 아직 다 모른다. 거르지 못한 글을 내지 않고 화면이 snapshot을 다시 읽게 한다.
        if (redacted === null) {
          publishChanges([{ name: "coding_sessions", id: session }]);
          return;
        }
        const at = deps.clock.now();
        for (const update of redacted) {
          deps.publish({
            type: "AcpUpdated",
            session,
            subject: null,
            at,
            payload: { session, update },
          } as BusEvent);
        }
      },
      closed() {
        if (attached.get(session) === stop) attached.delete(session);
        inputKeys.delete(session);
        publishChanges([{ name: "coding_sessions", id: session }]);
      },
    });
    attached.set(session, stop);
  });

  const gone = () => err({ code: "not_found" as const, message: SESSION_GONE });

  return {
    reports,
    list,

    // 목록이 바뀌었을 수 있다(tracker의 agent, GUI handle, 터미널 runtime). 바뀌었으면 `StateChanged{coding_sessions}`를 내고
    // 듣는 쪽에 알린다.
    changed(): void {
      const next = JSON.stringify(list());
      if (next === listed) return;
      listed = next;
      publishChanges([{ name: "coding_sessions", id: null }]);
      for (const listener of [...listeners]) listener();
    },

    // 목록이 바뀌었다(터미널이 빠지는 것 포함). 끊는 함수를 돌려준다.
    onChange(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    has: (session: string) => handleOf(session) !== undefined,

    // handle 상태를 redaction을 거쳐 준다. 그 session의 handle이 없으면 undefined다(ledger의 session이다).
    snapshot(session: string): Result<AcpState> | undefined {
      const handle = handleOf(session);
      if (handle === undefined) return undefined;
      const redacted = deps.redact(withoutToolBodies(handle.state()));
      return redacted === null
        ? err({ code: "unavailable", message: NOT_READY })
        : ok(redacted);
    },

    // 화면의 입력을 handle에 그대로 넘긴다. 같은 key의 입력은 한 번만 넘긴다.
    send(input: AcpInput): Result<Record<string, never>> {
      const terminal = terminalOf(input.session);
      if (gui.current(terminal) === null) return gone();
      const key = inputKey(input);
      if (key !== null) {
        let seen = inputKeys.get(input.session);
        if (seen === undefined)
          inputKeys.set(input.session, (seen = new Set()));
        if (seen.has(key)) return ok({});
        seen.add(key);
        while (seen.size > INPUT_KEYS_MAX) {
          seen.delete(seen.values().next().value!);
        }
      }
      gui.input(terminal, input);
      return ok({});
    },

    // 펼친 tool 줄의 본문 한 쪽. 내는 상태에는 본문이 없어 handle에서 읽고 같은 redactor를 지나 낸다.
    toolBody(input: {
      session: string;
      tool_call: string;
      part: "input" | "output";
    }): Result<{ value: string; truncated: boolean }> {
      const terminal = terminalOf(input.session);
      if (gui.current(terminal) === null) return gone();
      const body = gui.toolBody(terminal, input.tool_call, input.part);
      if (body === null) {
        return err({
          code: "not_found",
          message: "That tool call has no such body.",
        });
      }
      const redacted = deps.redact(body);
      return redacted === null
        ? err({ code: "unavailable", message: NOT_READY })
        : ok(redacted);
    },

    // 폰이 붙인 그림을 그 탭의 임시 폴더에 쓰고 경로를 준다. 메시지는 그 경로의 `file://` link를 싣는다. 폰의 그림에는 이름이 없다.
    async writeImage(
      session: string,
      bytes: Uint8Array,
    ): Promise<Result<{ path: string }>> {
      const terminal = terminalOf(session);
      if (gui.current(terminal) === null) return gone();
      const path = await gui.uploadImage(terminal, {
        name: "phone-image",
        data: bytes,
      });
      return path === null
        ? err({
            code: "invalid_input",
            message: "The picture could not be saved.",
          })
        : ok({ path });
    },

    // 그 탭의 임시 폴더에 쓴 그림(대화의 `file://` link)을 읽는다.
    async readImage(
      session: string,
      path: string,
    ): Promise<Result<{ mime: string; bytes: Uint8Array }>> {
      const terminal = terminalOf(session);
      if (gui.current(terminal) === null) return gone();
      const image = await gui.readImage(terminal, path);
      return image === null
        ? err({ code: "not_found", message: "No such picture in this chat." })
        : ok({ mime: image.mime, bytes: image.data });
    },

    async cliSessions(session: string) {
      const terminal = terminalOf(session);
      if (reportOf(session) === undefined) return gone();
      return ok({ sessions: await gui.sessions(terminal) });
    },

    async rewindPreview(session: string, message: string) {
      const terminal = terminalOf(session);
      if (reportOf(session) === undefined) return gone();
      return ok({ preview: await gui.rewindPreview(terminal, message) });
    },

    switchPlan(session: string): Result<SwitchPlan> {
      const report = reportOf(session);
      if (report === undefined) return gone();
      if (report.view === "tui") {
        return ok({
          to: "gui",
          stops: stopsOf(report, session),
          blocked: blockedOf(report),
        });
      }
      return ok({
        to: "tui",
        stops: stopsOf(report, session),
        blocked: null,
      });
    },

    // 사람이 확인한 view 바꾸기다(`confirmed`는 route 입력 검사가 본다). 같은 key는 한 번만 바꾼다.
    switch(input: {
      session: string;
      to: "gui" | "tui";
      key: string;
      stops?: SwitchStops;
    }): Promise<Result<{ ok: true }>> {
      const seen = switches.get(input.key);
      if (seen !== undefined) return seen;
      const sent = switchView(input);
      switches.set(input.key, sent);
      while (switches.size > SWITCH_KEYS_MAX) {
        switches.delete(switches.keys().next().value!);
      }
      void sent.then((done) => {
        if (!done.ok && switches.get(input.key) === sent) {
          switches.delete(input.key);
        }
      });
      return sent;
    },

    stop(): void {
      offHandle();
      for (const stop of attached.values()) stop();
      attached.clear();
    },
  };

  function stopsOf(
    report: TerminalSessionReport,
    session: string,
  ): SwitchStops {
    if (report.view === "tui") {
      return {
        turn: report.state === "running" || report.state === "waiting",
        tasks: 0,
        queued: 0,
      };
    }
    const state = handleOf(session)?.state();
    return {
      turn: state !== undefined && running(state),
      tasks:
        state?.tasks.filter((task) => task.state === "running").length ?? 0,
      queued: state?.queued.length ?? 0,
    };
  }

  async function switchView(input: {
    session: string;
    to: "gui" | "tui";
    stops?: SwitchStops;
  }): Promise<Result<{ ok: true }>> {
    const report = reportOf(input.session);
    if (report === undefined) return gone();
    if (report.view === input.to) {
      return err({
        code: "conflict",
        message: `The coding session is already in ${input.to === "gui" ? "chat" : "the terminal"}.`,
      });
    }
    if (input.stops !== undefined) {
      const current = stopsOf(report, input.session);
      if (
        current.turn !== input.stops.turn ||
        current.tasks !== input.stops.tasks ||
        current.queued !== input.stops.queued
      ) {
        return refused(
          "conflict",
          "What would stop has changed since the switch plan was checked.",
          "stale_plan",
        );
      }
    }
    // terminal host가 win32에서 foreground를 모른다(harness-gui 비목표).
    if (deps.platform === "win32") {
      return refused(
        "unavailable",
        "Switching between chat and terminal is not available on Windows.",
        "unsupported_os",
      );
    }
    const reply = await gui.toggle({
      terminal_ref: report.terminal_ref,
      to: input.to,
    });
    if (reply.ok) return ok({ ok: true });
    return refused(
      reply.reason === "no_session" || reply.reason === "not_running"
        ? "invalid_input"
        : "unavailable",
      reply.message,
      reply.reason,
    );
  }
}

function refused(
  code: LophnError["code"],
  message: string,
  reason: string,
): Result<never> {
  return err({ code, message, details: { reason } });
}

export type CodingSessions = ReturnType<typeof createCodingSessions>;
