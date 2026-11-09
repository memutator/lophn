// 터미널 탭 안 GUI의 shell main 쪽. Electron도 socket도 모르고 deps로만 일한다(요청 처리와 CLI env 만들기를 test할 수
// 있게 한다). 탭에서 친 `<harness> gui`(hook socket의 `lophn-gui` 줄)를 받아 extension(harness-gui)에 `AcpTerminal`을
// 넘기고, extension이 연 handle을 그 탭을 가진 창에 알려 붙이고, 창의 toggle을 extension에 전한다.
// 어느 process를 끄고 띄우는지(`exitTui`, `run.stop()`, `tuiCommand()`)는 adapter를 쥔 extension이 정하고, 여기는 탭의
// PTY(치기, signal, foreground 떠남)와 tracker가 아는 것(session id, 상태)만 준다.
import {
  HARNESS_GUI_TAB_OPENED_CHANNEL,
  HARNESS_GUI_TAB_UPDATE_CHANNEL,
  HARNESS_GUI_TAB_VIEW_CHANNEL,
  type HarnessGuiHandoff,
  type HarnessGuiInfo,
  type HarnessGuiRewindPreview,
  type HarnessGuiSessionEntry,
  type HarnessGuiTabOpened,
  type HarnessGuiTabToggleReply,
  type HarnessGuiTabCurrent,
  type HarnessGuiTabView,
} from "../../ipc/harness-gui.ts";
import { terminalGuiPayloadSchema } from "../../../protocol/coding-agent/terminal-hook.ts";
import type {
  AcpInput,
  AcpState,
  AcpUpdate,
} from "../../../protocol/acp/mod.ts";
import {
  type AcpTabRequest,
  type AcpTerminal,
  type ExtensionAcp,
  type GuiHarness,
  isGuiHarness,
} from "../../../protocol/extensions/mod.ts";
import { SESSION_MARKER_NAME } from "../../terminal-host/env.ts";
import type { RoutedHook } from "./agent/ingress.ts";

// browser bridge와 같다. 탭을 가진 창이 이 안에 ack하지 않으면 handle을 닫는다.
const ACK_TIMEOUT_MS = 1500;
// 한 handle의 update를 모아 창에 한 번에 보내는 간격. resume 재생처럼 한꺼번에 오는 update가 한 번에 그려지고, 글 delta도
// 프레임 하나에 하나로 줄어든다.
const UPDATE_BATCH_MS = 20;

export type TabHandlers = Parameters<ExtensionAcp["onTab"]>[0];

/** extension이 연 handle의 shell main 쪽 모습. `wiring/extensions.ts`의 `createAcp`가 이것을 채운다. */
export type TabHandle = {
  readonly id: string;
  /** 이 handle이 붙은 탭의 terminal_ref. */
  readonly terminal: string;
  readonly harness: GuiHarness;
  /** adapter의 `handoff`(extension이 `open`에 실었다). */
  readonly handoff: HarnessGuiHandoff;
  readonly cwd: string;
  /** 지금까지 접은 상태를 `snapshot`으로 한 번 주고 이어서 새 update를 보낸다. 돌려받은 함수로 그만 듣는다. 이미 닫혔으면 바로 `closed`다. */
  attach(listener: {
    snapshot(state: AcpState): void;
    update(update: AcpUpdate): void;
    closed(): void;
  }): () => void;
  input(input: AcpInput): void;
  close(): void;
};

/** 창 하나로 보내는 길. */
export type TabSender = {
  readonly id: number;
  send(channel: string, payload: unknown): void;
  alive(): boolean;
};

