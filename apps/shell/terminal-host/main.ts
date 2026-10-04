// Electron 실행당 terminal host 하나. PTY·child group·ring buffer를 갖고
// main이 물려 준 private pipe로만 말한다. 출력은 disk에 쓰지 않는다.

import type {
  TerminalOutput,
  TerminalReply,
  TerminalRuntime,
} from "../ipc/terminal.ts";
import { resolveLoginShell, stripPlatformEnv } from "./env.ts";
import {
  nodePtyAdapter,
  type PtyAdapter,
  type PtyHandle,
  yieldChunk,
} from "./pty.ts";
import { type ProcessGroup } from "./child-group.ts";
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
  | { id: string; type: "snapshot"; terminal_ref: string }
  | { id: string; type: "host-lost" };

export type HostDeps = {
  pty: PtyAdapter;
  env: Readonly<Record<string, string | undefined>>;
  platform: NodeJS.Platform;
  exists: (file: string) => boolean;
  checkFolder: (path: string) => FolderCheck;
  schedule: (done: () => void) => void;
  controlFd?: number;
};

type Session = {
  runtime: TerminalRuntime;
  buffer: RingBuffer;
  handle: PtyHandle | null;
  group: ProcessGroup | null;
  /** 사람이 보낸 입력. 재시작 때 재생하지 않는다. */
  typed: string[];
};

export type Host = {
  handle(
    request: HostRequest,
  ): TerminalReply | { ok: true; output: TerminalOutput[] };
  sessions(): readonly TerminalRuntime[];
  dispose(): TerminalRuntime[];
};

export function createHost(deps: HostDeps): Host {
  const sessions = new Map<string, Session>();
  let seq = 0;

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
      setImmediate(() => {
        session.handle?.onData((chunk) => {
          void acceptChunk(session, chunk);
        });
        session.handle?.onExit((exit) => {
          if (runtime.state === "unknown" || runtime.state === "exited") return;
          runtime.state = "exited";
          runtime.exit_code = exit.exitCode;
          session.handle = null;
        });
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

  return {
    handle(request) {
      if (request.type === "open") return start(undefined, request);
      if (request.type === "host-lost") {
        const gone = this.dispose().map((runtime) => {
          runtime.state = "unknown";
          runtime.failure_reason = "host_lost";
          runtime.exit_code = null;
          return runtime;
        });
        for (const runtime of gone) {
          const session = sessions.get(runtime.terminal_ref);
          if (session) session.runtime = runtime;
        }
        return gone[0]
          ? { ok: true, runtime: gone[0] }
          : reject("host_lost", "terminal host is gone");
      }
      if (request.type === "snapshot") {
        const session = sessions.get(request.terminal_ref);
        if (!session) return reject("host_lost", "terminal is gone");
        const snap = session.buffer.snapshot();
        return {
          ok: true,
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
      if (request.type === "close") return finish(session);
      if (request.type === "restart") {
        const typed = session.typed.slice();
        const ended = finish(session);
        if (ended.ok && ended.runtime.state === "unknown") return ended;
        const next = start(session, {
          id: request.id,
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
          void typed;
        }
        return next;
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

function finish(session: Session): TerminalReply {
  if (
    session.runtime.state !== "running" && session.runtime.state !== "starting"
  ) {
    return { ok: true, runtime: { ...session.runtime } };
  }
  try {
    session.handle?.kill("SIGTERM");
  } catch {
    // group 확인이 종료의 근거다.
  }
  const killed = session.group?.kill("SIGTERM") ??
    { confirmed: false as const, reason: "no_group" };
  const confirmed = killed.confirmed
    ? killed
    : session.group?.kill("SIGKILL") ?? killed;
  if (!confirmed.confirmed) {
    session.runtime.state = "unknown";
    session.runtime.failure_reason = "kill_unconfirmed";
    session.runtime.exit_code = null;
  } else {
    session.runtime.state = "exited";
    session.runtime.exit_code = session.runtime.exit_code ?? 0;
  }
  session.handle = null;
  return { ok: true, runtime: { ...session.runtime } };
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
