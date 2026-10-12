// Electron 실행당 terminal host 하나. PTY·child group·ring buffer를 갖고
// main이 물려 준 private pipe로만 말한다. 출력은 disk에 쓰지 않는다.

import type {
  TerminalReply,
  TerminalRuntime,
  TerminalSnapshotReply,
} from "../ipc/terminal.ts";
import { resolveLoginShell, stripPlatformEnv } from "./env.ts";
import {
  nodePtyAdapter,
  type PtyAdapter,
  type PtyHandle,
  yieldChunk,
} from "./pty.ts";
import { type ProcessGroup } from "./child-group.ts";
import type { CodingAttachment, CodingHost } from "./coding-types.ts";
import { RingBuffer } from "./ring-buffer.ts";

export type FolderRecord = { folder_ref: string; path: string };

export type FolderCheck =
  | { ok: true; path: string }
  | { ok: false; reason: "not_directory" | "unreadable" };

export type HostRequest =
  | {
    id: string;
    type: "open";
    project: string;
    folder_ref?: string;
    folders: readonly FolderRecord[];
    columns: number;
    rows: number;
  }
  | {
    // 사람이 누른 [Start]를 main이 다시 검사해 넘긴 LaunchPlan이다. host가 plan을 검사한다.
    id: string;
    type: "open-coding";
    plan: unknown;
    /** 설치된 helper 절대 경로. 있으면 TUI 아래 MCP·CLI process를 관측해 main에 알린다. */
    credential_helper?: string;
    columns: number;
    rows: number;
  }
  | {
    id: string;
    type: "input";
    terminal_ref: string;
    generation: number;
    text: string;
  }
  | {
    id: string;
    type: "resize";
    terminal_ref: string;
    generation: number;
    columns: number;
    rows: number;
  }
  | { id: string; type: "close"; terminal_ref: string; generation: number }
  | { id: string; type: "restart"; terminal_ref: string; generation: number }
  | { id: string; type: "snapshot"; terminal_ref: string; after_seq?: number }
  | { id: string; type: "host-lost" };

export type HostDeps = {
  pty: PtyAdapter;
  env: Readonly<Record<string, string | undefined>>;
  platform: NodeJS.Platform;
  exists: (file: string) => boolean;
  checkFolder: (path: string) => FolderCheck;
  schedule: (done: () => void) => void;
  /** 종료 확인 사이의 기다림. 테스트가 줄인다. */
  sleep?: (ms: number) => Promise<void>;
  controlFd?: number;
  /** coding TUI 시작. 없으면 open-coding은 거절한다. */
  coding?: CodingHost;
};

type Session = {
  runtime: TerminalRuntime;
  buffer: RingBuffer;
  handle: PtyHandle | null;
  group: ProcessGroup | null;
  /** 사람이 보낸 입력. 재시작 때 재생하지 않는다. */
  typed: string[];
  /** lophn이 연 coding TUI의 관측·prompt 전달. 일반 shell에는 없다. */
  coding?: CodingAttachment;
};

export type Host = {
  /** close·restart는 child 종료를 기다려 확인하므로 Promise다. */
  handle(
    request: HostRequest,
  ):
    | TerminalReply
    | TerminalSnapshotReply
    | Promise<TerminalReply | TerminalSnapshotReply>;
  sessions(): readonly TerminalRuntime[];
  dispose(): TerminalRuntime[];
};

