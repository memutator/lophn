// 터미널 coding agent의 core 쪽을 하나로 묶는다: tracker(무엇이 도는지, 상태, 알릴 계기), GUI handle, coding session 목록과 대화,
// 저장한 session, resume으로 연 터미널의 hold. 터미널(`Terminals`)의 foreground·출력·사람 입력·runtime을 듣고, 바뀐 agent를
// `Terminals.patch`로 runtime에 실어 `TerminalRuntimeChanged`가 가게 한다. socket·per-run 폴더·CLI는 wiring이 끼운다.
import { type Clock, err, ok, type Result } from "../../base/mod.ts";
import {
  HARNESS_ADAPTERS,
  type HarnessId,
  harnessOfProcess,
  hookSignalOf,
} from "../../protocol/coding-agent/mod.ts";
import type { TerminalAgentSession } from "../../protocol/coding-agent/terminals.ts";
import type { BusEvent } from "../../protocol/events/bus.ts";
import { publishStateChanged } from "../../protocol/events/changes.ts";
import type { AcpTabHandlers } from "../../protocol/extensions/acp-session.ts";
import { terminalSessionId } from "../../protocol/lophn-agent/session-tag.ts";
import type { Terminals } from "../terminals/ports.ts";
import { createCodingSessions } from "./coding-sessions.ts";
import { createTabGui, type TabGuiDeps } from "./gui.ts";
import { createTerminalHolds } from "./hold.ts";
import type { RoutedHook } from "./ingress.ts";
import { createTitleScanner } from "./osc-title.ts";
import type { AgentSessionStore } from "./session-store.ts";
import { createAgentTracker } from "./tracker.ts";

const adapterOf = (harness: string) =>
  harness in HARNESS_ADAPTERS ? HARNESS_ADAPTERS[harness as HarnessId] : null;

export type TerminalAgentsDeps = {
  terminals: Terminals;
  clock: Clock;
  after(ms: number, run: () => void): () => void;
  publish(event: BusEvent): void;
  // 못 본 끝과 push를 정하는 attention. 터미널의 계기와 새 turn·끝의 지우기를 받는다.
  attention(): {
    signal(signal: {
      terminal_ref: string;
      harness: string;
      title: string | null;
      kind: "waiting" | "finished" | "failed";
      active_ms: number | null;
    }): void;
    dismiss(session: string): unknown;
  };
  // 켜진 harness-gui의 탭 전환. 꺼져 있으면 null이다.
  handlers(): AcpTabHandlers | null;
  redact<T>(value: T): T | null;
  platform: string;
  store: AgentSessionStore;
  images: TabGuiDeps["images"];
  ids: { request(): string };
  // 그 터미널에 준 hook env. GUI가 띄운 CLI도 같은 탭으로 hook을 보내게 한다.
  hookEnv(terminalRef: string): Record<string, string>;
  // 사람 터미널에서 foreground로 harness를 처음 알아봤다. hook 설치를 물을 때다.
  identified(harness: string, terminalRef: string): void;
  // resume으로 연 터미널이 쥔 ledger session 전부(`HarnessHold.heartbeat`).
  beat(sessions: readonly string[]): void;
  log(message: string): void;
};

