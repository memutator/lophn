// project command 실행 runtime. core 메모리에 명령당 현재/마지막 실행(`ProjectCommandRun`)과
// 로그 버퍼를 두고, 전용 PTY 수명주기·URL 감지·timeout·직렬 restart·shutdown을 관리한다.
import { createConnection } from "node:net";
import { resolve } from "node:path";
import {
  type Clock,
  err,
  type IdSource,
  ok,
  type Result,
} from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type {
  ProjectCommand,
  ProjectCommandRun,
  RunEndedBy,
} from "../../../protocol/projects/project-commands.ts";
import { folderOfCwd } from "../../terminals/cwd.ts";
import type { Terminals } from "../../terminals/ports.ts";
import { CommandLogBuffer } from "./log-buffer.ts";
import { extractLocalUrls } from "./url-detect.ts";

export type ProjectFolder = {
  folder_ref: string;
  path: string;
};

export type ProjectCommandRuntimeDeps = {
  terminals: Pick<
    Terminals,
    "open" | "close" | "patch" | "onRuntime" | "onOutput"
  >;
  folders(project: string): Promise<Result<readonly ProjectFolder[]>>;
  clock: Clock;
  ids: IdSource;
  onRunChanged(project: Id<"prj">, run: ProjectCommandRun): void;
  /** `auto_open_preview`가 켜진 명령의 URL이 준비됐을 때 내장 browser 탭을 연다. */
  openPreview?(project: Id<"prj">, url: string): void;
  /** agent에게 로그를 넘길 때 알려진 비밀값을 마스킹한다. */
  redact?(text: string): string;
  /** TCP 연결 가능 여부를 확인한다(preview_url 폴링용). 테스트에서 교체 가능. */
  probeTcp?(host: string, port: number): Promise<boolean>;
  after?(ms: number, run: () => void): () => void;
};

const PREVIEW_POLL_INTERVAL_MS = 500;
const PREVIEW_POLL_MAX_MS = 60_000;

