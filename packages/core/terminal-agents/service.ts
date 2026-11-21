// 터미널 coding agent의 core 쪽을 하나로 묶는다: tracker(무엇이 도는지, 상태, 알릴 계기), GUI handle, coding session 목록과 대화,
// 저장한 session, resume으로 연 터미널의 hold. 터미널(`Terminals`)의 foreground·출력·사람 입력·runtime을 듣고, 바뀐 agent를
// `Terminals.patch`로 runtime에 실어 `TerminalRuntimeChanged`가 가게 한다. socket·per-run 폴더·CLI는 wiring이 끼운다.
import { type Clock, err, ok, type Result } from "../../base/mod.ts";
import {
  HARNESS_ADAPTERS,
  type HarnessId,
  harnessOfProcess,
  hookSignalOf,
  launchArgsOfProcess,
  sessionOfProcess,
} from "../../protocol/coding-agent/mod.ts";
import {
  HOME_TERMINAL_PROJECT,
  type TerminalAgentSession,
} from "../../protocol/coding-agent/terminals.ts";
import type { BusEvent } from "../../protocol/events/bus.ts";
import { publishStateChanged } from "../../protocol/events/changes.ts";
import type { AcpTabHandlers } from "../../protocol/extensions/acp-session.ts";
import { terminalSessionId } from "../../protocol/lophn-agent/session-tag.ts";
import type { Terminals } from "../terminals/ports.ts";
import { createCodingSessions } from "./coding-sessions.ts";
import type { CredentialFiles } from "./credential-file.ts";
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
  // GUI 탭의 turn 자격 file. per-run 폴더가 없으면 null이고 그 탭의 CLI는 lophn agent로 부르지 못한다.
  credentials?: CredentialFiles | null;
  ids: { request(): string };
  // 그 터미널에 준 hook env. GUI가 띄운 CLI도 같은 탭으로 hook을 보내게 한다.
  hookEnv(terminalRef: string): Record<string, string>;
  // 사람 터미널에서 foreground로 harness를 처음 알아봤다. hook 설치를 물을 때다.
  identified(harness: string, terminalRef: string): void;
  // resume으로 연 터미널이 쥔 ledger session 전부(`HarnessHold.heartbeat`).
  beat(sessions: readonly string[]): void;
  /** Antigravity conversation summary DB에서 AI 제목을 읽는다. 없거나 비어 있으면 null. */
  readAntigravityTitle?(conversationId: string): string | null;
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
    sessionOfProcess: (harness, argv) =>
      harness in HARNESS_ADAPTERS
        ? sessionOfProcess(harness as HarnessId, argv)
        : null,
    launchArgsOfProcess: (harness, argv) =>
      harness in HARNESS_ADAPTERS
        ? launchArgsOfProcess(harness as HarnessId, argv)
        : [],
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
      if (
        runtime === null ||
        !(
          runtime.project === HOME_TERMINAL_PROJECT ||
          runtime.project.startsWith("prj_")
        )
      ) {
        return;
      }
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
    async lookupSession(info) {
      const runtime = terminals.runtime(info.terminal_ref);
      if (runtime === null) return null;
      const saved = await deps.store.list(runtime.project);
      const found = saved.find(
        (item) =>
          item.harness === info.harness &&
          item.external_session === info.session,
      );
      if (found?.pinned) {
        return { title: found.title, name: found.name, pinned: true };
      }
      const externalName =
        info.harness === "antigravity"
          ? (deps.readAntigravityTitle?.(info.session) ?? null)
          : null;
      if (found === undefined && externalName === null) return null;
      const name = externalName ?? found?.name ?? null;
      return {
        title: found?.title ?? null,
        name,
        pinned: false,
        persist:
          externalName !== null && externalName !== (found?.name ?? null),
      };
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
    // project 터미널의 GUI 탭이 팀원이다(Home과 앱 workspace는 아니다).
    credentialFile: (ref) =>
      deps.credentials != null && project(ref)?.startsWith("prj_") === true
        ? deps.credentials.pathOf(ref)
        : null,
    log: deps.log,
    changed: () => coding.changed(),
    resumingTui: (ref, harness, session) =>
      tracker.expectResume(ref, harness, session),
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
  const guiNotes = new Set<() => void>();
  const offs = [
    terminals.useEnv((input) => ({
      env: {},
      opened(runtime) {
        if (runtime !== null && input.resume !== undefined) {
          tracker.expectResume(
            runtime.terminal_ref,
            input.resume.harness,
            input.resume.external_session,
          );
        }
      },
    })),
    gui.onHandle((handle) => {
      let lastNoted = "";
      const noteFromState = () => {
        const session = handle.state().session;
        const cliSession = session?.cli_session ?? null;
        if (cliSession === null) return;
        const rawTitle = session?.title?.trim() || null;
        const label = adapterOf(handle.harness)?.label;
        const title = rawTitle === label ? null : rawTitle;
        const key = `${cliSession}\0${title ?? ""}`;
        if (key === lastNoted) return;
        lastNoted = key;
        const runtime = terminals.runtime(handle.terminal);
        if (runtime === null) return;
        void deps.store
          .note({
            project: runtime.project,
            folder_ref: runtime.folder_ref,
            cwd: runtime.cwd_at_start,
            harness: handle.harness,
            external_session: cliSession,
            title,
            name: title,
          })
          .then(() => changedSaved(runtime.project))
          .catch((cause) =>
            deps.log(`agent session not saved: ${String(cause)}`),
          );
      };
      let detach: (() => void) | undefined;
      let closed = false;
      detach = handle.attach({
        snapshot: () => noteFromState(),
        update(update) {
          if (
            update.type === "session_changed" ||
            update.type === "session_reset"
          ) {
            noteFromState();
          }
        },
        closed() {
          closed = true;
          if (detach !== undefined) guiNotes.delete(detach);
        },
      });
      if (!closed) guiNotes.add(detach);
    }),
    () => {
      for (const off of guiNotes) off();
      guiNotes.clear();
    },
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
    // 탭에서 친 `<harness> gui`.
    guiRequest(hook: RoutedHook): void {
      void gui.request(hook);
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
        tracker.renameSession(
          input.harness,
          input.external_session,
          input.name,
        );
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