export type TabGuiDeps = {
  /** extension이 걸어 둔 handlers. 꺼져 있으면 undefined다(켜짐은 이 함수가 맞춘 뒤 본다). */
  handlers(): Promise<TabHandlers | undefined>;
  /** harness-gui가 꺼져 있을 때 띄울 Settings › Extensions. */
  showExtensionSettings(): void;
  /** 모든 창. */
  windows(): readonly { send(channel: string, payload: unknown): void }[];
  ids: { request(): string };
  after(ms: number, run: () => void): () => void;
  terminals: {
    /** 살아 있는 터미널의 runtime. 없거나 끝났으면 undefined. */
    runtime(
      terminalRef: string,
    ): { cwd: string; generation: number } | undefined;
    /** 그 터미널에 준 hook env(`LPN_TERMINAL_HOOK`). */
    hookEnv(terminalRef: string): Record<string, string>;
    /** PTY foreground에서 도는 harness TUI. tracker가 안다. 없으면 shell prompt다. */
    tui(terminalRef: string): {
      harness: string;
      state: "running" | "waiting" | "idle" | "unknown";
      session: string | null;
      cwd: string | null;
    } | null;
    type(terminalRef: string, text: string): Promise<void>;
    signal(terminalRef: string, signal: "SIGINT" | "SIGTERM"): Promise<void>;
    onForegroundExit(terminalRef: string, listener: () => void): () => void;
  };
  /** 사람이 붙인 이미지를 그 터미널의 임시 폴더에 쓰고 절대 경로를 돌려준다. */
  writeImage(
    terminalRef: string,
    image: { name: string; data: Uint8Array },
  ): Promise<string>;
  /** `writeImage`가 그 터미널에 쓴 이미지를 읽는다. 그 폴더 밖이거나 이미지가 아니면 null. */
  readImage(
    terminalRef: string,
    path: string,
  ): Promise<{ mime: string; data: Uint8Array } | null>;
  log(message: string): void;
};

type Tab = {
  handle: TabHandle;
  generation: number;
  /** 창의 ack를 기다리는 request. ack가 오면 null이다. */
  waiting: { request: string; cancel: () => void } | null;
  /** 창 하나(sender id)마다 붙은 listener. */
  attached: Map<number, () => void>;
  /** 마지막으로 창에 알린 view. 저장본에서 다시 만들어진 탭이 `current`로 되찾는다. */
  view: "gui" | "tui";
};

export type TabGui = {
  /** 탭에서 친 `<harness> gui`(hook socket). */
  request(hook: RoutedHook): Promise<void>;
  /** extension이 탭에 묶인 handle을 열었다. 그 탭을 가진 창이 ack하면 GUI view가 된다. */
  opened(handle: TabHandle): void;
  ack(request: string): void;
  /** 그 탭의 GUI가 도는 일. 없으면 null. */
  running(
    terminalRef: string,
  ): Promise<{ turn: boolean; tasks: number } | null>;
  toggle(input: {
    terminal_ref: string;
    to: "gui" | "tui";
  }): Promise<HarnessGuiTabToggleReply>;
  /** handle의 탭에서 도는 CLI의 지난 session. handle이 없거나 못 주면 빈 배열. */
  sessions(handle: string): Promise<HarnessGuiSessionEntry[]>;
  /** handle의 탭에서 그 메시지로 rewind하면 되돌아갈 file. 없으면 null. */
  rewindPreview(
    handle: string,
    message: string,
  ): Promise<HarnessGuiRewindPreview | null>;
  /** 그 터미널에 살아 있는 GUI와 지금 view. 없으면 null. */
  current(terminalRef: string): HarnessGuiTabCurrent | null;
  connect(sender: TabSender, handle: string): HarnessGuiInfo | null;
  disconnect(sender: TabSender, handle: string): void;
  input(handle: string, input: AcpInput): boolean;
  uploadImage(
    handle: string,
    image: { name: string; data: Uint8Array },
  ): Promise<string | null>;
  readImage(
    handle: string,
    path: string,
  ): Promise<{ mime: string; data: Uint8Array } | null>;
  /** 터미널 runtime이 바뀌었다. 끝났거나 restart(새 generation)면 그 터미널의 handle을 닫는다. */
  terminalChanged(runtime: {
    terminal_ref: string;
    generation: number;
    state: string;
  }): void;
  stop(): void;
};

