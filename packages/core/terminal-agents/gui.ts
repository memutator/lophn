// 터미널 탭 안 GUI(harness-gui)의 core 쪽. 탭에서 친 `<harness> gui`(hook socket의 `lophn-gui` 줄)와 coding session의 view 바꾸기를
// 받아 extension(harness-gui)에 `AcpTerminal`을 넘기고, extension이 연 handle을 터미널마다 하나 쥔다. handle은 창과 상관없이 core에
// 있다: 화면(desktop, 폰)은 `acp/snapshot`·`AcpUpdated`로 붙는다. 어느 process를 끄고 띄우는지(`exitTui`, `run.stop()`,
// `tuiCommand()`)는 adapter를 쥔 extension이 정하고, 여기는 터미널의 PTY(치기, signal, foreground 떠남)와 tracker가 아는 것
// (session id, 상태)만 준다.
import { isAbsolute, join, relative, sep } from "node:path";
import {
  type AcpInput,
  type AcpState,
  type AcpUpdate,
  toolBodyOf,
  updateWithoutToolBodies,
  withoutToolBodies,
} from "../../protocol/acp/mod.ts";
import { terminalGuiPayloadSchema } from "../../protocol/coding-agent/terminal-hook.ts";
import {
  type AcpCliSession,
  type AcpRewindPreview,
  type AcpTabHandlers,
  type AcpTabRequest,
  type AcpTerminal,
  type GuiHarness,
  isGuiHarness,
} from "../../protocol/extensions/acp-session.ts";
import {
  SESSION_ENV_NAME,
  terminalSessionId,
} from "../../protocol/lophn-agent/session-tag.ts";
import type { AcpHandle } from "../extensions/acp.ts";
import type { RoutedHook } from "./ingress.ts";

// 한 handle의 update를 모아 한 번에 내는 간격. resume 재생처럼 한꺼번에 오는 update가 한 번에 그려지고, 글 delta도 프레임 하나에
// 하나로 줄어든다.
const UPDATE_BATCH_MS = 20;

export type TabHandle = AcpHandle;

/** view 바꾸기가 막혔거나 실패한 까닭. `coding_sessions/switch`의 `details.reason`이다. */
export type ToggleReply =
  | { ok: true }
  | {
      ok: false;
      reason: "no_session" | "not_running" | "failed";
      message: string;
    };

export type TabGuiDeps = {
  /** harness-gui가 건 handlers. 아직 준비되지 않았으면 null이다. */
  handlers(): AcpTabHandlers | null;
  ids: { request(): string };
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
      skipPermissions?: boolean;
    } | null;
    type(terminalRef: string, text: string): Promise<void>;
    signal(terminalRef: string, signal: "SIGINT" | "SIGTERM"): Promise<void>;
    onForegroundExit(terminalRef: string, listener: () => void): () => void;
  };
  /**
   * 사람이 붙인 그림을 쓰는 곳. 터미널마다 `<root>/<terminal_ref>/` 폴더 하나다(`<os tmp>/lophn-gui`. 터미널을 닫아도 OS가 비운다).
   * `write`는 없는 폴더를 0700으로 만들고 file을 0600으로 쓴다. `read`는 못 읽으면 null이다.
   */
  images: {
    readonly root: string;
    write(path: string, data: Uint8Array): Promise<void>;
    read(path: string): Promise<Uint8Array | null>;
  };
  log(message: string): void;
  /** handle이 열리거나 닫히거나, view나 그 session의 상태(title, turn phase)가 바뀌었다. coding session 목록을 다시 만든다. */
  changed?(): void;
  /** restart adapter가 GUI → TUI로 돌아가며 그 session id로 TUI를 다시 띄운다. */
  resumingTui?(terminalRef: string, harness: GuiHarness, session: string): void;
};

type Tab = {
  handle: TabHandle;
  generation: number;
  /** 지금 view. shared 대화는 handle이 남은 채 TUI로 돌아갈 수 있다. */
  view: "gui" | "tui";
  /** adapter가 실패한 turn으로 보인 마지막 오류. view 바꾸기가 시작하지 못했을 때 답에 싣는다. */
  failure: string | null;
};

/** GUI 탭의 CLI session. 상태는 ACP 상태에서 읽는다: 도는 turn은 running, 사람이 답할 것이 있으면 waiting. */
export type GuiTabSession = {
  terminal_ref: string;
  harness: GuiHarness;
  view: "gui" | "tui";
  handoff: "restart" | "shared";
  title: string | null;
  cli_session: string | null;
  state: "running" | "waiting" | "idle" | "unknown";
};

// ACP update 중 title, cli session, turn phase가 바뀌는 것. 글 조각 같은 잦은 update는 목록을 다시 만들지 않는다.
const SESSION_CHANGING: ReadonlySet<string> = new Set([
  "turn_started",
  "turn_resumed",
  "turn_ended",
  "approval_opened",
  "approval_closed",
  "question_asked",
  "question_resolved",
  "session_changed",
  "session_reset",
]);