export function createTerminalAgents(deps: TerminalAgentsDeps) {
  const { terminals } = deps;
  const now = () => deps.clock.nowMs();
  const project = (ref: string) => terminals.runtime(ref)?.project;
  const changedSaved = (id: string) =>
    publishStateChanged(deps, deps.clock.now(), [
      { name: "terminal_saved_sessions", id },
    ]);

  const tracker = createAgentTracker({
    harnessOfProcess,
    interruptKeys: (harness) => adapterOf(harness)?.interrupt_keys ?? [],
    signalOf: (harness, event, payload) =>
      harness in HARNESS_ADAPTERS
        ? hookSignalOf(harness as HarnessId, event, payload)
        : null,
    runtimeOf: (ref) => terminals.runtime(ref) ?? undefined,
    publish: (runtime) =>
      terminals.patch(runtime.terminal_ref, { agent: runtime.agent ?? null }),
    now,
    after: deps.after,
    notify(notice) {
      const runtime = terminals.runtime(notice.terminal_ref);
      if (runtime === null || !runtime.project.startsWith("prj_")) return;
      deps.publish({
        type: "TerminalAgentSignaled",
        subject: `terminal:${notice.terminal_ref}`,
        at: deps.clock.now(),
        payload: {
          terminal: notice.terminal_ref,
          project: runtime.project,
          harness: notice.harness,
          kind: notice.kind === "permission" ? "waiting" : notice.kind,
          name: runtime.tab_name ?? null,
          body: notice.body ?? null,
        },
      } as BusEvent);
    },
    // 제목은 coding session 목록과 같다: GUI view의 탭은 handle의 제목이 먼저고, 아니면 tracker의 제목·이름이다.
    signal(info) {
      const tab = gui
        .tabSessions()
        .find((item) => item.terminal_ref === info.terminal_ref);
      deps.attention().signal({
        ...info,
        title: (tab?.view === "gui" ? tab.title : null) ?? info.title,
      });
    },
    dismiss: (ref) => void deps.attention().dismiss(terminalSessionId(ref)),
    identified: deps.identified,
    sessionSeen(info) {
      const runtime = terminals.runtime(info.terminal_ref);
      if (runtime === null) return;
      void deps.store
        .note({
          project: runtime.project,
          folder_ref: runtime.folder_ref,
          cwd: runtime.cwd_at_start,
          harness: info.harness,
          external_session: info.session,
          title: info.title,
          name: info.name,
        })
        .then(() => changedSaved(runtime.project))
        .catch((cause) =>
          deps.log(`agent session not saved: ${String(cause)}`),
        );
    },
  });

  const alive = (ref: string) => {
    const runtime = terminals.runtime(ref);
    return runtime === null ||
      runtime.state === "exited" ||
      runtime.state === "unknown"
      ? undefined
      : runtime;
  };
  const written = (done: Result<void>) => {
    if (!done.ok) throw new Error(done.error.message);
  };

  const gui = createTabGui({
    handlers: deps.handlers,
    ids: deps.ids,
    terminals: {
      runtime(ref) {
        const runtime = alive(ref);
        return runtime === undefined
          ? undefined
          : { cwd: runtime.cwd_at_start, generation: runtime.generation };
      },
      hookEnv: deps.hookEnv,
      tui: (ref) => tracker.tuiOf(ref),
      async type(ref, text) {
        written(await terminals.write(ref, text, { human: false }));
      },
      async signal(ref, signal) {
        const runtime = alive(ref);
        if (runtime === undefined) return;
        written(await terminals.signal(ref, runtime.generation, signal));
      },
      onForegroundExit: (ref, listener) =>
        tracker.onForegroundExit(ref, listener),
    },
    images: deps.images,
    log: deps.log,
    changed: () => coding.changed(),
  });

  const coding = createCodingSessions({
    clock: deps.clock,
    terminals,
    gui,
    after: deps.after,
    publish: deps.publish,
    redact: deps.redact,
    platform: deps.platform,
  });

  const holds = createTerminalHolds({
    onForegroundExit: (ref, listener) =>
      tracker.onForegroundExit(ref, listener),
    beat: deps.beat,
  });

  // 제목은 터미널마다 chunk 경계를 넘어 이어 읽는다.
  const titleScanners = new Map<string, (chunk: string) => string | null>();
  const offs = [
    terminals.onOutput((chunks) => {
      for (const chunk of chunks) {
        let scan = titleScanners.get(chunk.terminal_ref);
        if (scan === undefined) {
          scan = createTitleScanner();
          titleScanners.set(chunk.terminal_ref, scan);
        }
        const title = scan(chunk.chunk);
        if (title !== null) tracker.screenTitle(chunk.terminal_ref, title);
      }
    }),
    terminals.onForeground((change) => {
      if (
        terminals.runtime(change.terminal_ref)?.generation !== change.generation
      )
        return;
      tracker.foreground(change.terminal_ref, change.argv);
    }),
    terminals.onHumanInput((ref, text) => tracker.humanInput(ref, text)),
    terminals.onRuntime((runtime) => {
      gui.terminalChanged(runtime);
      if (runtime.state === "exited" || runtime.state === "unknown") {
        titleScanners.delete(runtime.terminal_ref);
        tracker.gone(runtime.terminal_ref);
        holds.release(runtime.terminal_ref);
      }
      coding.changed();
    }),
  ];

  return {
    coding,
    holds,

    // 터미널 hook socket의 줄 하나(`lophn-gui` 밖).
    hook(hook: RoutedHook): void {
      tracker.hook(hook.terminal_ref, hook.harness, hook.event, hook.payload);
    },
    // 탭에서 친 `<harness> gui`. harness-gui가 꺼져 있으면 사람이 켤 수 있게 shell에 알린다.
    guiRequest(hook: RoutedHook): void {
      void gui.request(hook).then((reply) => {
        if (reply?.ok !== false || reply.reason !== "extension_off") return;
        deps.publish({
          type: "TerminalGuiOff",
          subject: `terminal:${hook.terminal_ref}`,
          at: deps.clock.now(),
          payload: { terminal: hook.terminal_ref },
        } as BusEvent);
      });
    },
    // extension이 연 ACP handle(`acpOpened`).
    opened: gui.opened,

    async savedSessions(
      projectRef: string,
    ): Promise<{ sessions: TerminalAgentSession[] }> {
      return { sessions: await deps.store.list(projectRef) };
    },
    async renameSaved(input: {
      project: string;
      harness: string;
      external_session: string;
      name: string | null;
    }): Promise<Result<{ sessions: TerminalAgentSession[] }>> {
      const saved = await deps.store.list(input.project);
      if (
        !saved.some(
          (one) =>
            one.harness === input.harness &&
            one.external_session === input.external_session,
        )
      ) {
        return err({
          code: "not_found",
          message: "no such saved coding agent session in this project",
        });
      }
      try {
        const sessions = await deps.store.rename(input);
        changedSaved(input.project);
        return ok({ sessions });
      } catch (cause) {
        return err({
          code: "unavailable",
          message: `the saved session could not be written: ${String(cause)}`,
        });
      }
    },

    // 앱이 멈춘 터미널 session의 coding agent를 그 harness의 끊기 key로 끊는다. 사람이 같은 key를 친 것과 같아서 tracker가 다음
    // hook까지 상태를 모르게 둔다(안 그러면 목록이 running으로 남는다). key가 없는 harness는 unavailable이다.
    async interrupt(ref: string): Promise<Result<void>> {
      const harness = alive(ref)?.agent?.harness;
      if (harness === undefined || project(ref) === undefined) {
        return err({
          code: "not_found",
          message: "no coding agent runs in that terminal",
        });
      }
      const key = adapterOf(harness)?.interrupt_keys[0];
      if (key === undefined) {
        return err({
          code: "unavailable",
          message: `${harness} has no key that interrupts its turn`,
        });
      }
      const done = await terminals.write(
        ref,
        key === "escape" ? "\x1b" : "\x03",
        { human: true },
      );
      return done.ok ? ok(undefined) : done;
    },

    stop(): void {
      for (const off of offs) off();
      coding.stop();
      gui.stop();
    },
  };
}

export type TerminalAgents = ReturnType<typeof createTerminalAgents>;
