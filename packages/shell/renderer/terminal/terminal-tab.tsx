import { MenuIcon, Toast } from "@lophn/ui/overlay";
import { useObservedSize } from "@lophn/ui/shared";
import { t } from "@lophn/i18n";
import {
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type { TerminalRuntime } from "../../../protocol/coding-agent/terminals.ts";
import { isGuiHarness } from "../../../protocol/acp/mod.ts";
import { terminalSessionId } from "../../../protocol/lophn-agent/session-tag.ts";
import { STAY } from "../app-frame/annotate/use-view-toast.ts";
import { useReportVisible } from "../conversation/report-visible.ts";
import { useScopeMachineItem } from "../desktop/machines/context.tsx";
import { useWindowCommands } from "../commands/react.tsx";
import type { Disposable } from "../commands/registry.ts";
import { conversationIcons } from "../icons/mod.ts";
import { useCardHead } from "../parts/card-head/card-head.tsx";
import type { TerminalDeps } from "./deps.ts";
import { MachineTag } from "../shell/left-sidebar.tsx";
import { ExitBanner } from "./exit-banner.tsx";
import {
  endingOf,
  folderTitle,
  type Phase,
  phaseOfRefusal,
  phaseOfRuntime,
} from "./model.ts";
import type { TerminalEntry } from "./store.ts";
import styles from "./terminal.module.css";
import { blockedReason, useGuiToggle } from "./terminal-gui.tsx";
import type { TerminalView } from "./xterm-view.ts";
import { resolvePath } from "./path-links.ts";

interface TerminalTabProps {
  tabKey: string;
  project: string;
  /** 탭에 남은 시작 폴더. 새 shell을 열 때 쓴다. */
  folderRef: string | null;
  /** 탭에 남은 터미널 참조. core에 이미 살아 있는 터미널에 붙을 때 쓴다. */
  attach: string | null;
  /** focus 칸의 고른 탭이다. 이때만 입력을 보낸다. resize는 보이는 한 칸 크기를 따른다. */
  active: boolean;
  deps: TerminalDeps;
  /** 시작한 폴더와 터미널 참조를 탭 제목과 탭 값에 남긴다. */
  onStarted?: (info: {
    title: string | null;
    folderRef: string;
    terminalRef: string;
  }) => void;
  /** Ctrl/Cmd-click한 link를 이 터미널 옆 browser 탭으로 연다(사람의 설정이 browser 탭일 때). */
  openLinkTab?: (url: string) => void;
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
}

const IDLE: Phase = { kind: "idle" };
const PASTE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
let ctrlVHintShown = false;

type ImageMediaType = "image/png" | "image/jpeg" | "image/webp";

function imageMediaTypeOf(file: File): ImageMediaType | null {
  if (
    file.type === "image/png" ||
    file.type === "image/jpeg" ||
    file.type === "image/webp"
  ) {
    return file.type;
  }
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  return null;
}

function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function shellQuotePath(path: string): string {
  if (/^[A-Za-z0-9._/@:+-]+$/.test(path)) return path;
  return `'${path.replaceAll("'", "'\\''")}'`;
}

function isMacPlatform(): boolean {
  if (typeof navigator !== "object") return false;
  return /Mac/i.test(navigator.platform || navigator.userAgent);
}

// 프로젝트 작업대의 터미널 탭. PTY는 core가 갖고 이 화면은 보이고 입력을 넘길
// 뿐이다. 탭을 숨기거나 옮겨도, 앱을 꺼도 shell은 그대로이고 다시 그리면 같은 터미널에
// 붙는다.
export function TerminalTab({
  tabKey,
  project,
  folderRef,
  attach,
  active,
  deps,
  onStarted,
  onAgentChange,
  openLinkTab,
  paths,
}: TerminalTabProps) {
  const { store, bridge, core } = deps;
  // 다른 기계의 터미널이면 그 기계(꼬리표, 입력 거절 toast의 이름)다.
  const machine = useScopeMachineItem();
  const copy = deps.screenCopy === true;
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

  // GUI로 바꾸는 단추와 ⋯ 메뉴의 "Open as chat". GUI가 되는 harness의 coding session(hook만 들은 것도)인 탭에 선다. 쓸 수
  // 없으면 disabled에 core가 준 이유를 달아 누른 뒤에 실패하지 않게 한다. 무엇이 멈추는지는 core에 물어 modal로 보인다.
  const coding = store.codingOf(tabKey);
  const guiHarness =
    coding !== undefined && isGuiHarness(coding.harness)
      ? coding.harness
      : null;
  const unavailable = blockedReason(coding?.switch?.blocked ?? null);
  const toggle = useGuiToggle({
    core: deps.core,
    session: coding?.session ?? null,
    handoff: coding?.handoff ?? null,
    to: "gui",
    harness: guiHarness ?? "claude",
    unavailable: unavailable?.reason ?? null,
  });
  const machineTag =
    machine === null ? null : <MachineTag name={machine.name} />;
  const inCard = useCardHead(
    guiHarness === null
      ? { actions: machineTag }
      : {
          actions: (
            <>
              {machineTag}
              {toggle.button}
            </>
          ),
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
    [
      guiHarness,
      unavailable?.reason,
      toggle.button,
      toggle.start,
      machine?.id,
      machine?.name,
    ],
  );
  const hostRef = useRef<HTMLDivElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<TerminalView | null>(null);
  const lastSize = useRef<string>("");
  const size = useObservedSize(screenRef);
  const latestPaths = useRef(paths);
  latestPaths.current = paths;
  const latestLinkTab = useRef(openLinkTab);
  latestLinkTab.current = openLinkTab;
  const [infoToast, setInfoToast] = useState<{
    id: number;
    text: string;
    duration: "brief" | "default";
  } | null>(null);
  const toastSerial = useRef(0);
  const showToast = useCallback(
    (text: string, duration: "brief" | "default" = "brief") => {
      toastSerial.current += 1;
      setInfoToast({ id: toastSerial.current, text, duration });
    },
    [],
  );

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
        terminalRef: runtime.terminal_ref,
      });
    },
    [store, tabKey, onStarted],
  );

  const open = useCallback(
    async (folder: string | null) => {
      if (!core) {
        store.update(tabKey, { phase: phaseOfRefusal(null) });
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
        const reply = await core.open({
          project,
          ...(folder === null ? {} : { folder_ref: folder }),
          ...(cwd === undefined ? {} : { cwd }),
          ...(resume === undefined ? {} : { resume }),
          ...(command === undefined ? {} : { command }),
        });
        if (reply.ok) begin(reply.value.runtime);
        else store.update(tabKey, { phase: phaseOfRefusal(reply.reason) });
      } finally {
        store.endOpen(tabKey);
      }
    },
    [core, store, tabKey, project, begin],
  );

  // 사람이 누른 다시 시작. 옛 입력을 다시 보내지 않고 새 generation으로 연다. 이 컴퓨터는 focus 검사를 하는 shell main을,
  // 다른 기계는 그 기계의 core를 거친다(bridge).
  // 새 runtime은 core의 event로 온다.
  const restart = useCallback(async () => {
    const current = store.get(tabKey);
    const ended = current?.phase.kind === "ended" ? current.phase : null;
    if (bridge && current?.terminalRef && ended?.runtime) {
      const reply = await bridge.restart({
        terminal: current.terminalRef,
        generation: current.generation,
      });
      if (reply.ok) return;
      // 그 core가 다시 떠 터미널이 없다. 같은 폴더에 새 터미널을 연다.
      if (reply.error.code === "not_found") {
        await open(current.folderRef ?? folderRef);
        return;
      }
      // 다른 기계가 이 컴퓨터의 다시 시작을 거절하면 끝난 화면을 두고 toast만 뜬다(`onRefused`).
      if (!(copy && reply.error.code === "forbidden")) {
        store.update(tabKey, { phase: phaseOfRefusal(null) });
      }
      return;
    }
    await open(current?.folderRef ?? folderRef);
  }, [bridge, store, tabKey, folderRef, open, copy]);

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
    view.refresh?.();
    // Ctrl/Cmd-click한 링크는 main이 사람의 설정으로 어디에서 열지 정한다. browser 탭이면 이 터미널 옆에 연다. 실패해도 아무것도
    // 보이지 않는다.
    const offLink = view.onLink((url) => {
      if (!bridge) return;
      void bridge.openLink({ url }).then((reply) => {
        if (reply.ok && reply.value === "tab") latestLinkTab.current?.(url);
      });
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
    const offOsc52 = view.onOsc52Copy?.((bytes) => {
      showToast(
        t("shell.toast.terminal-clipboard-written", { bytes }),
        "brief",
      );
    });
    return () => {
      offLink();
      offPath();
      offOsc52?.();
      display.host.remove();
      display.edge.remove();
      viewRef.current = null;
    };
  }, [deps, store, tabKey, bridge, project]);
  useEffect(() => {
    deps.displays.setActive(tabKey, active);
    return () => deps.displays.setActive(tabKey, false);
  }, [deps, tabKey, active]);

  // 처음 보인 탭만 shell을 연다. 이미 도는 terminal은 displays가 한 번만 snapshot을 받고 구독한다. layout에 터미널 참조가 남은
  // 탭(다시 켠 앱)은 core에 그 터미널이 아직 살아 있으면 붙고, 없으면 새 shell을 연다.
  useEffect(() => {
    const current = store.get(tabKey);
    if (current?.terminalRef) return;
    if (current?.requested && current.phase.kind === "opening") {
      void open(current.folderRef ?? folderRef);
      return;
    }
    if (current) return;
    if (attach === null || core === null) {
      void open(folderRef);
      return;
    }
    // 읽는 동안에도 항목을 둔다. 없으면 창의 displays가 이 탭의 화면을 놓고, 다시 mount돼도 두 번 열지 않는다.
    store.update(tabKey, { phase: { kind: "opening" } });
    void core.list().then((list) => {
      // 그 사이 탭이 닫혔거나 이미 붙었다.
      const now = store.get(tabKey);
      if (now === undefined || now.terminalRef) return;
      const found = list?.find((one) => one.terminal_ref === attach);
      if (found !== undefined && endingOf(found) === null) {
        store.adopt(tabKey, {
          terminalRef: found.terminal_ref,
          generation: found.generation,
          folderRef: found.folder_ref,
        });
      } else {
        void open(folderRef);
      }
    });
  }, [tabKey]);

  const liveRuntime = phase.kind === "live" ? phase.runtime : null;
  const liveKey =
    liveRuntime && entry?.terminalRef
      ? `${entry.terminalRef}:${liveRuntime.generation}`
      : null;

  const boundRef = entry?.terminalRef ?? null;
  const boundGeneration = entry?.generation ?? 0;
  // 다른 기기가 PTY 크기를 잡았다. 칸에 맞추지 않고, 사람이 이 탭을 고르거나 누르면 칸 크기로 다시 잡는다(마지막에 잡은 쪽이
  // 이긴다). 다른 기계의 터미널은 늘 이렇다: 그 기계의 탭과 칸 크기를 다투지 않는다.
  const remote = entry?.remote === true;
  // 이 탭이 마지막에 잡은 크기. 그 기계가 다른 크기를 알리면 다른 기기가 잡은 것이다(`elsewhere`).
  const grabbed = useRef("");
  const grabbedDims = useRef("");
  // 그 기계가 마지막으로 알린 PTY 크기.
  const ptyDims = useRef("");
  if (copy && liveRuntime !== null && ptyDims.current === "") {
    ptyDims.current = `${liveRuntime.columns}x${liveRuntime.rows}`;
  }
  const [elsewhere, setElsewhere] = useState(false);
  const reclaim = (fromKey = false) => {
    if (!(remote || copy) || !core || boundRef === null) return;
    // 이미 이 탭이 PTY 크기를 쥐고 있으면 키를 칠 때마다 fit(강제 layout·getComputedStyle)과 resize를 부르지 않는다.
    if (
      fromKey &&
      copy &&
      !elsewhere &&
      grabbedDims.current !== "" &&
      ptyDims.current === grabbedDims.current &&
      grabbed.current ===
        `${boundRef}:${boundGeneration}:${grabbedDims.current}`
    ) {
      return;
    }
    const dims = viewRef.current?.fit();
    if (!dims) return;
    // 다른 기계의 탭은 이 탭이 잡은 크기를 다른 기기가 놓게 하지 않았으면(같은 치수) 보내지 않는다.
    const dimText = `${dims.columns}x${dims.rows}`;
    const size = `${boundRef}:${boundGeneration}:${dimText}`;
    const held = ptyDims.current === dimText;
    if (copy && !elsewhere && held && size === grabbed.current) return;
    grabbed.current = size;
    grabbedDims.current = dimText;
    const ref = boundRef;
    void core
      .resize(ref, boundGeneration, dims.columns, dims.rows)
      .then((reply) => {
        if (reply.ok) {
          // 같은 치수면 원격 core가 TerminalRuntimeChanged를 다시 내지 않으므로 답에서 PTY 크기를 맞춘다.
          ptyDims.current = `${reply.value.columns}x${reply.value.rows}`;
          store.noteRuntime(reply.value);
          const mine = grabbedDims.current === ptyDims.current;
          setElsewhere(reply.value.remote_size === true && !mine);
        } else if (grabbed.current === size) {
          // watch lease 전 conflict 등으로 실패했으면 잡은 표시를 비워 다음 restored·입력에서 다시 잡는다.
          grabbed.current = "";
        }
      });
  };
  useEffect(() => {
    if (!copy) return;
    return store.onRuntime((runtime) => {
      if (runtime.terminal_ref !== boundRef) return;
      ptyDims.current = `${runtime.columns}x${runtime.rows}`;
      const mine = grabbedDims.current === ptyDims.current;
      setElsewhere(runtime.remote_size === true && !mine);
    });
  }, [copy, store, boundRef]);

  const showScreen =
    phase.kind === "live" || (phase.kind === "ended" && phase.runtime !== null);

  // 고른 탭일 때만 main의 focus 표에 이 터미널을 적는다. 떠나면 지운다.
  // 다시 붙은 탭은 opening(hidden) 동안 boundRef가 먼저 잡히므로, 화면이 보일 때(`showScreen`) 다시 focus를 주어
  // onFocus(bindFocus)와 terminal 단축키 context가 빠지지 않게 한다.
  useEffect(() => {
    if (!active || !bridge || boundRef === null || boundGeneration < 1) return;
    const ref = { terminal: boundRef, generation: boundGeneration };
    void bridge.focus({ ...ref, focused: true });
    if (showScreen) viewRef.current?.focus();
    reclaim();
    return () => {
      void bridge.focus({ ...ref, focused: false });
    };
  }, [active, bridge, boundRef, boundGeneration, showScreen]);

  // 다른 기계의 터미널은 이 컴퓨터의 focus 표에 들지 않으므로, 고른 탭인 동안 `term:<ref>`를 visibility로 알려
  // 그 기계의 core가 `unseen`("Finished, not seen yet")을 끄고 중복 알림을 막게 한다.
  useReportVisible(
    copy && boundRef !== null ? terminalSessionId(boundRef) : null,
    active,
  );

  // 표시 영역에 맞춰 PTY 치수를 바꾼다. focus 칸이 아니어도 보이면 따른다. 안 그러면 xterm만 새 폭이고
  // PTY는 옛 폭이라 TUI가 옛 폭으로 그려 잘린다. 다시 붙어 snapshot을 PTY 치수로 쓴 뒤(`restored`)에도 칸에 다시 맞춘다.
  // 폰이 크기를 잡은 동안은 맞추지 않고, 놓으면 같은 치수라도 다시 보낸다.
  const restored = entry?.restored ?? 0;
  useEffect(() => {
    if (!liveKey || !core || boundRef === null) return;
    if (remote || copy) {
      lastSize.current = "";
      // watch 직후 처음 snapshot이 끝나고 아직 크기를 못 잡았거나(열기 직후 watch 전 conflict), 이 탭이 잡은 크기를 쥔 채 칸이 바뀌면 다시 맞춘다.
      if (!copy || !active || elsewhere) return;
      if (grabbedDims.current === "" && restored === 0) return;
      const timer = setTimeout(() => reclaim(), 150);
      return () => clearTimeout(timer);
    }
    const dims = viewRef.current?.fit();
    if (!dims) return;
    const key = `${liveKey}:${dims.columns}x${dims.rows}`;
    if (key === lastSize.current) return;
    lastSize.current = key;
    void core.resize(boundRef, boundGeneration, dims.columns, dims.rows);
  }, [
    liveKey,
    core,
    boundRef,
    boundGeneration,
    size?.width,
    size?.height,
    restored,
    remote,
    copy,
    active,
    elsewhere,
  ]);

  // 그 기계가 이 컴퓨터의 입력을 거절했다. 화면은 그대로 보이고 toast가 허락을 켤 곳을 말한다.
  const [refused, setRefused] = useState(false);
  const latestRef = useRef(boundRef);
  latestRef.current = boundRef;
  useEffect(() => {
    const offRefused = deps.onRefused?.((terminal) => {
      if (terminal === latestRef.current) setRefused(true);
    });
    const offAccepted = deps.onAccepted?.((terminal) => {
      if (terminal === latestRef.current) setRefused(false);
    });
    return () => {
      offRefused?.();
      offAccepted?.();
    };
  }, [deps]);

  // 원격 터미널(@xterm/headless)이 OSC 52 쓰기를 감지해 보낸 알림을 탭 toast로 보인다.
  useEffect(() => {
    if (!copy || !core) return;
    return core.subscribe((message) => {
      if (
        message.kind === "event" &&
        message.event.type === "TerminalClipboardWritten" &&
        message.event.payload.terminal === latestRef.current
      ) {
        showToast(
          t("shell.toast.terminal-clipboard-written", {
            bytes: message.event.payload.bytes,
          }),
          "brief",
        );
      }
    });
  }, [copy, core, showToast]);

  const uploadImages = useCallback(
    async (files: readonly File[]) => {
      const terminal = latestRef.current;
      if (!bridge || terminal === null) return;
      const paths: string[] = [];
      let failed = false;
      for (const file of files) {
        const mediaType = imageMediaTypeOf(file);
        if (mediaType === null) continue;
        if (file.size === 0 || file.size > PASTE_IMAGE_MAX_BYTES) {
          failed = true;
          continue;
        }
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const reply = await bridge.pasteImage({
            terminal,
            media_type: mediaType,
            data_base64: bytesToBase64(bytes),
          });
          if (reply.ok) {
            paths.push(reply.value.path);
          } else if (reply.error.code !== "forbidden") {
            failed = true;
          }
        } catch {
          failed = true;
        }
      }
      if (paths.length > 0) {
        viewRef.current?.pasteText?.(paths.map(shellQuotePath).join(" "));
      }
      if (failed) {
        showToast(t("shell.toast.terminal-image-paste-failed"), "default");
      }
    },
    [bridge, showToast],
  );

  const onPasteCapture = (event: ClipboardEvent<HTMLDivElement>) => {
    const data = event.clipboardData;
    if (!data || !bridge || latestRef.current === null) return;
    const fromFiles = [...data.files];
    const fromItems =
      fromFiles.length > 0
        ? fromFiles
        : [...data.items]
            .filter((item) => item.kind === "file")
            .map((item) => item.getAsFile())
            .filter((file): file is File => file !== null);
    const images = fromItems.filter((file) => imageMediaTypeOf(file) !== null);
    if (images.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    void uploadImages(images);
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    const images = [...event.dataTransfer.files].filter(
      (file) => imageMediaTypeOf(file) !== null,
    );
    if (images.length === 0 || !bridge || latestRef.current === null) return;
    event.preventDefault();
    event.stopPropagation();
    viewRef.current?.focus();
    void uploadImages(images);
  };

  const onScreenKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    reclaim(true);
    if (
      ctrlVHintShown ||
      isMacPlatform() ||
      !event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.metaKey ||
      (event.code !== "KeyV" && event.key.toLowerCase() !== "v")
    ) {
      return;
    }
    // 단축키 설정이 기본(Ctrl+Shift+V)일 때만 안내한다. 사람이 Ctrl+V로 바꿨으면 띄우지 않는다.
    const pasteChords = commands?.overrides()["terminal.paste"] ??
      commands?.keymap().find((entry) => entry.command === "terminal.paste")
        ?.other ?? ["Ctrl+Shift+KeyV"];
    if (
      pasteChords.some((chord) => chord.toLowerCase() === "ctrl+keyv") ||
      !pasteChords.some((chord) => chord.toLowerCase() === "ctrl+shift+keyv")
    ) {
      return;
    }
    ctrlVHintShown = true;
    showToast(t("shell.toast.terminal-ctrl-v-hint"), "default");
  };

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
        onPointerDown={() => reclaim()}
        onKeyDown={onScreenKeyDown}
        onPasteCapture={onPasteCapture}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        <div ref={hostRef} className={styles.screenHost} />
        {(copy ? elsewhere : remote) && showScreen ? (
          <div className={styles.remoteSize}>
            {t("terminal.notice.sized-elsewhere")}
          </div>
        ) : null}
      </div>
      {showScreen || banner ? null : <div className={styles.fill} />}
      {banner}
      {refused && machine !== null ? (
        <div className={styles.toast}>
          <Toast
            title={t("terminal.toast.view-only", { name: machine.name })}
            onClose={() => setRefused(false)}
            timer={STAY}
          />
        </div>
      ) : infoToast !== null ? (
        <div className={styles.toast}>
          <Toast
            key={infoToast.id}
            title={infoToast.text}
            duration={infoToast.duration}
            onClose={() => setInfoToast(null)}
          />
        </div>
      ) : null}
    </div>
  );
}
