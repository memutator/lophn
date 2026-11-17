import { MenuIcon } from "@lophn/ui/overlay";
import { useObservedSize } from "@lophn/ui/shared";
import { t } from "@lophn/i18n";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

import { isGuiHarness } from "../../../protocol/extensions/mod.ts";
import type { TerminalRuntime } from "../../ipc/terminal.ts";
import { useWindowCommands } from "../commands/react.tsx";
import type { Disposable } from "../commands/registry.ts";
import { conversationIcons } from "../icons/mod.ts";
import { useCardHead } from "../parts/card-head/card-head.tsx";
import type { TerminalDeps } from "./deps.ts";
import { ExitBanner } from "./exit-banner.tsx";
import {
  folderTitle,
  type Phase,
  phaseOfReply,
  phaseOfRuntime,
} from "./model.ts";
import type { TerminalEntry } from "./store.ts";
import styles from "./terminal.module.css";
import { type GuiField, guiApi, useGuiToggle } from "./terminal-gui.tsx";
import type { TerminalView } from "./xterm-view.ts";
import { resolvePath } from "./path-links.ts";

interface TerminalTabProps {
  tabKey: string;
  project: string;
  /** layout에 남은 시작 폴더. 복원한 탭이 새 shell을 열 때 쓴다. */
  folderRef: string | null;
  /** focus 칸의 고른 탭이다. 이때만 입력을 보낸다. resize는 보이는 한 칸 크기를 따른다. */
  active: boolean;
  deps: TerminalDeps;
  /** 시작한 폴더를 탭 제목과 layout에 남긴다. */
  onStarted?: (info: { title: string | null; folderRef: string }) => void;
  /**
   * 출력의 파일 경로 link. `exists`가 true인 절대 경로만 link가 되고 Ctrl/Cmd-click하면 `open`이다. 상대 경로는
   * shell을 시작한 폴더 기준이다(shell이 `cd`한 뒤의 폴더는 모른다). 없으면 경로 link가 없다.
   */
  paths?: {
    exists(path: string): Promise<boolean>;
    open(path: string, line: number | undefined): void;
  };
  /**
   * agent나 터미널 제목이 바뀌었다. 탭 이름을 다시 맞출 때다. 이름 규칙은 탭 kind가 하나로 쥐고(`syncTerminalTab`) 이 화면은
   * 때만 알린다: 작업대가 없는 창(detached)의 탭도 이 길로 이름을 따라간다.
   */
  onAgentChange?: () => void;
  /** 이 탭에 GUI handle이 붙어 있다(shared 대화가 TUI view로 와 있다). TUI를 끄지 않고 view만 GUI로 바꾼다. */
  gui?: GuiField | null;
}

const IDLE: Phase = { kind: "idle" };