export type TabGui = {
  /** 탭에서 친 `<harness> gui`(hook socket). 무시한 요청이면 null이다. */
  request(hook: RoutedHook): Promise<ToggleReply | null>;
  /** extension이 탭에 묶인 handle을 열었다. 그 터미널의 view는 GUI가 된다. */
  opened(handle: TabHandle): void;
  /** handle이 열릴 때마다 부른다. 이미 열린 handle도 바로 한 번씩 받는다. 닫힘은 `handle.attach`의 `closed`로 안다. */
  onHandle(listener: (handle: TabHandle) => void): () => void;
  /** 그 탭의 GUI가 도는 일. 없으면 null. */
  running(terminalRef: string): { turn: boolean; tasks: number } | null;
  toggle(input: {
    terminal_ref: string;
    to: "gui" | "tui";
  }): Promise<ToggleReply>;
  /** 그 터미널에서 도는 CLI의 지난 session. handle이 없거나 못 주면 빈 배열. */
  sessions(terminalRef: string): Promise<AcpCliSession[]>;
  /** 그 터미널에서 그 메시지로 rewind하면 되돌아갈 file. 없으면 null. */
  rewindPreview(
    terminalRef: string,
    message: string,
  ): Promise<AcpRewindPreview | null>;
  /** 그 터미널에 살아 있는 GUI와 지금 view. 없으면 null. */
  current(terminalRef: string): {
    handle: TabHandle;
    view: "gui" | "tui";
  } | null;
  /** 살아 있는 GUI 탭마다 CLI session의 모습. tracker는 foreground TUI와 hook으로만 알아 GUI가 띄운 CLI를 모를 수 있다. */
  tabSessions(): GuiTabSession[];
  input(terminalRef: string, input: AcpInput): boolean;
  /** 그 터미널 handle의 tool 본문 한 쪽(내는 상태에는 본문이 없다). handle이나 그 본문이 없으면 null. */
  toolBody(
    terminalRef: string,
    toolCall: string,
    part: "input" | "output",
  ): { value: string; truncated: boolean } | null;
  /** 그림을 그 탭의 임시 폴더에 쓰고 절대 경로를 준다. handle이 없거나 PNG·JPEG·GIF·WebP가 아니면 null. */
  uploadImage(
    terminalRef: string,
    image: { name: string; data: Uint8Array },
  ): Promise<string | null>;
  /** 그 탭의 임시 폴더 바로 아래 그림. 그 밖이거나 그림이 아니면 null. */
  readImage(
    terminalRef: string,
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

// 붙이기가 받는 형식만 bytes로 가린다. 이름(확장자)은 창이나 폰이 준 글이라 믿지 않는다.
function imageKind(bytes: Uint8Array): "png" | "jpeg" | "gif" | "webp" | null {
  const at = (...head: number[]) => head.every((byte, i) => bytes[i] === byte);
  if (at(0x89, 0x50, 0x4e, 0x47)) return "png";
  if (at(0xff, 0xd8, 0xff)) return "jpeg";
  if (at(0x47, 0x49, 0x46, 0x38)) return "gif";
  if (at(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57) return "webp";
  return null;
}
// 화면은 이 확장자의 `file://` link만 그림으로 다시 읽는다(`message-attachments.tsx`).
const IMAGE_FILE = /\.(png|jpe?g|gif|webp)$/i;

export function createTabGui(deps: TabGuiDeps): TabGui {
  const imageDir = (terminalRef: string) => join(deps.images.root, terminalRef);

  // CLI는 file 경로로 그림을 읽는다. 이름은 받은 글이라 경로로 쓸 수 있는 글자만 남기고 앞에 유일한 id를 붙인다.
  async function writeImage(
    terminalRef: string,
    image: { name: string; data: Uint8Array },
  ): Promise<string | null> {
    const kind = imageKind(image.data);
    if (kind === null) return null;
    const base = image.name.replace(/[^A-Za-z0-9._-]/g, "_").slice(-100);
    const name = IMAGE_FILE.test(base) ? base : `${base}.${kind}`;
    const path = join(imageDir(terminalRef), `${deps.ids.request()}-${name}`);
    try {
      await deps.images.write(path, image.data);
      return path;
    } catch (cause) {
      deps.log(`gui: image write failed: ${String(cause)}`);
      return null;
    }
  }

  // 대화에 실린 경로는 받은 글이라 그 탭의 임시 폴더 바로 아래 file만 읽는다.
  async function readImage(
    terminalRef: string,
    path: string,
  ): Promise<{ mime: string; data: Uint8Array } | null> {
    const rest = relative(imageDir(terminalRef), path);
    if (
      rest === "" ||
      rest.startsWith("..") ||
      rest.includes(sep) ||
      isAbsolute(rest)
    ) {
      return null;
    }
    const data = await deps.images.read(path);
    const kind = data === null ? null : imageKind(data);
    return data === null || kind === null
      ? null
      : { mime: `image/${kind}`, data };
  }

  const byTerminal = new Map<string, Tab>();
  // handle이 아직 없는 사이(extension이 시작하는 중)의 같은 터미널 요청을 하나로 만든다.
  const opening = new Set<string>();
  const handleListeners = new Set<(handle: TabHandle) => void>();

  const setView = (terminalRef: string, view: "gui" | "tui") => {
    const tab = byTerminal.get(terminalRef);
    if (tab === undefined || tab.view === view) return;
    tab.view = view;
    deps.changed?.();
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
      // hook 표지와 session 표지: GUI가 띄운 CLI는 탭의 shell 아래가 아니라 core 아래라 앱이 shell_pid로 찾을 수 없다.
      env: {
        ...deps.terminals.hookEnv(terminalRef),
        [SESSION_ENV_NAME]: terminalSessionId(terminalRef),
      },
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
      writeImage: (image) => writeImage(terminalRef, image),
    };
  }

  // `checkStarted`면 view 바꾸기다: extension은 TUI를 먼저 끄고 adapter를 시작한다. 어느 쪽이 실패해도 handle은 실패한 turn을
  // 보이며 남는데, 그대로 두면 바꾸기를 부른 화면은 성공으로 안다. run이 없으면 handle을 닫아 탭을 TUI(끄지 못했으면 그 TUI
  // 그대로)로 두고 failed로 답한다. 탭에서 친 `<harness> gui`는 그 터미널에 실패한 turn이 보이므로 기다리지 않는다.
  async function open(
    terminalRef: string,
    harness: GuiHarness,
    cwd: string,
    resume: string | undefined,
    checkStarted: boolean,
    skipPermissions?: boolean,
  ): Promise<ToggleReply> {
    if (byTerminal.has(terminalRef)) {
      setView(terminalRef, "gui");
      return { ok: true };
    }
    if (opening.has(terminalRef)) return { ok: true };
    opening.add(terminalRef);
    try {
      const handlers = deps.handlers();
      if (handlers === null) {
        return {
          ok: false,
          reason: "failed",
          message: "Chat view is not ready yet.",
        };
      }
      const request: AcpTabRequest = {
        terminal: terminalOf(terminalRef, harness, cwd),
        harness,
        ...(resume === undefined ? {} : { resume }),
        ...(skipPermissions === undefined ? {} : { skipPermissions }),
      };
      await handlers.gui(request);
      if (!checkStarted || handlers.running(terminalRef) !== null) {
        return { ok: true };
      }
      const tab = byTerminal.get(terminalRef);
      tab?.handle.close();
      return {
        ok: false,
        reason: "failed",
        message: tab?.failure ?? "The coding agent did not start in chat view.",
      };
    } catch (cause) {
      deps.log(`gui: open failed: ${String(cause)}`);
      return { ok: false, reason: "failed", message: String(cause) };
    } finally {
      opening.delete(terminalRef);
    }
  }

  const handlerOf = (terminalRef: string) =>
    byTerminal.has(terminalRef) ? deps.handlers() : null;

  return {
    async request(hook) {
      const runtime = deps.terminals.runtime(hook.terminal_ref);
      const payload = terminalGuiPayloadSchema.safeParse(hook.payload);
      if (
        runtime === undefined ||
        !isGuiHarness(hook.harness) ||
        !payload.success
      ) {
        return null;
      }
      return open(
        hook.terminal_ref,
        hook.harness,
        payload.data.cwd,
        payload.data.resume,
        false,
      );
    },

    opened(handle) {
      const runtime = deps.terminals.runtime(handle.terminal);
      if (runtime === undefined) {
        handle.close();
        return;
      }
      // 한 터미널에 handle은 하나다.
      byTerminal.get(handle.terminal)?.handle.close();
      const tab: Tab = {
        handle,
        generation: runtime.generation,
        view: "gui",
        failure: null,
      };
      byTerminal.set(handle.terminal, tab);
      deps.changed?.();
      // 닫힘은 어디서 시작했든(extension, 터미널 끝) 한 곳에서 알린다.
      handle.attach({
        snapshot: () => {},
        update: (update) => {
          if (update.type === "turn_ended" && update.error !== null) {
            tab.failure = update.error.message;
          }
          if (SESSION_CHANGING.has(update.type)) deps.changed?.();
        },
        closed() {
          if (byTerminal.get(handle.terminal) === tab) {
            byTerminal.delete(handle.terminal);
          }
          deps.changed?.();
        },
      });
      for (const listener of handleListeners) listener(handle);
    },

    onHandle(listener) {
      handleListeners.add(listener);
      for (const tab of byTerminal.values()) listener(tab.handle);
      return () => void handleListeners.delete(listener);
    },

    running: (terminalRef) =>
      handlerOf(terminalRef)?.running(terminalRef) ?? null,

    sessions: async (terminalRef) =>
      (await handlerOf(terminalRef)?.sessions(terminalRef)) ?? [],

    rewindPreview: async (terminalRef, message) =>
      (await handlerOf(terminalRef)?.rewindPreview(terminalRef, message)) ??
      null,

    async toggle({ terminal_ref: terminalRef, to }) {
      const tab = byTerminal.get(terminalRef);
      if (to === "gui") {
        // shared 대화는 handle이 그대로 있어 view만 바꾼다.
        if (tab !== undefined) {
          setView(terminalRef, "gui");
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
          true,
          tui.skipPermissions,
        );
      }
      if (tab === undefined) return { ok: true };
      const prevSession = tab.handle.state().session?.cli_session ?? null;
      const prevHarness = tab.handle.harness;
      const isRestart = tab.handle.handoff === "restart";
      try {
        await deps.handlers()?.tui(terminalRef);
      } catch (cause) {
        deps.log(`gui: toggle to tui failed: ${String(cause)}`);
        return { ok: false, reason: "failed", message: String(cause) };
      }
      // restart는 extension이 handle을 닫았다. shared는 handle이 남아 있어 view만 바꾼다.
      if (byTerminal.get(terminalRef) === tab) setView(terminalRef, "tui");
      else if (isRestart && prevSession !== null) {
        deps.resumingTui?.(terminalRef, prevHarness, prevSession);
      }
      return { ok: true };
    },

    current(terminalRef) {
      const tab = byTerminal.get(terminalRef);
      return tab === undefined ? null : { handle: tab.handle, view: tab.view };
    },

    tabSessions() {
      return [...byTerminal.values()].map((tab) => {
        const state = tab.handle.state();
        const phase = state.turn?.phase;
        return {
          terminal_ref: tab.handle.terminal,
          harness: tab.handle.harness,
          view: tab.view,
          handoff: tab.handle.handoff,
          title: state.session?.title ?? null,
          cli_session: state.session?.cli_session ?? null,
          state:
            phase === "working"
              ? "running"
              : phase === "waiting"
                ? "waiting"
                : state.session === null && state.turn === null
                  ? "unknown"
                  : "idle",
        };
      });
    },

    input(terminalRef, input) {
      const tab = byTerminal.get(terminalRef);
      if (tab === undefined) return false;
      tab.handle.input(input);
      return true;
    },

    toolBody(terminalRef, toolCall, part) {
      const tab = byTerminal.get(terminalRef);
      const body =
        tab === undefined ? null : toolBodyOf(tab.handle.state(), toolCall);
      const value = body?.[part] ?? null;
      return body === null || value === null
        ? null
        : { value, truncated: body.truncated };
    },

    async uploadImage(terminalRef, image) {
      if (!byTerminal.has(terminalRef)) return null;
      return await writeImage(terminalRef, image);
    },

    async readImage(terminalRef, path) {
      if (!byTerminal.has(terminalRef)) return null;
      return await readImage(terminalRef, path);
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
      for (const tab of [...byTerminal.values()]) tab.handle.close();
    },
  };
}

/**
 * handle에 붙어 snapshot은 붙는 즉시 따로 넘기고, 이어지는 update는 `UPDATE_BATCH_MS` 동안 모아 배열 하나로 넘긴다. 그래서
 * snapshot이 늘 먼저 닿는다. 닫히면 모으던 update는 버린다. tool 본문은 빼고 넘긴다: 긴 대화의 snapshot은 대부분이 본문이고,
 * 화면은 줄을 펼칠 때 `toolBody`로 그 하나만 읽는다.
 */
export function attachBatched(
  handle: TabHandle,
  after: (ms: number, run: () => void) => () => void,
  sink: {
    snapshot(state: AcpState): void;
    updates(updates: AcpUpdate[]): void;
    closed(): void;
  },
): () => void {
  let pending: AcpUpdate[] = [];
  let cancelFlush: (() => void) | null = null;
  const drop = () => {
    cancelFlush?.();
    cancelFlush = null;
    pending = [];
  };
  const flush = () => {
    cancelFlush = null;
    const updates = pending;
    pending = [];
    sink.updates(updates);
  };
  const stop = handle.attach({
    snapshot: (state) => sink.snapshot(withoutToolBodies(state)),
    update(update) {
      pending.push(updateWithoutToolBodies(update));
      cancelFlush ??= after(UPDATE_BATCH_MS, flush);
    },
    closed() {
      drop();
      sink.closed();
    },
  });
  return () => {
    stop();
    drop();
  };
}