function defaultProbeTcp(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const done = (reachable: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(500);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

function defaultAfter(ms: number, run: () => void): () => void {
  const timer = setTimeout(run, ms);
  timer.unref?.();
  return () => clearTimeout(timer);
}

function maskEnvValues(
  lines: readonly string[],
  env: Readonly<Record<string, string>> | undefined,
  redact?: (text: string) => string,
): string[] {
  const secretValues = Object.values(env ?? {}).filter(
    (value) => value.length >= 4,
  );
  return lines.map((line) => {
    let out = redact ? redact(line) : line;
    for (const secret of secretValues) {
      if (out.includes(secret)) {
        out = out.split(secret).join("[REDACTED]");
      }
    }
    return out;
  });
}

type ActiveState = {
  project: Id<"prj">;
  command: ProjectCommand;
  run: ProjectCommandRun;
  generation: number | null;
  logs: CommandLogBuffer;
  pendingEndedBy: RunEndedBy | null;
  previewOpened: boolean;
  cancelTimeout: (() => void) | null;
  cancelPreviewPoll: (() => void) | null;
  waiters: ((run: ProjectCommandRun) => void)[];
};

function isLive(status: ProjectCommandRun["status"]): boolean {
  return status === "starting" || status === "running";
}

function keyOf(project: string, commandId: string): string {
  return `${project}\0${commandId}`;
}

export type ProjectCommandRuntime = ReturnType<
  typeof createProjectCommandRuntime
>;

export function createProjectCommandRuntime(deps: ProjectCommandRuntimeDeps) {
  const entries = new Map<string, ActiveState>();
  // 명령별 터미널 참조 재사용(누를 때마다 새 터미널을 만들지 않는다).
  const terminalRefs = new Map<string, string>();
  // terminal_ref → ActiveState 역인덱스(출력·종료 이벤트 라우팅).
  const byTerminal = new Map<string, ActiveState>();
  // 명령별 직렬화 큐(stop / restart / start 경합 방지).
  const queues = new Map<string, Promise<unknown>>();
  const after = deps.after ?? defaultAfter;
  const probeTcp = deps.probeTcp ?? defaultProbeTcp;

  function serialize<T>(
    project: string,
    commandId: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const key = keyOf(project, commandId);
    const previous = queues.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(work);
    queues.set(key, next);
    void next.finally(() => {
      if (queues.get(key) === next) queues.delete(key);
    });
    return next;
  }

  function emit(state: ActiveState): void {
    deps.onRunChanged(state.project, {
      ...state.run,
      detected_urls: [...state.run.detected_urls],
    });
  }

  function clearTimers(state: ActiveState): void {
    state.cancelTimeout?.();
    state.cancelTimeout = null;
    state.cancelPreviewPoll?.();
    state.cancelPreviewPoll = null;
  }

  function settle(
    state: ActiveState,
    exitCode: number | null,
    signal: string | null,
  ): void {
    if (!isLive(state.run.status)) return;
    clearTimers(state);
    state.logs.compactToTail();

    let status: ProjectCommandRun["status"];
    let endedBy: RunEndedBy;
    if (state.pendingEndedBy === "timeout") {
      status = "timed_out";
      endedBy = "timeout";
    } else if (
      state.pendingEndedBy === "user" ||
      state.pendingEndedBy === "agent" ||
      state.pendingEndedBy === "shutdown"
    ) {
      status = "stopped";
      endedBy = state.pendingEndedBy;
    } else {
      endedBy = "process";
      if (state.command.kind === "action") {
        status = exitCode === 0 ? "succeeded" : "failed";
      } else {
        // service의 비자발 종료는 failed다(spec 3.1).
        status = "failed";
      }
    }

    state.run = {
      ...state.run,
      status,
      ended_at: deps.clock.now(),
      exit_code: exitCode,
      signal,
      ended_by: endedBy,
    };
    if (
      state.run.terminal_id !== null &&
      byTerminal.get(state.run.terminal_id) === state
    ) {
      byTerminal.delete(state.run.terminal_id);
    }
    emit(state);
    const waiters = state.waiters.splice(0);
    for (const resolve of waiters) resolve({ ...state.run });
  }

  function startPreviewPoll(state: ActiveState, previewUrl: string): void {
    if (!deps.openPreview || state.previewOpened) return;
    let parsed: URL;
    try {
      parsed = new URL(previewUrl);
    } catch {
      return;
    }
    const host = parsed.hostname === "0.0.0.0" ? "127.0.0.1" : parsed.hostname;
    const port =
      parsed.port !== ""
        ? Number(parsed.port)
        : parsed.protocol === "https:"
          ? 443
          : 80;
    const deadline = deps.clock.nowMs() + PREVIEW_POLL_MAX_MS;
    let cancelled = false;
    let cancelStep: (() => void) | null = null;

    const tick = async () => {
      if (cancelled || state.previewOpened || !isLive(state.run.status)) return;
      const reachable = await probeTcp(host, port).catch(() => false);
      if (cancelled || state.previewOpened || !isLive(state.run.status)) return;
      if (reachable) {
        state.previewOpened = true;
        deps.openPreview?.(state.project, previewUrl);
        return;
      }
      if (deps.clock.nowMs() >= deadline) return;
      cancelStep = after(PREVIEW_POLL_INTERVAL_MS, () => {
        void tick();
      });
    };
    cancelStep = after(PREVIEW_POLL_INTERVAL_MS, () => {
      void tick();
    });
    state.cancelPreviewPoll = () => {
      cancelled = true;
      cancelStep?.();
      cancelStep = null;
    };
  }

  const offOutput = deps.terminals.onOutput((chunks) => {
    for (const chunk of chunks) {
      const state = byTerminal.get(chunk.terminal_ref);
      if (
        state === undefined ||
        state.generation !== chunk.generation ||
        !isLive(state.run.status)
      ) {
        continue;
      }
      state.logs.push(chunk.chunk);
      const found = extractLocalUrls(chunk.chunk, state.run.detected_urls);
      if (found.length > 0) {
        state.run = {
          ...state.run,
          detected_urls: [...state.run.detected_urls, ...found],
        };
        emit(state);
        if (
          state.command.auto_open_preview === true &&
          state.command.preview_url === undefined &&
          !state.previewOpened
        ) {
          state.previewOpened = true;
          deps.openPreview?.(state.project, found[0]!);
        }
      }
    }
  });

  const offRuntime = deps.terminals.onRuntime((runtime) => {
    const state = byTerminal.get(runtime.terminal_ref);
    if (
      state === undefined ||
      state.generation !== runtime.generation ||
      !isLive(state.run.status)
    ) {
      return;
    }
    if (runtime.state === "exited" || runtime.state === "unknown") {
      settle(state, runtime.exit_code, runtime.exit_signal ?? null);
    }
  });

  async function startUnlocked(
    project: Id<"prj">,
    command: ProjectCommand,
  ): Promise<Result<ActiveState>> {
    const key = keyOf(project, command.id);
    const existing = entries.get(key);
    if (existing !== undefined && isLive(existing.run.status)) {
      return err({
        code: "conflict",
        message: `command "${command.name}" is already running`,
      });
    }

    const folders = await deps.folders(project);
    if (!folders.ok) return folders;
    if (folders.value.length === 0) {
      return err({
        code: "invalid_input",
        message: "project has no registered folder",
      });
    }
    const base =
      command.folder_ref === undefined
        ? folders.value[0]!
        : folders.value.find((f) => f.folder_ref === command.folder_ref);
    if (base === undefined) {
      return err({
        code: "invalid_input",
        message: "folder_ref is not registered in this project",
      });
    }
    const candidateCwd =
      command.cwd === undefined ? base.path : resolve(base.path, command.cwd);
    const checked = folderOfCwd([base], candidateCwd);
    if (!checked.ok) {
      return err({
        code: "invalid_input",
        message: "cwd resolves outside the registered project folder",
      });
    }

    const reusedTerminal = terminalRefs.get(key);
    const run: ProjectCommandRun = {
      run_id: deps.ids.newId("pcr"),
      project_id: project,
      command_id: command.id,
      status: "starting",
      terminal_id: reusedTerminal ?? null,
      pid: null,
      started_at: deps.clock.now(),
      ended_at: null,
      exit_code: null,
      signal: null,
      detected_urls: [],
      ended_by: null,
    };
    const state: ActiveState = {
      project,
      command,
      run,
      generation: null,
      logs: new CommandLogBuffer(),
      pendingEndedBy: null,
      previewOpened: false,
      cancelTimeout: null,
      cancelPreviewPoll: null,
      waiters: [],
    };
    entries.set(key, state);
    emit(state);

    // 환경변수 조립 순서(spec 3.3.2): PersonEnv(terminals.open) → COLORTERM·FORCE_COLOR → PROJECT_*·COMMAND_* → 정의 env.
    const env: Record<string, string> = {
      COLORTERM: "truecolor",
      FORCE_COLOR: "1",
      PROJECT_ROOT: base.path,
      PROJECT_CWD: checked.path,
      COMMAND_ID: command.id,
      COMMAND_NAME: command.name,
      ...(command.env ?? {}),
    };

    const opened = await deps.terminals.open({
      project,
      folder_ref: base.folder_ref,
      cwd: checked.path,
      exec: command.command,
      env,
      ...(reusedTerminal === undefined ? {} : { terminal_ref: reusedTerminal }),
      dedicated: true,
    });
    if (!opened.ok) {
      state.run = {
        ...state.run,
        status: "failed",
        ended_at: deps.clock.now(),
        ended_by: "process",
      };
      emit(state);
      return opened;
    }

    const runtime = opened.value;
    terminalRefs.set(key, runtime.terminal_ref);
    state.generation = runtime.generation;
    byTerminal.set(runtime.terminal_ref, state);
    deps.terminals.patch(runtime.terminal_ref, { tab_name: command.name });

    if (runtime.state === "exited" || runtime.state === "unknown") {
      state.run = {
        ...state.run,
        terminal_id: runtime.terminal_ref,
        pid: runtime.shell_pid ?? null,
      };
      settle(state, runtime.exit_code, runtime.exit_signal ?? null);
      return ok(state);
    }

    state.run = {
      ...state.run,
      status: "running",
      terminal_id: runtime.terminal_ref,
      pid: runtime.shell_pid ?? null,
    };
    emit(state);

    if (command.kind === "action" && command.timeout_ms !== undefined) {
      state.cancelTimeout = after(command.timeout_ms, () => {
        if (!isLive(state.run.status)) return;
        void stopUnlocked(state, "timeout");
      });
    }
    if (
      command.auto_open_preview === true &&
      command.preview_url !== undefined
    ) {
      startPreviewPoll(state, command.preview_url);
    }

    return ok(state);
  }

  async function stopUnlocked(
    state: ActiveState,
    by: "user" | "agent" | "timeout" | "shutdown",
  ): Promise<ProjectCommandRun> {
    if (!isLive(state.run.status)) return { ...state.run };
    state.pendingEndedBy = by;
    clearTimers(state);
    const terminalId = state.run.terminal_id;
    const generation = state.generation;
    if (terminalId !== null && generation !== null) {
      const closed = await deps.terminals.close(terminalId, generation);
      if (isLive(state.run.status)) {
        const exitCode = closed.ok ? closed.value.exit_code : null;
        const signal = closed.ok ? (closed.value.exit_signal ?? null) : null;
        settle(state, exitCode, signal);
      }
    } else {
      settle(state, null, null);
    }
    return { ...state.run };
  }

  function waitForEnd(state: ActiveState): Promise<ProjectCommandRun> {
    if (!isLive(state.run.status)) return Promise.resolve({ ...state.run });
    return new Promise((resolve) => state.waiters.push(resolve));
  }

  return {
    listRuns(project: string): ProjectCommandRun[] {
      const prefix = `${project}\0`;
      const result: ProjectCommandRun[] = [];
      for (const [key, state] of entries) {
        if (key.startsWith(prefix)) {
          result.push({
            ...state.run,
            detected_urls: [...state.run.detected_urls],
          });
        }
      }
      return result;
    },

    getRun(project: string, commandId: string): ProjectCommandRun | null {
      const state = entries.get(keyOf(project, commandId));
      return state === undefined
        ? null
        : { ...state.run, detected_urls: [...state.run.detected_urls] };
    },

    async start(
      project: Id<"prj">,
      command: ProjectCommand,
      options?: { wait?: boolean; redactLogs?: boolean },
    ): Promise<Result<{ run: ProjectCommandRun; tail?: string }>> {
      const started = await serialize(project, command.id, () =>
        startUnlocked(project, command),
      );
      if (!started.ok) return started;
      const state = started.value;
      if (options?.wait === true && command.kind === "action") {
        const settled = await waitForEnd(state);
        const { lines } = state.logs.read();
        const safe = maskEnvValues(
          lines,
          command.env,
          options.redactLogs ? deps.redact : undefined,
        );
        return ok({ run: settled, tail: safe.join("\n") });
      }
      return ok({ run: { ...state.run } });
    },

    async stop(
      project: Id<"prj">,
      commandId: string,
      by: "user" | "agent" | "shutdown",
    ): Promise<Result<ProjectCommandRun | null>> {
      return ok(
        await serialize(project, commandId, async () => {
          const state = entries.get(keyOf(project, commandId));
          if (state === undefined) return null;
          return await stopUnlocked(state, by);
        }),
      );
    },

    async stopAll(
      project: Id<"prj">,
      by: "user" | "agent" | "shutdown",
    ): Promise<ProjectCommandRun[]> {
      const prefix = `${project}\0`;
      const running: string[] = [];
      for (const [key, state] of entries) {
        if (key.startsWith(prefix) && isLive(state.run.status)) {
          running.push(state.command.id);
        }
      }
      const results = await Promise.all(
        running.map(async (commandId) => {
          const stopped = await this.stop(project, commandId, by);
          return stopped.ok ? stopped.value : null;
        }),
      );
      return results.filter((one): one is ProjectCommandRun => one !== null);
    },

    async restart(
      project: Id<"prj">,
      commandId: string,
      loadLatest: () => Result<ProjectCommand>,
      by: "user" | "agent",
      options?: { wait?: boolean; redactLogs?: boolean },
    ): Promise<Result<{ run: ProjectCommandRun; tail?: string }>> {
      const started = await serialize(project, commandId, async () => {
        const existing = entries.get(keyOf(project, commandId));
        if (existing !== undefined && isLive(existing.run.status)) {
          await stopUnlocked(existing, by);
        }
        const latest = loadLatest();
        if (!latest.ok) return latest;
        return await startUnlocked(project, latest.value);
      });
      if (!started.ok) return started;
      const state = started.value;
      if (options?.wait === true && state.command.kind === "action") {
        const settled = await waitForEnd(state);
        const { lines } = state.logs.read();
        const safe = maskEnvValues(
          lines,
          state.command.env,
          options.redactLogs ? deps.redact : undefined,
        );
        return ok({ run: settled, tail: safe.join("\n") });
      }
      return ok({ run: { ...state.run } });
    },

    logs(
      project: string,
      commandId: string,
      options?: { lines?: number; redact?: boolean },
    ): { run: ProjectCommandRun | null; lines: string[]; truncated: boolean } {
      const state = entries.get(keyOf(project, commandId));
      if (state === undefined) {
        return { run: null, lines: [], truncated: false };
      }
      const read = state.logs.read(options?.lines);
      const safe = maskEnvValues(
        read.lines,
        state.command.env,
        options?.redact ? deps.redact : undefined,
      );
      return {
        run: { ...state.run, detected_urls: [...state.run.detected_urls] },
        lines: safe,
        truncated: read.truncated,
      };
    },

    // 명령이 삭제되면 실행 중이던 것도 멈추고 메모리 기록을 정리한다.
    async forgetCommand(project: Id<"prj">, commandId: string): Promise<void> {
      await serialize(project, commandId, async () => {
        const key = keyOf(project, commandId);
        const state = entries.get(key);
        if (state !== undefined && isLive(state.run.status)) {
          await stopUnlocked(state, "user");
        }
        entries.delete(key);
        terminalRefs.delete(key);
      });
    },

    // core 정상 종료: 도는 모든 명령을 shutdown으로 멈춘다(spec 3.3.2).
    async shutdown(): Promise<void> {
      const live = [...entries.values()].filter((state) =>
        isLive(state.run.status),
      );
      await Promise.all(
        live.map((state) =>
          serialize(state.project, state.command.id, () =>
            stopUnlocked(state, "shutdown"),
          ),
        ),
      );
      offOutput();
      offRuntime();
    },
  };
}