export function createHost(deps: HostDeps): Host {
  const sessions = new Map<string, Session>();
  /** 같은 operation_id는 같은 runtime_ref다(shell/terminal#R12). 다시 spawn하지 않는다. */
  const operations = new Map<string, string>();
  let seq = 0;

  async function startCoding(
    request: Extract<HostRequest, { type: "open-coding" }>,
  ): Promise<TerminalReply> {
    const coding = deps.coding;
    if (!coding) {
      return reject("spawn_failed", "coding launch is not available");
    }
    const claimed = (request.plan as { operation_id?: unknown } | null)
      ?.operation_id;
    const known = typeof claimed === "string"
      ? sessions.get(operations.get(claimed) ?? "")
      : undefined;
    if (known) return { ok: true, runtime: { ...known.runtime } };
    const prepared = coding.prepare(request.plan, {
      env: deps.env,
      credential_helper: request.credential_helper,
      checkFolder: deps.checkFolder,
    });
    if (!prepared.ok) return reject(prepared.reason, prepared.message);
    const { launch } = prepared;
    const plan = launch.plan;
    const terminalRef = `term_${++seq}`;
    const runtime: TerminalRuntime = {
      terminal_ref: terminalRef,
      project: plan.project,
      folder_ref: plan.folder_ref,
      cwd_at_start: launch.cwd,
      program_path: launch.file,
      launch_kind: "coding_tui",
      state: "starting",
      generation: 1,
      columns: request.columns,
      rows: request.rows,
      exit_code: null,
      failure_reason: null,
      output_seq: 0,
      dropped_output: false,
      coding: {
        operation_id: plan.operation_id,
        ticket: plan.ticket,
        connection: plan.connection,
        prompt_delivery: plan.prompt_delivery.mode === "argv"
          ? "none"
          : "pending",
      },
    };
    const attachment = coding.attach(
      launch,
      { runtime_ref: terminalRef, generation: 1 },
      (outcome) => {
        if (runtime.coding) {
          runtime.coding = { ...runtime.coding, prompt_delivery: outcome };
        }
      },
    );
    const session: Session = {
      runtime,
      buffer: new RingBuffer(),
      handle: null,
      group: null,
      typed: [],
      coding: attachment,
    };
    // 동기로 먼저 잡아 두어 socket을 여는 동안 온 같은 operation_id도 같은 runtime을 본다.
    sessions.set(terminalRef, session);
    operations.set(plan.operation_id, terminalRef);
    const begun = await attachment.begin();
    if (!begun.ok) {
      runtime.state = "exited";
      runtime.failure_reason = "spawn_failed";
      return { ok: true, runtime: { ...runtime } };
    }
    try {
      const handle = deps.pty.spawn({
        file: launch.file,
        args: launch.args,
        cwd: launch.cwd,
        env: begun.env,
        columns: request.columns,
        rows: request.rows,
        controlFd: deps.controlFd,
      });
      session.handle = handle;
      session.group = deps.pty.group(handle.pid);
      runtime.state = "running";
      handle.onData((chunk) => {
        attachment.output(chunk);
        void acceptChunk(session, chunk);
      });
      handle.onExit((exit) => {
        attachment.exited();
        if (runtime.state === "unknown" || runtime.exit_code !== null) return;
        runtime.state = "exited";
        runtime.exit_code = exit.exitCode;
        runtime.dropped_output = session.buffer.dropped;
        session.handle = null;
      });
      attachment.spawned((text) => handle.write(text), handle.pid);
    } catch {
      attachment.abandon();
      runtime.state = "exited";
      runtime.failure_reason = "spawn_failed";
      runtime.exit_code = null;
    }
    return { ok: true, runtime: { ...runtime } };
  }

  function start(
    previous: Session | undefined,
    request: Extract<HostRequest, { type: "open" }>,
  ): TerminalReply {
    const picked = pickFolder(request.folders, request.folder_ref);
    if (!picked.ok) return reject(picked.reason, picked.message);
    const checked = deps.checkFolder(picked.path);
    if (!checked.ok) {
      return reject(checked.reason, "registered folder cannot be used");
    }
    const program = resolveLoginShell({
      platform: deps.platform,
      env: deps.env,
      exists: deps.exists,
    });
    if (!program) return reject("spawn_failed", "login shell was not found");

    const terminalRef = previous?.runtime.terminal_ref ?? `term_${++seq}`;
    const generation = previous ? previous.runtime.generation + 1 : 1;
    const runtime: TerminalRuntime = {
      terminal_ref: terminalRef,
      project: request.project,
      folder_ref: picked.folder_ref,
      cwd_at_start: checked.path,
      program_path: program.file,
      launch_kind: "shell",
      state: "starting",
      generation,
      columns: request.columns,
      rows: request.rows,
      exit_code: null,
      failure_reason: null,
      output_seq: 0,
      dropped_output: false,
    };
    const session: Session = {
      runtime,
      buffer: new RingBuffer(),
      handle: null,
      group: null,
      typed: [],
    };
    sessions.set(terminalRef, session);
    try {
      const handle = deps.pty.spawn({
        file: program.file,
        args: program.args,
        cwd: checked.path,
        env: stripPlatformEnv(deps.env),
        columns: request.columns,
        rows: request.rows,
        controlFd: deps.controlFd,
      });
      session.handle = handle;
      session.group = deps.pty.group(handle.pid);
      runtime.state = "running";
      // 등록을 spawn 직후 동기로 붙인다. 미루면 초기 출력·종료를 놓친다.
      session.handle?.onData((chunk) => {
        void acceptChunk(session, chunk);
      });
      session.handle?.onExit((exit) => {
        // 성공을 추정하지 않고 관측한 종료를 기록한다. 이미 기록한
        // exited에 대한 두 번째 종료는 첫 관측을 대체하지 않는다.
        if (runtime.state === "unknown" || runtime.exit_code !== null) return;
        runtime.state = "exited";
        runtime.exit_code = exit.exitCode;
        runtime.dropped_output = session.buffer.dropped;
        session.handle = null;
      });
    } catch {
      runtime.state = "exited";
      runtime.failure_reason = "spawn_failed";
      runtime.exit_code = null;
      return { ok: true, runtime: { ...runtime } };
    }
    return { ok: true, runtime: { ...runtime } };
  }

  async function acceptChunk(session: Session, chunk: string): Promise<void> {
    await yieldChunk(deps.schedule);
    if (session.runtime.generation === 0) return;
    const stored = session.buffer.push(chunk);
    session.runtime.output_seq = stored.seq;
    session.runtime.dropped_output = session.buffer.dropped;
  }

  function sessionAt(ref: string, generation: number): Session | undefined {
    const session = sessions.get(ref);
    if (!session || session.runtime.generation !== generation) return;
    return session;
  }

  async function restart(
    session: Session,
    id: string,
  ): Promise<TerminalReply> {
    const ended = await stop(session, deps.sleep);
    if (ended.ok && ended.runtime.state === "unknown") return ended;
    const next = start(session, {
      id,
      type: "open",
      project: session.runtime.project,
      folder_ref: session.runtime.folder_ref,
      folders: [{
        folder_ref: session.runtime.folder_ref,
        path: session.runtime.cwd_at_start,
      }],
      columns: session.runtime.columns,
      rows: session.runtime.rows,
    });
    if (next.ok) {
      const restarted = sessions.get(next.runtime.terminal_ref);
      if (restarted && restarted.typed.length !== 0) {
        throw new Error("restart replayed input");
      }
    }
    return next;
  }

  return {
    handle(request) {
      if (request.type === "open") return start(undefined, request);
      if (request.type === "open-coding") return startCoding(request);
      if (request.type === "host-lost") {
        const gone = this.dispose();
        const marked = gone.map((runtime) => {
          runtime.state = "unknown";
          runtime.failure_reason = "host_lost";
          runtime.exit_code = null;
          const session = sessions.get(runtime.terminal_ref);
          if (session) session.runtime = runtime;
          return runtime;
        });
        return marked[0]
          ? { ok: true, runtime: marked[0] }
          : reject("host_lost", "terminal host is gone");
      }
      if (request.type === "snapshot") {
        const session = sessions.get(request.terminal_ref);
        if (!session) return reject("host_lost", "terminal is gone");
        const snap = session.buffer.snapshot();
        const after = request.after_seq ?? 0;
        // runtime을 같이 실어야 renderer가 종료·exit code·결과 불명을 본다.
        return {
          ok: true,
          runtime: { ...session.runtime },
          output: snap.chunks.filter((chunk) => chunk.seq > after).map((
            chunk,
          ) => ({
            terminal_ref: session.runtime.terminal_ref,
            generation: session.runtime.generation,
            seq: chunk.seq,
            chunk: chunk.text,
            dropped_output: snap.dropped,
          })),
        };
      }
      const session = sessionAt(request.terminal_ref, request.generation);
      if (!session) return reject("host_lost", "generation does not match");
      if (request.type === "input") {
        if (session.runtime.state !== "running" || !session.handle) {
          return reject("host_lost", "terminal is not running");
        }
        session.typed.push(request.text);
        session.handle.write(request.text);
        return { ok: true, runtime: { ...session.runtime } };
      }
      if (request.type === "resize") {
        if (session.runtime.state !== "running" || !session.handle) {
          return reject("host_lost", "terminal is not running");
        }
        session.handle.resize(request.columns, request.rows);
        session.runtime.columns = request.columns;
        session.runtime.rows = request.rows;
        return { ok: true, runtime: { ...session.runtime } };
      }
      if (request.type === "close") return stop(session, deps.sleep);
      if (request.type === "restart") {
        // coding TUI는 자동 resume·재spawn이 없다. 사람이 새 [Start]를 눌러야 한다(shell/terminal#R13).
        if (session.runtime.launch_kind === "coding_tui") {
          return reject(
            "spawn_failed",
            "coding TUI starts again only from a new start",
          );
        }
        return restart(session, request.id);
      }
      return reject("spawn_failed", "unknown request");
    },
    sessions() {
      return [...sessions.values()].map((session) => ({ ...session.runtime }));
    },
    dispose() {
      const gone: TerminalRuntime[] = [];
      for (const session of sessions.values()) {
        if (
          session.runtime.state === "running" ||
          session.runtime.state === "starting"
        ) {
          finish(session);
        }
        gone.push({ ...session.runtime });
      }
      return gone;
    },
  };
}

