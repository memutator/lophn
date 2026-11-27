// core 실행당 PTY host 하나. PTY·child group·재연결용 화면을 갖고
// core가 물려 준 private pipe로만 말한다. 출력은 disk에 쓰지 않는다.

import { readFileSync } from "node:fs";
import { constants as osConstants } from "node:os";
import type { IdSource } from "../../../base/id.ts";
import type {
  TerminalOutput,
  TerminalRuntime,
} from "../../../protocol/coding-agent/terminals.ts";
import {
  SESSION_ENV_NAME,
  terminalSessionId,
} from "../../../protocol/lophn-agent/session-tag.ts";
import { type ProcessGroup } from "./child-group.ts";
import {
  type ConptyFrameBuffer,
  createConptyFrameBuffer,
  DEFAULT_WINDOWS_BUILD,
} from "./conpty-sync.ts";
import { resolveCommandShell, resolveLoginShell, terminalEnv } from "./env.ts";
import { foregroundGroupOf } from "./foreground.ts";
import {
  nodePtyAdapter,
  type PtyAdapter,
  type PtyHandle,
  yieldChunk,
} from "./pty.ts";
import { Screen } from "./screen.ts";
import { integrateShell } from "./shell-integration.ts";
import type { WinForegroundReader } from "./win-foreground.ts";
import type {
  ClipboardWrite,
  ForegroundChange,
  HostReply,
  HostRequest,
  HostScreenReply,
  HostSnapshotReply,
  HostTuiSnapshotReply,
  HostTuiStateReply,
} from "./wire.ts";

type FolderRecord = { folder_ref: string; path: string };

type FolderCheck =
  | { ok: true; path: string }
  | { ok: false; reason: "not_directory" | "unreadable" };

export type HostDeps = {
  ids: IdSource;
  pty: PtyAdapter;
  env: Readonly<Record<string, string | undefined>>;
  platform: NodeJS.Platform;
  exists: (file: string) => boolean;
  checkFolder: (path: string) => FolderCheck;
  schedule: (done: () => void) => void;
  /** 종료 확인 사이의 기다림. 테스트가 줄인다. */
  sleep?: (ms: number) => Promise<void>;
  /** ConPTY 다시 그리기 묶기 timer. 테스트가 주입한다. */
  after?: (ms: number, run: () => void) => () => void;
  /** Windows OS build 번호(ConPTY xterm 호환 옵션). */
  windowsBuildNumber?: number;
  controlFd?: number;
  /** process가 끝나 runtime이 바뀌었다. 요청의 답이 아니라 host가 먼저 알린다. */
  onRuntime?: (runtime: TerminalRuntime) => void;
  onOutput?: (output: TerminalOutput) => void;
  /** @xterm/headless가 OSC 52 clipboard 쓰기를 감지했다. */
  onClipboard?: (write: ClipboardWrite) => void;
  /** Windows shell pid 아래 자손 process에서 foreground coding agent argv를 읽는다. */
  winForeground?: WinForegroundReader;
};

type Session = {
  runtime: TerminalRuntime;
  screen: Screen;
  handle: PtyHandle | null;
  group: ProcessGroup | null;
  /** Windows ConPTY 조각 묶기 버퍼. 종료·정리 때 남은 조각을 비운다. */
  conptyBuffer: ConptyFrameBuffer | null;
  /** open 요청이 더한 env. restart가 이어 쓴다. */
  env?: Record<string, string>;
  /** 마지막으로 알린 foreground process argv를 이어 붙인 것. 바뀌었는지만 본다. */
  foreground: string | null;
  /** project command 전용 PTY 여부. */
  dedicated: boolean;
  /** agent가 `tab open --terminal`로 연 TUI 터미널 여부. */
  agent: boolean;
  /** desktop xterm client가 이 터미널에 붙어 있는지. false인 동안만 headless가 VT 질의에 답한다. */
  clientAttached: boolean;
  /** 전용 PTY에서 실행한 명령. */
  exec?: string;
};

const SIGNAL_NAMES = new Map<number, string>(
  Object.entries(osConstants.signals).map(([name, code]) => [code, name]),
);

function signalNameOf(signal: number | undefined): string | null {
  if (signal === undefined || signal === 0) return null;
  return SIGNAL_NAMES.get(signal) ?? `SIG${signal}`;
}