export function createTabGui(deps: TabGuiDeps): TabGui {
  const byTerminal = new Map<string, Tab>();
  const byHandle = new Map<string, Tab>();
  // handle이 아직 없는 사이(extension이 시작하는 중)의 같은 터미널 요청을 하나로 만든다.
  const opening = new Set<string>();

  const broadcast = (channel: string, payload: unknown) => {
    for (const window of deps.windows()) window.send(channel, payload);
  };
  const view = (change: HarnessGuiTabView) => {
    const tab = byTerminal.get(change.terminal_ref);
    if (tab !== undefined) tab.view = change.view;
    broadcast(HARNESS_GUI_TAB_VIEW_CHANNEL, change);
  };

  function terminalOf(
    terminalRef: string,
    harness: GuiHarness,
    cwd: string,
  ): AcpTerminal {
    return {
      id: terminalRef,
      cwd,
      harness,
      env: deps.terminals.hookEnv(terminalRef),
      state: () => deps.terminals.tui(terminalRef)?.state ?? "shell",
      sessionId: () => deps.terminals.tui(terminalRef)?.session ?? null,
      type(text) {
        void deps.terminals
          .type(terminalRef, text)
          .catch((cause) => deps.log(`gui: type failed: ${String(cause)}`));
      },
      signal(signal) {
        void deps.terminals
          .signal(terminalRef, signal)
          .catch((cause) => deps.log(`gui: signal failed: ${String(cause)}`));
      },
      onForegroundExit: (listener) =>
        deps.terminals.onForegroundExit(terminalRef, listener),
    };
  }

  function dropTab(tab: Tab): void {
    tab.waiting?.cancel();
    tab.waiting = null;
    if (byTerminal.get(tab.handle.terminal) === tab) {
      byTerminal.delete(tab.handle.terminal);
    }
    byHandle.delete(tab.handle.id);
    for (const detach of tab.attached.values()) detach();
    tab.attached.clear();
  }

  async function open(
    terminalRef: string,
    harness: GuiHarness,
    cwd: string,
    resume: string | undefined,
  ): Promise<HarnessGuiTabToggleReply> {
    if (byTerminal.has(terminalRef)) {
      view({ terminal_ref: terminalRef, view: "gui" });
      return { ok: true };
    }
    if (opening.has(terminalRef)) return { ok: true };
    opening.add(terminalRef);
    try {
      const handlers = await deps.handlers();
      if (handlers === undefined) {
        deps.showExtensionSettings();
        return { ok: false, reason: "failed", message: "harness-gui is off" };
      }
      const request: AcpTabRequest = {
        terminal: terminalOf(terminalRef, harness, cwd),
        harness,
        ...(resume === undefined ? {} : { resume }),
      };
      await handlers.gui(request);
      return { ok: true };
    } catch (cause) {
      deps.log(`gui: open failed: ${String(cause)}`);
      return { ok: false, reason: "failed", message: String(cause) };
    } finally {
      opening.delete(terminalRef);
    }
  }

  return {
    async request(hook) {
      const runtime = deps.terminals.runtime(hook.terminal_ref);
      const payload = terminalGuiPayloadSchema.safeParse(hook.payload);
      if (
        runtime === undefined ||
        !isGuiHarness(hook.harness) ||
        !payload.success
      ) {
        return;
      }
      await open(
        hook.terminal_ref,
        hook.harness,
        payload.data.cwd,
        payload.data.resume,
      );
    },

    opened(handle) {
      const runtime = deps.terminals.runtime(handle.terminal);
      if (runtime === undefined) {
        handle.close();
        return;
      }
      // 한 터미널에 handle은 하나다.
      const old = byTerminal.get(handle.terminal);
      if (old !== undefined) old.handle.close();
      const request = deps.ids.request();
      const tab: Tab = {
        handle,
        generation: runtime.generation,
        waiting: {
          request,
          // 탭을 가진 창이 없다. handle을 닫아 CLI가 남지 않게 한다.
          cancel: deps.after(ACK_TIMEOUT_MS, () => {
            tab.waiting = null;
            handle.close();
          }),
        },
        attached: new Map(),
        view: "gui",
      };
      byTerminal.set(handle.terminal, tab);
      byHandle.set(handle.id, tab);
      // 닫힘은 어디서 시작했든(extension, 시간 초과, 터미널 끝) 한 곳에서 알린다.
      handle.attach({
        snapshot: () => {},
        update: () => {},
        closed() {
          const mine = byHandle.get(handle.id) === tab;
          dropTab(tab);
          if (mine) {
            view({ terminal_ref: handle.terminal, view: "tui", closed: true });
          }
        },
      });
      const open: HarnessGuiTabOpened = {
        request,
        terminal_ref: handle.terminal,
        handle: handle.id,
        harness: handle.harness,
        handoff: handle.handoff,
      };
      broadcast(HARNESS_GUI_TAB_OPENED_CHANNEL, open);
    },

    ack(request) {
      for (const tab of byHandle.values()) {
        if (tab.waiting?.request === request) {
          tab.waiting.cancel();
          tab.waiting = null;
        }
      }
    },

    async running(terminalRef) {
      if (!byTerminal.has(terminalRef)) return null;
      return (await deps.handlers())?.running(terminalRef) ?? null;
    },

    async sessions(handleId) {
      const tab = byHandle.get(handleId);
      if (tab === undefined) return [];
      return (await deps.handlers())?.sessions(tab.handle.terminal) ?? [];
    },

    async rewindPreview(handleId, message) {
      const tab = byHandle.get(handleId);
      if (tab === undefined) return null;
      return (
        (await (
          await deps.handlers()
        )?.rewindPreview(tab.handle.terminal, message)) ?? null
      );
    },

    async toggle({ terminal_ref: terminalRef, to }) {
      const tab = byTerminal.get(terminalRef);
      if (to === "gui") {
        // shared 대화는 handle이 그대로 있어 view만 바꾼다.
        if (tab !== undefined) {
          view({ terminal_ref: terminalRef, view: "gui" });
          return { ok: true };
        }
        const tui = deps.terminals.tui(terminalRef);
        const runtime = deps.terminals.runtime(terminalRef);
        if (
          tui === null ||
          runtime === undefined ||
          !isGuiHarness(tui.harness)
        ) {
          return {
            ok: false,
            reason: "not_running",
            message: "No supported coding agent is running in this terminal.",
          };
        }
        // TUI가 떠난 뒤에는 tracker가 session id를 잊으므로 지금 읽어 넘긴다.
        if (tui.session === null) {
          return {
            ok: false,
            reason: "no_session",
            message: "The session id is not known yet.",
          };
        }
        return await open(
          terminalRef,
          tui.harness,
          tui.cwd ?? runtime.cwd,
          tui.session,
        );
      }
      if (tab === undefined) {
        view({ terminal_ref: terminalRef, view: "tui", closed: true });
        return { ok: true };
      }
      try {
        const handlers = await deps.handlers();
        await handlers?.tui(terminalRef);
      } catch (cause) {
        deps.log(`gui: toggle to tui failed: ${String(cause)}`);
        return { ok: false, reason: "failed", message: String(cause) };
      }
      // restart는 extension이 handle을 닫아 위 관찰이 view를 바꿨다. shared는 handle이 남아 있어 view만 바꾼다.
      if (byTerminal.get(terminalRef) === tab) {
        view({ terminal_ref: terminalRef, view: "tui" });
      }
      return { ok: true };
    },

    current(terminalRef) {
      const tab = byTerminal.get(terminalRef);
      return tab === undefined
        ? null
        : {
            handle: tab.handle.id,
            harness: tab.handle.harness,
            handoff: tab.handle.handoff,
            view: tab.view,
          };
    },

    connect(sender, handleId) {
      const tab = byHandle.get(handleId);
      if (tab === undefined) return null;
      // 다시 로드된 창은 snapshot부터 다시 받는다.
      tab.attached.get(sender.id)?.();
      // snapshot은 붙는 즉시 따로 보내고, 이어지는 update는 모아 한 message로 보낸다. 그래서 snapshot이 늘 먼저 닿는다.
      let pending: AcpUpdate[] = [];
      let cancelFlush: (() => void) | null = null;
      const flush = () => {
        cancelFlush = null;
        const updates = pending;
        pending = [];
        if (sender.alive()) {
          sender.send(HARNESS_GUI_TAB_UPDATE_CHANNEL, {
            handle: handleId,
            updates,
          });
        } else {
          tab.attached.get(sender.id)?.();
          tab.attached.delete(sender.id);
        }
      };
      const stop = tab.handle.attach({
        snapshot(snapshot) {
          if (!sender.alive()) return;
          sender.send(HARNESS_GUI_TAB_UPDATE_CHANNEL, {
            handle: handleId,
            snapshot,
            updates: [],
          });
        },
        update(update) {
          pending.push(update);
          cancelFlush ??= deps.after(UPDATE_BATCH_MS, flush);
        },
        closed: () => {},
      });
      tab.attached.set(sender.id, () => {
        stop();
        cancelFlush?.();
        cancelFlush = null;
        pending = [];
      });
      return { harness: tab.handle.harness, cwd: tab.handle.cwd };
    },

    disconnect(sender, handleId) {
      const tab = byHandle.get(handleId);
      tab?.attached.get(sender.id)?.();
      tab?.attached.delete(sender.id);
    },

    input(handleId, input) {
      const tab = byHandle.get(handleId);
      if (tab === undefined) return false;
      tab.handle.input(input);
      return true;
    },

    async uploadImage(handleId, image) {
      const tab = byHandle.get(handleId);
      if (tab === undefined) return null;
      return await deps.writeImage(tab.handle.terminal, image);
    },

    async readImage(handleId, path) {
      const tab = byHandle.get(handleId);
      if (tab === undefined) return null;
      return await deps.readImage(tab.handle.terminal, path);
    },

    terminalChanged(runtime) {
      const tab = byTerminal.get(runtime.terminal_ref);
      if (tab === undefined) return;
      if (
        runtime.state === "exited" ||
        runtime.state === "unknown" ||
        runtime.generation !== tab.generation
      ) {
        tab.handle.close();
      }
    },

    stop() {
      for (const tab of [...byHandle.values()]) tab.handle.close();
    },
  };
}

/**
 * GUI가 띄우는 CLI(Agent SDK, `codex app-server`, `opencode serve`, `omp --mode rpc-ui`)의 env.
 * `given`은 extension이 login shell env < 탭의 hook env < adapter가 바꾸는 칸 순서로 합친 값이다.
 * 마지막에 상위 session 표지(lophn이 Claude Code 안에서 떴을 때 물려받은 `CLAUDECODE` 등)를 지운다: 안 지우면 CLI가
 * 중첩 session이라며 시작하지 않거나 대화를 저장하지 않는다. API key 같은 사용자 설정은 지우지 않는다.
 */
export function cliEnv(input: {
  base: Readonly<Record<string, string | undefined>>;
  dataRoot: string;
  given?: Readonly<Record<string, string>>;
}): Record<string, string> {
  const merged = {
    ...input.base,
    // 띄운 process의 `lophn`이 이 shell의 core에 닿게 data root를 늘 넣는다(`--home`만으로 띄우면 env에 없다).
    LOPHN_HOME: input.dataRoot,
    ...input.given,
  };
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(merged)) {
    if (value === undefined || SESSION_MARKER_NAME.has(name)) continue;
    out[name] = value;
  }
  return out;
}
