// coding relay: shell main(host)이 `/host-link`로 올린 터미널 coding agent 보고와 GUI handle의 ACP 상태를 메모리에 접어 두고,
// 폰이 쓰는 기존 ACP 길(`acp/snapshot`, `acp/send`, `AcpUpdated`)과 `coding_sessions/*`로 낸다. ledger에는 아무것도 없다.
// 상태는 host가 주인이다. core는 입력을 사본에 적용하지 않고 host에 넘기며, 그 결과는 host가 `coding_sync`로 다시 올린다.
import { err, ok, type LophnError, type Result } from "../../base/mod.ts";
import type { AcpInput, AcpState, AcpUpdate } from "../../protocol/acp/mod.ts";
import { reduceAcp } from "../../protocol/acp/reduce.ts";
import { HARNESS_ADAPTERS } from "../../protocol/coding-agent/harness-adapter.ts";
import type { CodingSession } from "../../protocol/coding-agent/relay.ts";
import type { BusEvent } from "../../protocol/events/bus.ts";
import {
  publishStateChanged,
  type StateChange,
} from "../../protocol/events/changes.ts";
import type { TerminalSessionReport } from "../../protocol/lophn-agent/session-lifecycle.ts";
import { guiSessionId } from "../../protocol/lophn-agent/session-tag.ts";
import type { CodingRelayDeps } from "./ports.ts";

// 사본은 보고 상한(64)만큼 둔다. 넘으면 가장 오래 쓰지 않은 것부터 버린다(그 session은 host가 다시 snapshot을 보낼 때 돌아온다).
export const REPLICA_MAX = 64;
// session마다 기억하는 입력 key 수. 폰은 다시 붙은 뒤 같은 key로 다시 보내고 adapter는 key를 거르지 않는다.
export const INPUT_KEYS_MAX = 200;
// 다시 보낸 switch를 알아보는 key 수(전체).
const SWITCH_KEYS_MAX = 200;

type Replica = {
  state: AcpState;
  // 보냈거나 보내는 중인 keyed 입력. 실패한 시도는 지워 다시 보낼 수 있다.
  keys: Map<string, Promise<Result<Record<string, never>>>>;
};

type SwitchPlan = {
  to: "gui" | "tui";
  stops: { turn: boolean; tasks: number; queued: number };
  blocked: "no_session" | "not_running" | "unsupported_os" | null;
};

const SESSION_GONE = "The coding session is not open on the computer.";
const BAD_REPLY =
  "The lophn app on the computer gave an answer that could not be read.";
const NOT_READY =
  "The computer is still loading its secrets; try again shortly.";

// host가 답한 content(`[{type: "text", text: <JSON>}]`)의 값이다. 모양이 다르면 null이다.
function textReply<T>(content: unknown): T | null {
  const first = Array.isArray(content)
    ? (content[0] as { type?: string; text?: string } | undefined)
    : undefined;
  if (first?.type !== "text" || first.text === undefined) return null;
  try {
    return JSON.parse(first.text) as T;
  } catch {
    return null;
  }
}

// 경계에 내보내는 code는 공통 일곱 가운데 이 route들이 선언한 것뿐이다. host의 그 밖 code는 unavailable로 옮긴다.
const PASSED_CODES = new Set<string>([
  "invalid_input",
  "not_found",
  "conflict",
  "unavailable",
]);
export const passed = (error: LophnError): LophnError =>
  PASSED_CODES.has(error.code) ? error : { ...error, code: "unavailable" };

// 다시 보내도 한 번만 가야 하는 입력의 key다. key가 없는 입력(decide, answer, 줄 고치기)은 같은 대상에 두 번 가도 adapter가 거른다.
function inputKey(input: AcpInput): string | null {
  if (!("key" in input)) return null;
  return input.type === "send"
    ? `send:${input.id}:${input.key}`
    : `${input.type}:${input.key}`;
}

const running = (state: AcpState) =>
  state.turn !== null && state.turn.phase !== "ended";