type Host = {
  /** 요청 하나의 예외는 그 요청의 host_lost 답이 된다. close·restart는 child 종료를 기다린다. */
  handle(
    request: HostRequest,
  ): Promise<
    | HostReply
    | HostSnapshotReply
    | HostScreenReply
    | HostTuiStateReply
    | HostTuiSnapshotReply
  >;
  sessions(): readonly TerminalRuntime[];
  /** 살아 있는 shell 터미널 중 foreground argv가 지난번과 달라진 것만 돌려준다. */
  foregroundChanges(): ForegroundChange[] | Promise<ForegroundChange[]>;
  /** 도는 모든 터미널을 SIGHUP, 확인, SIGKILL로 정리한다. host가 끝나기 전에 부른다. */
  shutdown(): Promise<void>;
};

function createHost(deps: HostDeps): Host {
  const sessions = new Map<string, Session>();

  function start(
    previous: Session | undefined,
    request: Extract<HostRequest, { type: "open" }>,
  ): HostReply {
    const picked = pickFolder(request.folders, request.folder_ref);
    if (!picked.ok) return reject(picked.reason, picked.message);
    const checked = deps.checkFolder(request.cwd ?? picked.path);
    if (!checked.ok) {
      return reject(checked.reason, "registered folder cannot be used");
    }
    const isAgent = request.agent === true;
    const isDedicated =
      request.dedicated === true || (!isAgent && request.exec !== undefined);
    const program =
      request.exec !== undefined
        ? resolveCommandShell(
            {
              platform: deps.platform,
              env: deps.env,
              exists: deps.exists,
            },
            request.exec,
          )
        : resolveLoginShell({
            platform: deps.platform,
            env: deps.env,
            exists: deps.exists,
          });
    if (!program) return reject("spawn_failed", "login shell was not found");

    // 이전 실행 화면이 남아 있으면 새 실행 시작 시 정리한다.
    previous?.screen.dispose();

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
      exit_signal: null,
      failure_reason: null,
      output_seq: 0,
      dropped_output: false,
      ...(isDedicated ? { dedicated: true as const } : {}),
    };
    const defaultAfter = (ms: number, run: () => void) => {
      const timer = setTimeout(run, ms);
      return () => clearTimeout(timer);
    };
    const windowsPty =
      deps.platform === "win32"
        ? {
            backend: "conpty" as const,
            buildNumber: deps.windowsBuildNumber ?? DEFAULT_WINDOWS_BUILD,
          }
        : undefined;
    const session: Session = {
      runtime,
      screen: null as unknown as Screen,
      handle: null,
      group: null,
      conptyBuffer: null,
      env: shellEnv,
      foreground: null,
      dedicated: isDedicated,
      agent: isAgent,
      clientAttached: false,
      ...(request.exec === undefined ? {} : { exec: request.exec }),
    };
    session.screen = new Screen(request.columns, request.rows, {
      ...(windowsPty === undefined ? {} : { windowsPty }),
      onClipboard: (bytes) =>
        deps.onClipboard?.({ terminal_ref: terminalRef, generation, bytes }),
      // 붙은 desktop xterm이 없을 때만 headless가 VT 질의(DA/DSR/OSC 10·11/Kitty)에 바로 답해 vim·less 멈춤을 막는다.
      onReply: (reply) => {
        if (
          !session.clientAttached &&
          session.runtime.state === "running" &&
          session.handle !== null
        ) {
          session.handle.write(reply);
        }
      },
    });
    sessions.set(terminalRef, session);
    try {
      // strip 뒤에 덮어야 더한 LPN_ 값이 지워지지 않는다. 세션 표지는 물려받은 값이 아니라 이 탭의 id다(strip이 지운다).
      const env = {
        ...terminalEnv(deps.env),
        TERM: "xterm-256color",
        ...shellEnv,
        [SESSION_ENV_NAME]: terminalSessionId(terminalRef),
      };
      const integrated =
        isDedicated || isAgent
          ? { args: program.args, env: {} as Record<string, string> }
          : integrateShell(program.file, program.args, env, deps.exists);
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
      // 앱이 shell pid에서 process tree를 따라갈 수 있게 core에 알린다(CLI 자신의 pid가 아니다).
      runtime.shell_pid = handle.pid;
      const emitChunk = (chunk: string) => {
        // 한 탭 출력의 parse 예외가 host 전체를 끝내지 않게 한다.
        acceptChunk(session, chunk).catch((error: unknown) => {
          console.error("terminal output failed:", error);
        });
      };
      if (deps.platform === "win32") {
        session.conptyBuffer = createConptyFrameBuffer({
          flush: emitChunk,
          after: deps.after ?? defaultAfter,
        });
      }
      // 등록을 spawn 직후 동기로 붙인다. 미루면 초기 출력·종료를 놓친다.
      session.handle?.onData((chunk) => {
        if (session.conptyBuffer !== null) session.conptyBuffer.push(chunk);
        else emitChunk(chunk);
      });
      session.handle?.onExit((exit) => {
        session.conptyBuffer?.drain();
        // 성공을 추정하지 않고 관측한 종료를 기록한다. 이미 기록한
        // exited에 대한 두 번째 종료는 첫 관측을 대체하지 않는다.
        if (runtime.state === "unknown" || runtime.exit_code !== null) return;
        runtime.state = "exited";
        runtime.exit_code = exit.exitCode;
        runtime.exit_signal = signalNameOf(exit.signal);
        runtime.dropped_output = session.screen.dropped;
        session.handle = null;
        deps.onRuntime?.({ ...runtime });
      });
    } catch (error) {
      // 화면에는 spawn_failed만 보이므로 원인(SHELL 실행 불가, cwd 권한 등)은 stderr로만 남는다.
      console.error(
        `terminal spawn failed: ${program.file}: ${error instanceof Error ? error.message : String(error)}`,
      );
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
    const seq = session.screen.push(chunk);
    session.runtime.output_seq = seq;
    session.runtime.dropped_output = session.screen.dropped;
    deps.onOutput?.({
      terminal_ref: session.runtime.terminal_ref,
      generation: session.runtime.generation,
      seq,
      chunk,
      dropped_output: session.runtime.dropped_output,
    });
  }

  function sessionAt(ref: string, generation: number): Session | undefined {
    const session = sessions.get(ref);
    if (!session || session.runtime.generation !== generation) return;
    return session;
  }

  async function restart(session: Session): Promise<HostReply> {
    const ended = await stop(session, deps.sleep);
    if (ended.ok && ended.runtime.state === "unknown") return ended;
    const next = start(session, {
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
    return next;
  }

  function dispatch(
    request: HostRequest,
  ):
    | HostReply
    | HostSnapshotReply
    | Promise<
        | HostReply
        | HostSnapshotReply
        | HostScreenReply
        | HostTuiStateReply
        | HostTuiSnapshotReply
      > {
    if (request.type === "open") {
      const previous =
        request.terminal_ref === undefined
          ? undefined
          : sessions.get(request.terminal_ref);
      return start(previous, request);
    }
    if (request.type === "client_attached") {
      const session = sessions.get(request.terminal_ref);
      if (!session) return reject("host_lost", "terminal is gone");
      session.clientAttached = request.attached;
      return { ok: true, runtime: { ...session.runtime } };
    }
    if (request.type === "tui_state") {
      const session = sessions.get(request.terminal_ref);
      if (!session) return reject("host_lost", "terminal is gone");
      return session.screen.tuiState().then((state) => {
        if (state === null) return reject("host_lost", "terminal is gone");
        return {
          ok: true as const,
          runtime: { ...session.runtime },
          state,
        };
      });
    }
    if (request.type === "tui_snapshot") {
      const session = sessions.get(request.terminal_ref);
      if (!session) return reject("host_lost", "terminal is gone");
      return session.screen
        .tuiSnapshot({
          ...(request.scrollback === undefined
            ? {}
            : { scrollback: request.scrollback }),
          ...(request.ansi === undefined ? {} : { ansi: request.ansi }),
        })
        .then((snapshot) => {
          if (snapshot === null) return reject("host_lost", "terminal is gone");
          return {
            ok: true as const,
            runtime: { ...session.runtime },
            snapshot,
          };
        });
    }
    if (request.type === "screen") {
      const session = sessions.get(request.terminal_ref);
      if (!session) return reject("host_lost", "terminal is gone");
      const sameGeneration =
        request.generation === undefined ||
        request.generation === session.runtime.generation;
      const known = sameGeneration
        ? {
            afterSeq: request.after_seq,
            columns: request.columns,
            rows: request.rows,
            scrollbackKey: request.scrollback_key,
          }
        : undefined;
      return session.screen.screen(request.tail, known).then((screen) => {
        if (screen === null) return reject("host_lost", "terminal is gone");
        if ("unchanged" in screen) {
          return {
            ok: true as const,
            runtime: { ...session.runtime },
            unchanged: true as const,
          };
        }
        return {
          ok: true as const,
          runtime: { ...session.runtime },
          screen: { ...screen, generation: session.runtime.generation },
        };
      });
    }
    if (request.type === "snapshot") {
      const session = sessions.get(request.terminal_ref);
      if (!session) return reject("host_lost", "terminal is gone");
      const after = request.after_seq ?? 0;
      // after_seq 뒤 출력이 있으면 지금 화면 하나를 그 마지막 seq로 준다. raw chunk를 나눠 주지 않는다.
      return session.screen.snapshot().then((screen) => ({
        ok: true as const,
        // runtime을 같이 실어야 renderer가 종료·exit code·결과 불명을 본다.
        runtime: { ...session.runtime },
        output:
          screen.seq > after && screen.text !== ""
            ? [
                {
                  terminal_ref: session.runtime.terminal_ref,
                  generation: session.runtime.generation,
                  seq: screen.seq,
                  chunk: screen.text,
                  dropped_output: session.screen.dropped,
                },
              ]
            : [],
      }));
    }
    const session = sessionAt(request.terminal_ref, request.generation);
    if (!session) return reject("host_lost", "generation does not match");
    if (request.type === "input") {
      if (session.runtime.state !== "running" || !session.handle) {
        return reject("host_lost", "terminal is not running");
      }
      session.handle.write(request.text);
      return { ok: true, runtime: { ...session.runtime } };
    }
    if (request.type === "signal") {
      if (session.runtime.state !== "running" || !session.handle) {
        return reject("host_lost", "terminal is not running");
      }
      if (deps.platform !== "linux") {
        return reject("host_lost", "signal is only available on Linux");
      }
      // foreground가 shell 자신이면 보낼 곳이 없다.
      const group = foregroundGroupOf({
        pid: session.handle.pid,
        platform: deps.platform,
        readFile: (path) => readFileSync(path, "utf8"),
      });
      if (group !== null) {
        try {
          process.kill(-group, request.signal);
        } catch {
          // 그 사이 끝난 group이다.
        }
      }
      return { ok: true, runtime: { ...session.runtime } };
    }
    if (request.type === "resize") {
      if (session.runtime.state !== "running" || !session.handle) {
        return reject("host_lost", "terminal is not running");
      }
      // 같은 치수로 PTY를 다시 resize하면 POSIX는 SIGWINCH, Windows ConPTY는 전체 다시 그리기를 낸다.
      if (
        session.runtime.columns !== request.columns ||
        session.runtime.rows !== request.rows
      ) {
        session.handle.resize(request.columns, request.rows);
        session.screen.resize(request.columns, request.rows);
        session.runtime.columns = request.columns;
        session.runtime.rows = request.rows;
      }
      if (request.remote) session.runtime.remote_size = true;
      else delete session.runtime.remote_size;
      return { ok: true, runtime: { ...session.runtime } };
    }
    if (request.type === "release") {
      delete session.runtime.remote_size;
      return { ok: true, runtime: { ...session.runtime } };
    }
    if (request.type === "close") {
      return stop(session, deps.sleep, session.agent);
    }
    if (request.type === "restart") {
      return restart(session);
    }
    return reject("spawn_failed", "unknown request");
  }

  return {
    async handle(request) {
      try {
        return await dispatch(request);
      } catch (error) {
        console.error("terminal request failed:", error);
        const message = error instanceof Error ? error.message : String(error);
        return reject("host_lost", `terminal host failed: ${message}`);
      }
    },
    sessions() {
      return [...sessions.values()].map((session) => ({ ...session.runtime }));
    },
    foregroundChanges() {
      if (deps.platform === "win32" && deps.winForeground !== undefined) {
        const running = [...sessions.values()].filter(
          (session) =>
            !session.dedicated &&
            !session.agent &&
            session.runtime.state === "running" &&
            session.handle !== null,
        );
        if (running.length === 0) return [];
        const pids = running.map((session) => session.handle!.pid);
        return deps.winForeground.query(pids).then((byPid) => {
          const changes: ForegroundChange[] = [];
          for (const session of running) {
            const { runtime, handle } = session;
            if (runtime.state !== "running" || !handle) continue;
            if (!byPid.has(handle.pid)) continue;
            const argv = byPid.get(handle.pid) ?? null;
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
        });
      }
      const changes: ForegroundChange[] = [];
      for (const session of sessions.values()) {
        const { runtime, handle } = session;
        if (session.dedicated || session.agent || runtime.state !== "running") {
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
    async shutdown() {
      deps.winForeground?.stop();
      await Promise.all(
        [...sessions.values()].map(async (session) => {
          await stop(session, deps.sleep, true);
          session.screen.dispose();
        }),
      );
    },
  };
}

const STOP_POLL_MS = 25;
const STOP_POLLS = 40;
// project command 전용 PTY는 POSIX 프로세스 그룹에 SIGTERM 후 3초 유예 뒤 SIGKILL이다(spec 3.3.2).
const DEDICATED_STOP_POLLS = 120;

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 사람이 확인한 닫기. 대화형 터미널은 SIGHUP → 1초 → SIGKILL이고,
 * project command 전용 PTY는 프로세스 그룹 SIGTERM → 3초 → SIGKILL(Windows는 taskkill /T /F)이다.
 */
async function stop(
  session: Session,
  sleep: (ms: number) => Promise<void> = defaultSleep,
  disposeDedicatedScreen = false,
): Promise<HostReply> {
  if (
    session.runtime.state !== "running" &&
    session.runtime.state !== "starting"
  ) {
    if (disposeDedicatedScreen) session.screen.dispose();
    return { ok: true, runtime: { ...session.runtime } };
  }
  const group = session.group;
  const useProcessGroup = session.dedicated || session.agent;
  const polls = useProcessGroup ? DEDICATED_STOP_POLLS : STOP_POLLS;
  const settle = async (
    signal: NodeJS.Signals,
    maxPolls: number,
  ): Promise<boolean> => {
    if (!group) return false;
    const sent = group.kill(signal);
    if (sent.confirmed) return true;
    for (let poll = 0; poll < maxPolls; poll++) {
      await sleep(STOP_POLL_MS);
      if (!group.alive()) return true;
    }
    return false;
  };
  let confirmed: boolean;
  if (useProcessGroup) {
    confirmed =
      (await settle("SIGTERM", polls)) || (await settle("SIGKILL", STOP_POLLS));
  } else {
    try {
      hangup(session.handle);
    } catch {
      // group 확인이 종료의 근거다.
    }
    confirmed =
      (await settle("SIGHUP", STOP_POLLS)) ||
      (await settle("SIGKILL", STOP_POLLS));
  }
  return settleRuntime(
    session,
    confirmed,
    !session.dedicated || disposeDedicatedScreen,
  );
}

// node-pty는 Windows에서 신호 이름을 거절한다.
function hangup(handle: PtyHandle | null): void {
  handle?.kill(process.platform === "win32" ? undefined : "SIGHUP");
}

function settleRuntime(
  session: Session,
  confirmed: boolean,
  disposeScreen = true,
): HostReply {
  if (!confirmed) {
    session.runtime.state = "unknown";
    session.runtime.failure_reason = "kill_unconfirmed";
    session.runtime.exit_code = null;
  } else {
    // 관측한 종료만 exit code로 남긴다. 확인 없이 0을 추측하지 않는다.
    session.runtime.state = "exited";
    session.runtime.failure_reason = null;
  }
  session.conptyBuffer?.drain();
  session.conptyBuffer = null;
  session.handle = null;
  if (disposeScreen) session.screen.dispose();
  return { ok: true, runtime: { ...session.runtime } };
}

function pickFolder(
  folders: readonly FolderRecord[],
  folderRef: string | undefined,
):
  | { ok: true; folder_ref: string; path: string }
  | {
      ok: false;
      reason: "no_folder" | "unreadable";
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
  const only = folders[0]!;
  return { ok: true, folder_ref: only.folder_ref, path: only.path };
}

function reject(
  reason: NonNullable<TerminalRuntime["failure_reason"]>,
  message: string,
): HostReply {
  return { ok: false, reason, message };
}

export function hostFromNodePty(
  partial: Omit<HostDeps, "pty"> & { pty?: PtyAdapter },
): Host {
  return createHost({ ...partial, pty: partial.pty ?? nodePtyAdapter() });
}