// 프로젝트 작업대의 터미널 탭. PTY는 host가 갖고 이 화면은 보이고 입력을 넘길
// 뿐이다. 탭을 숨기거나 옮겨도 shell은 그대로이고 다시 그리면 같은 runtime에
// 붙는다.
export function TerminalTab({
  tabKey,
  project,
  folderRef,
  active,
  deps,
  onStarted,
  onAgentChange,
  paths,
  gui = null,
}: TerminalTabProps) {
  const { store, bridge } = deps;
  const subscribe = useCallback(
    (listener: () => void) => store.subscribe(listener),
    [store],
  );
  const entry: TerminalEntry | undefined = useSyncExternalStore(subscribe, () =>
    store.get(tabKey),
  );
  // agent와 제목은 store version이 알린다.
  useSyncExternalStore(subscribe, () => store.version());
  const agent = store.agentOf(tabKey);
  const agentView = JSON.stringify(agent ?? null);
  useEffect(() => {
    onAgentChange?.();
  }, [agentView]);
  const phase = entry?.phase ?? IDLE;

  // GUI로 바꾸는 단추와 ⋯ 메뉴의 "Open as chat". GUI가 붙은 탭이거나, 어댑터가 있는 harness의 CLI라고 알려진 탭(hook만 들은
  // 것도)에 선다. 쓸 수 없으면 disabled에 이유를 달아 누른 뒤에 실패하지 않게 한다. shared 대화의 view 전환 말고는
  // process를 한 번 껐다 켜므로 modal로 묻고, 도는 turn이 있으면 멈춘다고 알린다.
  const guiHarness =
    gui?.harness ??
    (agent !== undefined && isGuiHarness(agent.harness) ? agent.harness : null);
  const unavailable: { reason: string; short: string } | null =
    gui !== null || agent === undefined
      ? null
      : agent.foreground !== true
        ? {
            reason: t("terminal.reason.foreground"),
            short: t("terminal.reason.foreground-short"),
          }
        : agent.session === undefined
          ? {
              reason: t("terminal.reason.session"),
              short: t("terminal.reason.session-short"),
            }
          : null;
  const toggle = useGuiToggle({
    api: guiApi(),
    terminalRef: entry?.terminalRef ?? null,
    to: "gui",
    harness: guiHarness ?? "claude",
    unavailable: unavailable?.reason ?? null,
    confirm: () =>
      gui?.handoff === "shared"
        ? null
        : {
            turn: agent?.state === "running" || agent?.state === "waiting",
            tasks: 0,
          },
  });
  const inCard = useCardHead(
    guiHarness === null
      ? {}
      : {
          actions: toggle.button,
          menu: {
            items: [
              {
                id: "open-chat",
                label: t("terminal.menu.open-chat"),
                leading: <MenuIcon icon={conversationIcons.dock} />,
                ...(unavailable === null
                  ? {}
                  : {
                      disabled: true,
                      shortcut: unavailable.short,
                    }),
              },
            ],
            onSelect: (id) => {
              if (id === "open-chat") toggle.start();
            },
          },
        },
    [guiHarness, unavailable?.reason, toggle.button, toggle.start],
  );
  const hostRef = useRef<HTMLDivElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<TerminalView | null>(null);
  const lastSize = useRef<string>("");
  const size = useObservedSize(screenRef);
  const latestPaths = useRef(paths);
  latestPaths.current = paths;

  // 복사·붙여 넣기는 창 하나의 command(`terminal.copy`·`terminal.paste`)가 부르고, 그 command는 마지막으로
  // focus를 받은 터미널로 간다. 화면 안에 focus가 들어올 때 이 탭이 그 자리를 맡는다(탭이 여럿이어도 하나).
  const commands = useWindowCommands();
  const focusBinding = useRef<Disposable[]>([]);
  const bindFocus = () => {
    if (commands === null) return;
    focusBinding.current = [
      commands.focus.set("terminal.copy", () =>
        viewRef.current?.copySelection(),
      ),
      commands.focus.set("terminal.paste", () => viewRef.current?.paste()),
    ];
  };
  useEffect(
    () => () => {
      for (const one of focusBinding.current) one.dispose();
      focusBinding.current = [];
    },
    [],
  );

  const begin = useCallback(
    (runtime: TerminalRuntime) => {
      lastSize.current = "";
      store.noteRuntime(runtime);
      store.update(tabKey, {
        requested: true,
        terminalRef: runtime.terminal_ref,
        generation: runtime.generation,
        folderRef: runtime.folder_ref,
        phase: phaseOfRuntime(runtime),
      });
      onStarted?.({
        title: folderTitle(runtime.cwd_at_start),
        folderRef: runtime.folder_ref,
      });
    },
    [store, tabKey, onStarted],
  );

  const open = useCallback(
    async (folder: string | null) => {
      if (!bridge) {
        store.update(tabKey, {
          phase: { kind: "refused", reason: "unavailable" },
        });
        return;
      }
      if (!store.beginOpen(tabKey)) return;
      // 다시 열기·실행 명령은 처음 한 번만 보낸다. 다시 시작이 같은 명령을 또 치지 않게 비운다.
      const { resume, command, cwd } = store.get(tabKey) ?? {};
      store.update(tabKey, {
        requested: true,
        folderRef: folder,
        phase: { kind: "opening" },
        resume: undefined,
        command: undefined,
        cwd: undefined,
      });
      try {
        const reply = await bridge.open({
          project,
          ...(folder === null ? {} : { folder_ref: folder }),
          ...(cwd === undefined ? {} : { cwd }),
          ...(resume === undefined ? {} : { resume }),
          ...(command === undefined ? {} : { command }),
        });
        if (!reply.ok) {
          store.update(tabKey, {
            phase: { kind: "refused", reason: "unavailable" },
          });
        } else if (reply.value.ok) {
          begin(reply.value.runtime);
        } else {
          store.update(tabKey, { phase: phaseOfReply(reply.value) });
        }
      } finally {
        store.endOpen(tabKey);
      }
    },
    [bridge, store, tabKey, project, begin],
  );

  // 사람이 누른 다시 시작. 옛 입력을 다시 보내지 않고 새 generation으로 연다.
  const restart = useCallback(async () => {
    const current = store.get(tabKey);
    const ended = current?.phase.kind === "ended" ? current.phase : null;
    if (bridge && current?.terminalRef && ended?.runtime) {
      const reply = await bridge.restart({
        terminal_ref: current.terminalRef,
        generation: current.generation,
      });
      if (!reply.ok) {
        store.update(tabKey, {
          phase: { kind: "refused", reason: "unavailable" },
        });
      } else if (reply.value.ok) {
        begin(reply.value.runtime);
      } else {
        store.update(tabKey, { phase: phaseOfReply(reply.value) });
      }
      return;
    }
    await open(current?.folderRef ?? folderRef);
  }, [bridge, store, tabKey, folderRef, begin, open]);

  // xterm과 출력 구독은 창의 displays가 갖는다. React는 보이는 동안 DOM과 입력만 붙인다.
  useEffect(() => {
    const container = hostRef.current;
    const screen = screenRef.current;
    if (!container || !screen) return;
    const display = deps.displays.acquire(tabKey, project, () => {
      const host = document.createElement("div");
      host.className = styles.screenHost;
      const edge = document.createElement("canvas");
      edge.className = styles.edge;
      edge.setAttribute("aria-hidden", "true");
      container.appendChild(host);
      screen.appendChild(edge);
      return { host, edge, view: deps.createView(host, edge) };
    });
    container.appendChild(display.host);
    screen.appendChild(display.edge);
    const view = display.view;
    viewRef.current = view;
    // Ctrl/Cmd-click한 링크는 main이 browser 탭으로 열지 정한다. 실패해도 아무것도 보이지 않는다.
    const offLink = view.onLink((url) => {
      const terminalRef = store.get(tabKey)?.terminalRef;
      if (!bridge || !terminalRef) return;
      void bridge.openLink({ terminal_ref: terminalRef, url });
    });
    const offPath = view.onPathLink({
      resolve: async (path) => {
        const current = store.get(tabKey)?.phase;
        const cwd =
          current?.kind === "live" || current?.kind === "ended"
            ? current.runtime?.cwd_at_start
            : undefined;
        if (latestPaths.current === undefined || cwd === undefined) return null;
        const absolute = resolvePath(path, cwd);
        return (await latestPaths.current.exists(absolute)) ? absolute : null;
      },
      open: (path, line) => latestPaths.current?.open(path, line),
    });
    return () => {
      offLink();
      offPath();
      display.host.remove();
      display.edge.remove();
      viewRef.current = null;
    };
  }, [deps, store, tabKey, bridge, project]);
  useEffect(() => {
    deps.displays.setActive(tabKey, active);
    return () => deps.displays.setActive(tabKey, false);
  }, [deps, tabKey, active]);

  // 처음 보인 탭만 shell을 연다. 이미 도는 terminal은 displays가 한 번만 snapshot을 받고 구독한다.
  useEffect(() => {
    const current = store.get(tabKey);
    if (current?.terminalRef) return;
    if (current?.requested && current.phase.kind === "opening") {
      void open(current.folderRef ?? folderRef);
    } else if (!current) {
      void open(folderRef);
    }
  }, [tabKey]);

  const liveRuntime = phase.kind === "live" ? phase.runtime : null;
  const liveKey =
    liveRuntime && entry?.terminalRef
      ? `${entry.terminalRef}:${liveRuntime.generation}`
      : null;

  const boundRef = entry?.terminalRef ?? null;
  const boundGeneration = entry?.generation ?? 0;
  // 폰이 PTY 크기를 잡았다. 칸에 맞추지 않고, 사람이 이 탭을 고르거나 누르면 칸 크기로 다시 잡는다(마지막에 잡은 쪽이 이긴다).
  const remote = entry?.remote === true;
  const reclaim = () => {
    if (!remote || !bridge || boundRef === null) return;
    const dims = viewRef.current?.fit();
    if (!dims) return;
    void bridge.resize({
      terminal_ref: boundRef,
      generation: boundGeneration,
      columns: dims.columns,
      rows: dims.rows,
    });
  };

  // 고른 탭일 때만 main의 focus 표에 이 터미널을 적는다. 떠나면 지운다.
  useEffect(() => {
    if (!active || !bridge || boundRef === null || boundGeneration < 1) return;
    const ref = { terminal_ref: boundRef, generation: boundGeneration };
    void bridge.focus({ ...ref, focused: true });
    viewRef.current?.focus();
    reclaim();
    return () => {
      void bridge.focus({ ...ref, focused: false });
    };
  }, [active, bridge, boundRef, boundGeneration]);

  // 표시 영역에 맞춰 PTY 치수를 바꾼다. focus 칸이 아니어도 보이면 따른다. 안 그러면 xterm만 새 폭이고
  // PTY는 옛 폭이라 TUI가 옛 폭으로 그려 잘린다. 다시 붙어 snapshot을 PTY 치수로 쓴 뒤(`restored`)에도 칸에 다시 맞춘다.
  // 폰이 크기를 잡은 동안은 맞추지 않고, 놓으면 같은 치수라도 다시 보낸다.
  const restored = entry?.restored ?? 0;
  useEffect(() => {
    if (!liveKey || !bridge || boundRef === null) return;
    if (remote) {
      lastSize.current = "";
      return;
    }
    const dims = viewRef.current?.fit();
    if (!dims) return;
    const key = `${liveKey}:${dims.columns}x${dims.rows}`;
    if (key === lastSize.current) return;
    lastSize.current = key;
    void bridge.resize({
      terminal_ref: boundRef,
      generation: boundGeneration,
      columns: dims.columns,
      rows: dims.rows,
    });
  }, [
    liveKey,
    bridge,
    boundRef,
    boundGeneration,
    size?.width,
    size?.height,
    restored,
    remote,
  ]);

  const showScreen =
    phase.kind === "live" || (phase.kind === "ended" && phase.runtime !== null);

  // 보일 출력이 있으면 그 아래 한 줄, 없으면 탭 가운데 자리표시다.
  const variant = showScreen ? "bar" : "center";
  let banner = null;
  if (phase.kind === "ended") {
    banner = (
      <ExitBanner
        variant={variant}
        state={{
          kind: "ended",
          ending: phase.ending,
          exitCode: phase.runtime?.exit_code ?? null,
        }}
        onRestart={() => void restart()}
      />
    );
  } else if (phase.kind === "refused") {
    banner = (
      <ExitBanner
        variant={variant}
        state={{ kind: "refused", reason: phase.reason }}
        onRestart={
          phase.reason === "no_folder"
            ? undefined
            : () => void open(entry?.folderRef ?? folderRef)
        }
      />
    );
  }

  return (
    <div
      className={styles.terminal}
      data-terminal-tab={tabKey}
      data-phase={phase.kind}
    >
      {guiHarness === null ? null : toggle.overlays}
      {guiHarness === null || inCard ? null : (
        // card 밖(floated 패널, 떼어 낸 창)에는 머리 줄이 없어 본문 위 모서리에 둔다.
        <div style={{ position: "absolute", top: 4, right: 4, zIndex: 1 }}>
          {toggle.button}
        </div>
      )}
      <div
        ref={screenRef}
        className={styles.screen}
        hidden={!showScreen}
        role="region"
        aria-label={t("terminal.label.output")}
        data-key-context="terminal"
        onFocus={bindFocus}
        onPointerDown={reclaim}
        onKeyDown={reclaim}
      >
        <div ref={hostRef} className={styles.screenHost} />
        {remote && showScreen ? (
          <div className={styles.remoteSize}>
            {t("terminal.notice.sized-for-phone")}
          </div>
        ) : null}
      </div>
      {showScreen || banner ? null : <div className={styles.fill} />}
      {banner}
    </div>
  );
}