function stateOf(
  state: AcpState,
  reported: TerminalSessionReport["state"],
): CodingSession["state"] {
  if (state.pending.approval !== null || state.pending.question !== null) {
    return "waiting";
  }
  if (state.turn?.phase === "waiting") return "waiting";
  if (running(state)) return "running";
  return state.session === null && state.turn === null ? reported : "idle";
}

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

export function createCodingRelay(deps: CodingRelayDeps) {
  let reports: readonly TerminalSessionReport[] = [];
  const replicas = new Map<string, Replica>();
  const switches = new Map<string, Promise<Result<{ ok: true }>>>();
  const listeners = new Set<() => void>();

  const reportOf = (session: string) =>
    reports.find((one) => guiSessionId(one.terminal_ref) === session);

  // 가장 오래 쓰지 않은 것이 Map의 앞에 오게 다시 넣는다.
  function touch(session: string): Replica | undefined {
    const replica = replicas.get(session);
    if (replica === undefined) return undefined;
    replicas.delete(session);
    replicas.set(session, replica);
    return replica;
  }

  // 터미널에 GUI handle이 있으면(사본이 있으면) 이미 view만 바꾸면 된다. 아니면 tracker가 아는 TUI와 그 CLI session이 있어야
  // GUI로 다시 연다(shell main `gui.ts`의 toggle과 같은 판정).
  function blockedOf(report: TerminalSessionReport): SwitchPlan["blocked"] {
    if (report.view === "gui") return null;
    if (deps.platform === "win32") return "unsupported_os";
    if (replicas.has(guiSessionId(report.terminal_ref))) return null;
    if (!report.foreground || report.handoff === null) return "not_running";
    if (report.cli_session === null) return "no_session";
    return null;
  }

  function row(report: TerminalSessionReport): CodingSession {
    const session = guiSessionId(report.terminal_ref);
    const state = replicas.get(session)?.state;
    const blocked = blockedOf(report);
    return {
      session,
      terminal: report.terminal_ref,
      harness: report.harness,
      label: labelOf(report.harness),
      project: report.project,
      cwd: report.cwd,
      title: report.title,
      state: state === undefined ? report.state : stateOf(state, report.state),
      view: report.view,
      handoff: report.handoff,
      cli_session: report.cli_session,
      last_active_at: state === undefined ? null : lastActiveOf(state),
      switch: blocked === null ? null : { blocked },
    };
  }

  function list(project?: string): CodingSession[] {
    return reports
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

  function notify() {
    for (const listener of [...listeners]) listener();
  }

  // 목록이 바뀌었으면 듣는 쪽에 알리고 `StateChanged{coding_sessions}`를 낸다. `replaced`는 사본을 snapshot으로 갈아 끼운
  // session이다(폰이 그 대화를 다시 읽는다).
  function mutate(run: () => void, replaced: string | null = null) {
    const before = JSON.stringify(list());
    run();
    const listChanged = JSON.stringify(list()) !== before;
    const changes: StateChange[] = [];
    if (replaced !== null)
      changes.push({ name: "coding_sessions", id: replaced });
    if (listChanged) changes.push({ name: "coding_sessions", id: null });
    publishChanges(changes);
    if (listChanged) notify();
  }

  function dropReplica(session: string) {
    replicas.delete(session);
  }

  return {
    // shell main이 알린 터미널 coding agent 집합으로 통째로 바꾼다(`coding_report`).
    reported(next: readonly TerminalSessionReport[]): void {
      mutate(() => {
        reports = next;
      });
    },

    // host의 `coding_sync` 하나. snapshot은 사본을 갈아 끼우고 updates는 접는다. 둘 다 제품 redactor를 먼저 지난다.
    sync(frame: {
      session: string;
      snapshot?: AcpState;
      updates?: AcpUpdate[];
    }): void {
      const { session } = frame;
      const snapshot =
        frame.snapshot === undefined ? undefined : deps.redact(frame.snapshot);
      const updates =
        frame.updates === undefined ? [] : deps.redact(frame.updates);
      // 알려진 secret을 아직 다 모른다. 거르지 못한 글을 두지도 내지도 않는다(다음 snapshot이 사본을 다시 만든다).
      if (snapshot === null || updates === null) {
        if (replicas.has(session)) mutate(() => dropReplica(session), session);
        return;
      }
      mutate(
        () => {
          let replica = touch(session);
          if (snapshot !== undefined) {
            replica = { state: snapshot, keys: replica?.keys ?? new Map() };
            replicas.set(session, replica);
            while (replicas.size > REPLICA_MAX) {
              dropReplica(replicas.keys().next().value!);
            }
          }
          // snapshot이 아직 없는(버렸거나 받기 전) session의 갱신은 접을 바탕이 없다.
          if (replica === undefined) return;
          for (const update of updates) {
            replica.state = reduceAcp(replica.state, update);
          }
        },
        snapshot === undefined ? null : session,
      );
      if (!replicas.has(session)) return;
      const at = deps.clock.now();
      for (const update of updates) {
        deps.publish({
          type: "AcpUpdated",
          session,
          subject: null,
          at,
          payload: { session, update },
        } as BusEvent);
      }
    },

    // host의 handle이 닫혔다(`coding_closed`).
    closed(session: string): void {
      if (!replicas.has(session)) return;
      mutate(() => dropReplica(session), session);
    },

    // 연결이 닫히고 유예가 지났다. 그 사이 일은 알 길이 없으니 보고와 사본을 모두 비운다.
    clear(): void {
      if (reports.length === 0 && replicas.size === 0) return;
      const sessions = [...replicas.keys()];
      mutate(() => {
        reports = [];
        replicas.clear();
      });
      publishChanges(
        sessions.map((session) => ({ name: "coding_sessions", id: session })),
      );
    },

    // 연결이 열리거나 닫혔다. 목록의 `shell`이 바뀐다.
    shellChanged(): void {
      publishChanges([{ name: "coding_sessions", id: null }]);
      notify();
    },

    shell: (): "attached" | "absent" =>
      deps.attached() ? "attached" : "absent",

    has: (session: string) => replicas.has(session),

    // 사본의 상태(redaction을 거친 것). 없으면 undefined다.
    snapshot: (session: string): AcpState | undefined => touch(session)?.state,

    // 화면의 입력을 host에 그대로 넘긴다. 같은 key의 입력은 한 번만 보내고 그 답을 같이 받는다.
    send(input: AcpInput): Promise<Result<Record<string, never>>> {
      const replica = touch(input.session);
      if (replica === undefined) {
        return Promise.resolve(
          err({ code: "not_found", message: SESSION_GONE }),
        );
      }
      const key = inputKey(input);
      const seen = key === null ? undefined : replica.keys.get(key);
      if (seen !== undefined) return seen;
      const sent = deps
        .call({
          kind: "coding_input",
          payload: { session: input.session, input },
        })
        .then(
          (done): Result<Record<string, never>> =>
            done.ok ? ok({}) : err(passed(done.error)),
        );
      if (key !== null) {
        replica.keys.set(key, sent);
        while (replica.keys.size > INPUT_KEYS_MAX) {
          replica.keys.delete(replica.keys.keys().next().value!);
        }
        void sent.then((done) => {
          if (!done.ok && replica.keys.get(key) === sent) {
            replica.keys.delete(key);
          }
        });
      }
      return sent;
    },

    // 펼친 tool 줄의 본문 한 쪽. 사본에는 본문이 없어 host에 묻고, 사본과 같은 redactor를 지나 낸다.
    async toolBody(input: {
      session: string;
      tool_call: string;
      part: "input" | "output";
    }): Promise<Result<{ value: string; truncated: boolean }>> {
      if (!replicas.has(input.session)) {
        return err({ code: "not_found", message: SESSION_GONE });
      }
      const done = await deps.call({ kind: "coding_body", payload: input });
      if (!done.ok) return err(passed(done.error));
      const body = textReply<{ value: string; truncated: boolean }>(done.value);
      if (body === null) {
        return err({ code: "unavailable", message: BAD_REPLY });
      }
      const redacted = deps.redact(body);
      return redacted === null
        ? err({ code: "unavailable", message: NOT_READY })
        : ok(redacted);
    },

    // 폰이 붙인 그림을 그 탭의 임시 폴더에 쓰게 하고 경로를 받는다. 메시지는 그 경로의 `file://` link를 싣는다.
    async writeImage(
      session: string,
      bytes: Uint8Array,
    ): Promise<Result<{ path: string }>> {
      if (!replicas.has(session)) {
        return err({ code: "not_found", message: SESSION_GONE });
      }
      const done = await deps.call({
        kind: "coding_image_write",
        payload: { session, data: Buffer.from(bytes).toString("base64") },
      });
      if (!done.ok) return err(passed(done.error));
      const written = textReply<{ path: string }>(done.value);
      return written === null
        ? err({ code: "unavailable", message: BAD_REPLY })
        : ok({ path: written.path });
    },

    // 그 탭의 임시 폴더에 쓴 그림(대화의 `file://` link)을 읽는다.
    async readImage(
      session: string,
      path: string,
    ): Promise<Result<{ mime: string; bytes: Uint8Array }>> {
      if (!replicas.has(session)) {
        return err({ code: "not_found", message: SESSION_GONE });
      }
      const done = await deps.call({
        kind: "coding_image_read",
        payload: { session, path },
      });
      if (!done.ok) return err(passed(done.error));
      const image = Array.isArray(done.value)
        ? (done.value[0] as
            | { type?: string; mimeType?: string; data?: string }
            | undefined)
        : undefined;
      return image?.type !== "image" ||
        image.mimeType === undefined ||
        image.data === undefined
        ? err({ code: "unavailable", message: BAD_REPLY })
        : ok({
            mime: image.mimeType,
            bytes: new Uint8Array(Buffer.from(image.data, "base64")),
          });
    },

    list,

    // 그 터미널이 지금 목록에 있다.
    terminalKnown: (terminalRef: string) =>
      reports.some((one) => one.terminal_ref === terminalRef),

    // 목록이 바뀌었다(터미널이 빠지는 것, 연결이 열리고 닫히는 것 포함). 끊는 함수를 돌려준다.
    onChange(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    switchPlan(session: string): Result<SwitchPlan> {
      const report = reportOf(session);
      if (report === undefined) {
        return err({ code: "not_found", message: SESSION_GONE });
      }
      if (report.view === "tui") {
        const blocked = blockedOf(report);
        return ok({
          to: "gui",
          stops: { turn: report.state === "running", tasks: 0, queued: 0 },
          blocked,
        });
      }
      const state = replicas.get(session)?.state;
      return ok({
        to: "tui",
        stops: {
          turn: state !== undefined && running(state),
          tasks:
            state?.tasks.filter((task) => task.state === "running").length ?? 0,
          queued: state?.queued.length ?? 0,
        },
        blocked: null,
      });
    },

    // 사람이 확인한 view 바꾸기다(`confirmed`는 route 입력 검사가 본다). 같은 key는 한 번만 보낸다.
    switch(input: {
      session: string;
      to: "gui" | "tui";
      key: string;
    }): Promise<Result<{ ok: true }>> {
      const seen = switches.get(input.key);
      if (seen !== undefined) return seen;
      const report = reportOf(input.session);
      if (report === undefined) {
        return Promise.resolve(
          err({ code: "not_found", message: SESSION_GONE }),
        );
      }
      if (report.view === input.to) {
        return Promise.resolve(
          err({
            code: "conflict",
            message: `The coding session is already in ${input.to === "gui" ? "chat" : "the terminal"}.`,
          }),
        );
      }
      const sent = deps
        .call({
          kind: "coding_switch",
          payload: { terminal_ref: report.terminal_ref, to: input.to },
        })
        .then(
          (done): Result<{ ok: true }> =>
            done.ok ? ok({ ok: true }) : err(passed(done.error)),
        );
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
  };
}

export type CodingRelay = ReturnType<typeof createCodingRelay>;
