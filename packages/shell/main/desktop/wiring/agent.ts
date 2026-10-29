// 터미널 안에서 도는 coding agent를 따라가는 길을 앱에 올린다. harness hook의 unix socket, foreground
// process argv와 hook으로 상태를 따라가는 tracker, 못 본 turn 끝·권한 물음의 알림(notice.ts가 어디에 띄울지 정한다)이다.
// socket은 browser bridge의 per-run 폴더에 선다. 어느 단계든 실패하면 hook 없이 뜬다(foreground만 쓴다).
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

import {
  TERMINAL_AGENT_SESSIONS_CHANGED_CHANNEL,
  type TerminalAgentSession,
  type TerminalAgentSessionRename,
  TERMINAL_STATE_CHANNEL,
  type TerminalRuntime,
} from "../../../ipc/terminal.ts";
import {
  HARNESS_ADAPTERS,
  type HarnessId,
  harnessOfProcess,
  hookSignalOf,
} from "../../../../protocol/coding-agent/mod.ts";
import {
  TERMINAL_HOOK_ENV,
  TERMINAL_HOOK_LINE_MAX_BYTES,
  terminalHookLineSchema,
} from "../../../../protocol/coding-agent/terminal-hook.ts";
import { createAgentSessionStore } from "../../terminal/agent/session-store.ts";
import {
  createHookIngress,
  type TerminalHooks,
} from "../../terminal/agent/ingress.ts";
import { listenHooks } from "../../terminal/agent/socket.ts";
import {
  type AgentNotice,
  type AgentTracker,
  createAgentTracker,
} from "../../terminal/agent/tracker.ts";
import type { Supervisor } from "../../terminal/supervisor.ts";
import { writeShellInit } from "../../../terminal-host/shell-integration.ts";
import type { NoticeWiring } from "./notice.ts";
import { excerpt } from "../../notice/excerpt.ts";
import type { ShellContext } from "./context.ts";