const STOP_POLL_MS = 25;
const STOP_POLLS = 40;

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 사람이 확인한 닫기. 터미널을 닫을 때처럼 SIGHUP을 보내고 group의 종료를 이벤트
 * 루프를 돌리며 확인한다. 끝나지 않으면 SIGKILL 뒤 다시 확인하고, 그래도 확인하지
 * 못하면 결과 불명이다(shell/terminal#R10). 대화형 shell은 SIGTERM을 무시하므로
 * 신호 직후 동기 확인만으로는 늘 확인 실패가 된다.
 */
async function stop(
  session: Session,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<TerminalReply> {
  if (
    session.runtime.state !== "running" && session.runtime.state !== "starting"
  ) {
    return { ok: true, runtime: { ...session.runtime } };
  }
  const group = session.group;
  const settle = async (signal: NodeJS.Signals): Promise<boolean> => {
    if (!group) return false;
    const sent = group.kill(signal);
    if (sent.confirmed) return true;
    for (let poll = 0; poll < STOP_POLLS; poll++) {
      await sleep(STOP_POLL_MS);
      if (!group.alive()) return true;
    }
    return false;
  };
  try {
    session.handle?.kill("SIGHUP");
  } catch {
    // group 확인이 종료의 근거다.
  }
  const confirmed = await settle("SIGHUP") || await settle("SIGKILL");
  return settleRuntime(session, confirmed);
}

function settleRuntime(session: Session, confirmed: boolean): TerminalReply {
  if (!confirmed) {
    session.runtime.state = "unknown";
    session.runtime.failure_reason = "kill_unconfirmed";
    session.runtime.exit_code = null;
  } else {
    // 관측한 종료만 exit code로 남긴다. 확인 없이 0을 추측하지 않는다.
    session.runtime.state = "exited";
    session.runtime.failure_reason = null;
  }
  session.handle = null;
  session.buffer.clear();
  session.typed.length = 0;
  if (confirmed) session.coding?.exited();
  else session.coding?.lost("종료를 확인하지 못했다");
  return { ok: true, runtime: { ...session.runtime } };
}

/** host 종료 때의 동기 정리. 기다릴 수 없으므로 신호 직후의 관측만 쓴다. */
function finish(session: Session): TerminalReply {
  if (
    session.runtime.state !== "running" && session.runtime.state !== "starting"
  ) {
    return { ok: true, runtime: { ...session.runtime } };
  }
  try {
    session.handle?.kill("SIGHUP");
  } catch {
    // group 확인이 종료의 근거다.
  }
  const killed = session.group?.kill("SIGHUP") ??
    { confirmed: false as const, reason: "no_group" };
  const confirmed = killed.confirmed
    ? killed
    : session.group?.kill("SIGKILL") ?? killed;
  return settleRuntime(session, confirmed.confirmed);
}

function pickFolder(
  folders: readonly FolderRecord[],
  folderRef: string | undefined,
):
  | { ok: true; folder_ref: string; path: string }
  | {
    ok: false;
    reason: "no_folder" | "choose_folder" | "unreadable";
    message: string;
  } {
  if (folders.length === 0) {
    return {
      ok: false,
      reason: "no_folder",
      message: "project has no registered folder",
    };
  }
  if (folderRef) {
    const found = folders.find((folder) => folder.folder_ref === folderRef);
    if (!found) {
      return {
        ok: false,
        reason: "unreadable",
        message: "folder_ref is not registered",
      };
    }
    return { ok: true, folder_ref: found.folder_ref, path: found.path };
  }
  if (folders.length > 1) {
    return {
      ok: false,
      reason: "choose_folder",
      message: "choose a registered folder before start",
    };
  }
  const only = folders[0]!;
  return { ok: true, folder_ref: only.folder_ref, path: only.path };
}

function reject(
  reason: NonNullable<TerminalRuntime["failure_reason"]>,
  message: string,
): TerminalReply {
  return { ok: false, reason, message };
}

export function hostFromNodePty(
  partial: Omit<HostDeps, "pty"> & { pty?: PtyAdapter },
): Host {
  return createHost({ ...partial, pty: partial.pty ?? nodePtyAdapter() });
}
