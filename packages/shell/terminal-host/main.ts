// Electron 실행당 terminal host 하나. PTY·child group·ring buffer를 갖고
// main이 물려 준 private pipe로만 말한다. 출력은 disk에 쓰지 않는다.

import type {
  TerminalReply,
  TerminalRuntime,
  TerminalOutput,
  TerminalSnapshotReply,
} from "../ipc/terminal.ts";
import type { IdSource } from "../../base/id.ts";
import { resolveLoginShell, terminalEnv } from "./env.ts";
import {
  nodePtyAdapter,
  type PtyAdapter,
  type PtyHandle,
  yieldChunk,
} from "./pty.ts";
import { type ProcessGroup } from "./child-group.ts";
import { integrateShell } from "./shell-integration.ts";
import { RingBuffer } from "./ring-buffer.ts";

type FolderRecord = { folder_ref: string; path: string };

type FolderCheck =
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
      /** shell env에 더할 값. 다시 시작해도 같은 값을 쓴다. */
      env?: Record<string, string>;
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

type HostDeps = {
  ids: IdSource;
  pty: PtyAdapter;
  env: Readonly<Record<string, string | undefined>>;
  platform: NodeJS.Platform;
  exists: (file: string) => boolean;
  checkFolder: (path: string) => FolderCheck;
  schedule: (done: () => void) => void;
  /** 종료 확인 사이의 기다림. 테스트가 줄인다. */
  sleep?: (ms: number) => Promise<void>;
  controlFd?: number;
  /** process가 끝나 runtime이 바뀌었다. 요청의 답이 아니라 host가 먼저 알린다. */
  onRuntime?: (runtime: TerminalRuntime) => void;
  onOutput?: (output: TerminalOutput) => void;
};

type Session = {
  runtime: TerminalRuntime;
  buffer: RingBuffer;
  handle: PtyHandle | null;
  group: ProcessGroup | null;
  /** 사람이 보낸 입력. 재시작 때 재생하지 않는다. */
  typed: string[];
  /** open 요청이 더한 env. restart가 이어 쓴다. */
  env?: Record<string, string>;
  /** 마지막으로 알린 foreground process argv를 이어 붙인 것. 바뀌었는지만 본다. */
  foreground: string | null;
};

export type ForegroundChange = {
  terminal_ref: string;
  generation: number;
  argv: string[] | null;
};

type Host = {
  /** close·restart는 child 종료를 기다려 확인하므로 Promise다. */
  handle(
    request: HostRequest,
  ):
    | TerminalReply
    | TerminalSnapshotReply
    | Promise<TerminalReply | TerminalSnapshotReply>;
  sessions(): readonly TerminalRuntime[];
  /** 살아 있는 shell 터미널 중 foreground argv가 지난번과 달라진 것만 돌려준다. */
  foregroundChanges(): ForegroundChange[];
  dispose(): TerminalRuntime[];
};

function createHost(deps: HostDeps): Host {
  const sessions = new Map<string, Session>();

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

    // host를 다시 띄워도 옛 view·대기 중 입력의 ref를 새 PTY에 재사용하지 않는다.
    const terminalRef = previous?.runtime.terminal_ref ?? deps.ids.newId("trm");
    const shellEnv = request.env ?? previous?.env;
    const generation = previous ? previous.runtime.generation + 1 : 1;
    const runtime: TerminalRuntime = {
      terminal_ref: terminalRef,
      project: request.project,
      folder_ref: picked.folder_ref,
      cwd_at_start: checked.path,
      program_path: program.file,
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
      env: shellEnv,
      foreground: null,
    };
    sessions.set(terminalRef, session);
    try {
      // strip 뒤에 덮어야 더한 LPN_ 값이 지워지지 않는다.
      const env = { ...terminalEnv(deps.env), ...shellEnv };
      const integrated = integrateShell(program.file, program.args, env);
      const handle = deps.pty.spawn({
        file: program.file,
        args: integrated.args,
        cwd: checked.path,
        env: { ...env, ...integrated.env },
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
        deps.onRuntime?.({ ...runtime });
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
    deps.onOutput?.({
      terminal_ref: session.runtime.terminal_ref,
      generation: session.runtime.generation,
      seq: stored.seq,
      chunk: stored.text,
      dropped_output: session.buffer.dropped,
    });
  }

  function sessionAt(ref: string, generation: number): Session | undefined {
    const session = sessions.get(ref);
    if (!session || session.runtime.generation !== generation) return;
    return session;
  }

  async function restart(session: Session, id: string): Promise<TerminalReply> {
    const ended = await stop(session, deps.sleep);
    if (ended.ok && ended.runtime.state === "unknown") return ended;
    const next = start(session, {
      id,
      type: "open",
      project: session.runtime.project,
      folder_ref: session.runtime.folder_ref,
      folders: [
        {
          folder_ref: session.runtime.folder_ref,
          path: session.runtime.cwd_at_start,
        },
      ],
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
        const snap = session.buffer.snapshot(request.after_seq ?? 0);
        // runtime을 같이 실어야 renderer가 종료·exit code·결과 불명을 본다.
        return {
          ok: true,
          runtime: { ...session.runtime },
          output: snap.chunks.map((chunk) => ({
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
        return restart(session, request.id);
      }
      return reject("spawn_failed", "unknown request");
    },
    sessions() {
      return [...sessions.values()].map((session) => ({ ...session.runtime }));
    },
    foregroundChanges() {
      const changes: ForegroundChange[] = [];
      for (const session of sessions.values()) {
        const { runtime, handle } = session;
        if (runtime.state !== "running") {
          continue;
        }
        if (!handle) continue;
        const argv = handle.foreground();
        // NUL은 argv 안에 들어갈 수 없어 이어 붙인 것이 argv를 대신한다.
        const joined = argv === null ? null : argv.join("\0");
        if (joined === session.foreground) continue;
        session.foreground = joined;
        changes.push({
          terminal_ref: runtime.terminal_ref,
          generation: runtime.generation,
          argv,
        });
      }
      return changes;
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
 * 못하면 결과 불명이다. 대화형 shell은 SIGTERM을 무시하므로
 * 신호 직후 동기 확인만으로는 늘 확인 실패가 된다.
 */
async function stop(
  session: Session,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<TerminalReply> {
  if (
    session.runtime.state !== "running" &&
    session.runtime.state !== "starting"
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
  const confirmed = (await settle("SIGHUP")) || (await settle("SIGKILL"));
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
  return { ok: true, runtime: { ...session.runtime } };
}

/** host 종료 때의 동기 정리. 기다릴 수 없으므로 신호 직후의 관측만 쓴다. */
function finish(session: Session): TerminalReply {
  if (
    session.runtime.state !== "running" &&
    session.runtime.state !== "starting"
  ) {
    return { ok: true, runtime: { ...session.runtime } };
  }
  try {
    session.handle?.kill("SIGHUP");
  } catch {
    // group 확인이 종료의 근거다.
  }
  const killed = session.group?.kill("SIGHUP") ?? {
    confirmed: false as const,
    reason: "no_group",
  };
  const confirmed = killed.confirmed
    ? killed
    : (session.group?.kill("SIGKILL") ?? killed);
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