export function createAgentWiring(options: {
  ctx: ShellContext;
  notice: Pick<NoticeWiring, "looking" | "show">;
  runDir: Promise<string | null>;
  terminals: Pick<Supervisor, "on" | "runtimes">;
  /** 사람 터미널이 harness를 처음 알아봤다. hook 설치를 물을 때다. */
  identified(harness: string, terminalRef: string): void;
}): {
  hooks: TerminalHooks;
  tracker: AgentTracker;
  /** 사람 터미널의 shell에 끼울 시작 층 폴더. hook이 꺼져 있으면 null. */
  shellInit(): string | null;
  /** 창 모두에 runtime을 push한다. */
  publish(runtime: TerminalRuntime): void;
  /** 그 project에서 저장한 coding agent session. 새것부터다. */
  listSessions(project: string): Promise<TerminalAgentSession[]>;
  /** 탭 이름을 저장한 session에 쓰고 고정한다(null이면 고정을 푼다). 바뀐 목록을 push하고 돌려준다. */
  renameSession(
    input: TerminalAgentSessionRename,
  ): Promise<TerminalAgentSession[]>;
  stop(): void;
} {
  const { ctx, notice, terminals } = options;

  function publish(runtime: TerminalRuntime): void {
    for (const window of ctx.windows) {
      if (!window.isDestroyed()) {
        window.webContents.send(TERMINAL_STATE_CHANNEL, runtime);
      }
    }
  }

  function notify(notice_: AgentNotice): boolean {
    const runtime = terminals
      .runtimes()
      .find((item) => item.terminal_ref === notice_.terminal_ref);
    const label =
      notice_.harness in HARNESS_ADAPTERS
        ? HARNESS_ADAPTERS[notice_.harness as HarnessId].label
        : notice_.harness;
    const place = basename(runtime?.cwd_at_start ?? "");
    return notice.show({
      kind: notice_.kind,
      agent: label,
      place: place === "" ? undefined : place,
      body: excerpt(notice_.body),
      lead: { kind: "harness", harness: notice_.harness },
      target: { kind: "terminal", terminal_ref: notice_.terminal_ref },
    });
  }

  const sessions = createAgentSessionStore({
    dataRoot: ctx.dataRoot,
    now: () => Date.now(),
    resumable: (harness) =>
      harness in HARNESS_ADAPTERS &&
      HARNESS_ADAPTERS[harness as HarnessId].session.resume !== null,
  });

  function pushSessions(project: string, list: TerminalAgentSession[]): void {
    for (const window of ctx.windows) {
      if (!window.isDestroyed()) {
        window.webContents.send(TERMINAL_AGENT_SESSIONS_CHANGED_CHANNEL, {
          project,
          sessions: list,
        });
      }
    }
  }

  const tracker = createAgentTracker({
    harnessOfProcess,
    interruptKeys: (harness) =>
      HARNESS_ADAPTERS[harness as HarnessId].interrupt_keys,
    signalOf: (harness, event, payload) =>
      hookSignalOf(harness as HarnessId, event, payload),
    runtimeOf: (ref) =>
      terminals.runtimes().find((item) => item.terminal_ref === ref),
    publish,
    looking: (ref) => notice.looking({ kind: "terminal", terminal_ref: ref }),
    notify,
    identified: options.identified,
    sessionSeen(info) {
      const runtime = terminals
        .runtimes()
        .find((item) => item.terminal_ref === info.terminal_ref);
      if (runtime === undefined) return;
      void sessions
        .note({
          project: runtime.project,
          folder_ref: runtime.folder_ref,
          cwd: runtime.cwd_at_start,
          harness: info.harness,
          external_session: info.session,
          title: info.title,
          name: info.name,
        })
        .then((list) => pushSessions(runtime.project, list))
        .catch((cause) => ctx.log(`agent session not saved: ${String(cause)}`));
    },
  });

  terminals.on({
    foreground(change) {
      const runtime = terminals
        .runtimes()
        .find((item) => item.terminal_ref === change.terminal_ref);
      if (runtime?.generation !== change.generation) return;
      tracker.foreground(change.terminal_ref, change.argv);
    },
    runtime(runtime) {
      if (runtime.state === "exited" || runtime.state === "unknown") {
        tracker.gone(runtime.terminal_ref);
      }
    },
    hostLost() {
      for (const runtime of terminals.runtimes()) {
        tracker.gone(runtime.terminal_ref);
      }
    },
  });
  ctx.windowHooks.created.push((window) =>
    window.on("focus", () => tracker.windowFocused()),
  );

  // 서기 전과 꺼진 뒤에는 issue()가 null이라 그 터미널은 hook 없이 뜬다.
  let live: ReturnType<typeof createHookIngress> | null = null;
  let shellInit: string | null = null;
  let stopped = false;
  const server = options.runDir.then(async (dir) => {
    if (dir === null || stopped) return null;
    const socket = `${dir}/h.sock`;
    const ingress = createHookIngress({
      socket,
      envName: TERMINAL_HOOK_ENV,
      maxBytes: TERMINAL_HOOK_LINE_MAX_BYTES,
      newKey: () => randomBytes(32).toString("hex"),
      parse(value) {
        const parsed = terminalHookLineSchema.safeParse(value);
        return parsed.success ? parsed.data : null;
      },
      onHook(hook) {
        tracker.hook(hook.terminal_ref, hook.harness, hook.event, hook.payload);
      },
    });
    try {
      const started = await listenHooks({
        socket,
        maxBytes: TERMINAL_HOOK_LINE_MAX_BYTES,
        handleLine: ingress.handleLine,
        log: ctx.log,
      });
      live = ingress;
      // 사람 터미널의 codex·opencode가 shared server가 아니라 이 탭의 env로 hook을 보내게 하는 함수다.
      // 쓰지 못해도 hook은 그대로 쓴다.
      try {
        shellInit = writeShellInit(
          {
            mkdir: (path) => void mkdirSync(path, { recursive: true }),
            write: (path, text) => writeFileSync(path, text, { mode: 0o600 }),
          },
          dir,
        );
      } catch (cause) {
        ctx.log(`shell integration is off: ${String(cause)}`);
      }
      return started;
    } catch (cause) {
      ctx.log(`terminal hooks are off: cannot listen (${String(cause)})`);
      return null;
    }
  });

  const hooks: TerminalHooks = {
    issue: () => (live && !stopped ? live.issue() : null),
    bind: (key, ref) => live?.bind(key, ref),
    revoke: (ref) => live?.revoke(ref),
  };

  return {
    hooks,
    tracker,
    shellInit: () => (live && !stopped ? shellInit : null),
    publish,
    listSessions: (project) => sessions.list(project),
    async renameSession(input) {
      const list = await sessions.rename(input);
      pushSessions(input.project, list);
      return list;
    },
    stop() {
      stopped = true;
      void server.then((started) => started?.stop()).catch(() => {});
    },
  };
}
