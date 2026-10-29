import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useObservedSize } from "@lophn/ui/shared";
import { t } from "@lophn/wording";

import type {
  TerminalRuntime,
  TerminalSnapshotReply,
} from "../../ipc/terminal.ts";
import type { TerminalDeps } from "./deps.ts";
import { ExitBanner, MissingOutput } from "./exit-banner.tsx";
import { FolderChoice } from "./folder-choice.tsx";
import {
  acceptOutput,
  endingOf,
  folderTitle,
  type Phase,
  phaseOfReply,
  phaseOfRuntime,
  splitInput,
  tabName,
} from "./model.ts";
import type { TerminalEntry } from "./store.ts";
import type { TerminalView } from "./xterm-view.ts";
import styles from "./terminal.module.css";

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
   * 탭 줄에 보이는 이름과 그 이름을 정하는 입력. 사람이 붙인 이름 > harness session 이름 > agent의 터미널 제목 > 자동 이름.
   * 탭 줄이 없는 자리는 주지 않는다.
   */
  naming?: {
    name: { shown: string; person: string | null; auto: string };
    onName: (name: string) => void;
  };
}

const IDLE: Phase = { kind: "idle" };
const DEFAULT_POLL_MS = 40;
// 같은 탭의 시작이 두 번 나가지 않게 한다. 탭 화면이 다시 그려져도 하나다.
const opening = new Set<string>();

function sameRuntime(a: Phase, b: Phase): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "live" && b.kind === "live") {
    return (
      a.runtime.generation === b.runtime.generation &&
      a.runtime.state === b.runtime.state
    );
  }
  if (a.kind === "ended" && b.kind === "ended") {
    return (
      a.ending === b.ending &&
      a.runtime?.generation === b.runtime?.generation &&
      a.runtime?.exit_code === b.runtime?.exit_code
    );
  }
  return false;
}

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
  naming,
}: TerminalTabProps) {
  const { store, bridge } = deps;
  const subscribe = useCallback(
    (listener: () => void) => store.subscribe(listener),
    [store],
  );
  const entry: TerminalEntry | undefined = useSyncExternalStore(subscribe, () =>
    store.get(tabKey),
  );
  // agent와 제목은 store version이 알린다. 숨은 탭은 이 화면이 없어 다시 고를 때까지 이름이 그대로다.
  useSyncExternalStore(subscribe, () => store.version());
  const agentTitle = store.agentTitleOf(tabKey);
  const sessionName = store.agentOf(tabKey)?.name ?? null;
  const nextName =
    naming === undefined
      ? null
      : tabName({
          person: naming.name.person,
          sessionName,
          agentTitle,
          auto: naming.name.auto,
        });
  useEffect(() => {
    if (
      naming !== undefined &&
      nextName !== null &&
      nextName !== naming.name.shown
    ) {
      naming.onName(nextName);
    }
  }, [nextName, naming?.name.shown]);
  const phase = entry?.phase ?? IDLE;
  const [missing, setMissing] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const edgeRef = useRef<HTMLCanvasElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<TerminalView | null>(null);
  const lastSeqRef = useRef(0);
  // 이미 도는 터미널에 다시 붙었다. 처음 받는 출력은 붙기 전에 나온 것이라 다시 쓰기다.
  const replayRef = useRef(false);
  const activeRef = useRef(active);
  const inputChain = useRef<Promise<unknown>>(Promise.resolve());
  const lastSize = useRef<string>("");
  const size = useObservedSize(screenRef);
  activeRef.current = active;

  const setPhase = useCallback(
    (next: Phase) => {
      const current = store.get(tabKey)?.phase ?? IDLE;
      if (!sameRuntime(current, next)) store.update(tabKey, { phase: next });
    },
    [store, tabKey],
  );

  const apply = useCallback(
    (value: TerminalSnapshotReply) => {
      const step = acceptOutput(
        lastSeqRef.current,
        value.runtime.generation,
        value.output,
      );
      store.noteRuntime(value.runtime);
      // 다시 쓰는 출력의 질의(DA1 등)에 xterm이 답하면 그 답이 PTY에 사람의 입력으로 들어간다.
      const replay = replayRef.current;
      replayRef.current = false;
      for (const text of step.writes) {
        if (replay) viewRef.current?.replay(text);
        else viewRef.current?.write(text);
      }
      lastSeqRef.current = step.lastSeq;
      if (step.missing || value.runtime.dropped_output) setMissing(true);
      setPhase(phaseOfRuntime(value.runtime));
    },
    [store, setPhase],
  );

  const begin = useCallback(
    (runtime: TerminalRuntime) => {
      lastSeqRef.current = 0;
      replayRef.current = false;
      lastSize.current = "";
      store.noteRuntime(runtime);
      setMissing(false);
      viewRef.current?.reset();
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
      if (opening.has(tabKey)) return;
      if (!bridge) {
        store.update(tabKey, {
          phase: { kind: "refused", reason: "unavailable" },
        });
        return;
      }
      opening.add(tabKey);
      // 다시 열기 명령은 처음 한 번만 보낸다. 다시 시작이 같은 명령을 또 치지 않게 비운다.
      const resume = store.get(tabKey)?.resume;
      store.update(tabKey, {
        requested: true,
        folderRef: folder,
        phase: { kind: "opening" },
        resume: undefined,
      });
      try {
        const reply = await bridge.open({
          project,
          ...(folder === null ? {} : { folder_ref: folder }),
          ...(resume === undefined ? {} : { resume }),
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
        opening.delete(tabKey);
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

  // xterm 표시는 탭 화면이 있는 동안만 산다. 사라져도 shell은 host에 남는다.
  useEffect(() => {
    const host = hostRef.current;
    const edge = edgeRef.current;
    if (!host || !edge) return;
    const view = deps.createView(host, edge);
    viewRef.current = view;
    const off = view.onData((text) => {
      const current = store.get(tabKey);
      if (
        !activeRef.current ||
        !bridge ||
        !current?.terminalRef ||
        current.phase.kind !== "live"
      )
        return;
      const ref = {
        terminal_ref: current.terminalRef,
        generation: current.generation,
      };
      for (const part of splitInput(text)) {
        inputChain.current = inputChain.current.then(() =>
          bridge.input({ ...ref, text: part }),
        );
      }
    });
    // Ctrl/Cmd-click한 링크는 main이 browser 탭으로 열지 정한다. 실패해도 아무것도 보이지 않는다.
    const offLink = view.onLink((url) => {
      const terminalRef = store.get(tabKey)?.terminalRef;
      if (!bridge || !terminalRef) return;
      void bridge.openLink({ terminal_ref: terminalRef, url });
    });
    const offTitle = view.onTitle((title) => {
      const terminalRef = store.get(tabKey)?.terminalRef;
      if (terminalRef) store.noteTitle(terminalRef, title);
    });
    return () => {
      off();
      offLink();
      offTitle();
      view.dispose();
      viewRef.current = null;
    };
  }, [deps, store, tabKey, bridge]);

  // 처음 그릴 때: 살아 있는 runtime이 있으면 다시 붙고, 아니면 시작한다. 터미널 탭은 보일 때만 그려지므로
  // 복원한 탭은 사람이 그 탭을 볼 때 새 shell이 뜬다.
  useEffect(() => {
    lastSeqRef.current = 0;
    const current = store.get(tabKey);
    if (current?.terminalRef && bridge) {
      const terminalRef = current.terminalRef;
      replayRef.current = true;
      void bridge
        .snapshot({ terminal_ref: terminalRef, after_seq: 0 })
        .then((reply) => {
          if (reply.ok && reply.value.ok && "output" in reply.value) {
            if (reply.value.runtime.generation !== current.generation) {
              store.update(tabKey, {
                generation: reply.value.runtime.generation,
              });
            }
            apply(reply.value);
          } else {
            setPhase({ kind: "ended", ending: "unknown", runtime: null });
          }
        });
    } else if (current?.requested && current.phase.kind === "opening") {
      void open(current.folderRef ?? folderRef);
    } else if (!current) {
      void open(folderRef);
    }
    // 탭마다 한 번이다.
  }, [tabKey]);

  // 살아 있는 동안 host buffer를 이어 읽는다. 끝나면 멈춘다.
  const liveRuntime = phase.kind === "live" ? phase.runtime : null;
  const liveKey =
    liveRuntime && entry?.terminalRef
      ? `${entry.terminalRef}:${liveRuntime.generation}`
      : null;
  useEffect(() => {
    if (!liveKey || !bridge || !entry?.terminalRef) return;
    const terminalRef = entry.terminalRef;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (stopped) return;
      const reply = await bridge.snapshot({
        terminal_ref: terminalRef,
        after_seq: lastSeqRef.current,
      });
      if (stopped) return;
      if (!reply.ok || !reply.value.ok || !("output" in reply.value)) {
        // host가 사라졌다. 성공으로 보지 않는다.
        setPhase({ kind: "ended", ending: "unknown", runtime: liveRuntime });
        return;
      }
      apply(reply.value);
      if (endingOf(reply.value.runtime) !== null) return;
      timer = setTimeout(tick, deps.pollMs ?? DEFAULT_POLL_MS);
    };
    timer = setTimeout(tick, 0);
    return () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    };
    // liveKey가 runtime의 ref·generation을 대신한다.
  }, [liveKey]);

  // 고른 탭일 때만 main의 focus 표에 이 터미널을 적는다. 떠나면 지운다.
  const boundRef = entry?.terminalRef ?? null;
  const boundGeneration = entry?.generation ?? 0;
  useEffect(() => {
    if (!active || !bridge || boundRef === null || boundGeneration < 1) return;
    const ref = { terminal_ref: boundRef, generation: boundGeneration };
    void bridge.focus({ ...ref, focused: true });
    viewRef.current?.focus();
    return () => {
      void bridge.focus({ ...ref, focused: false });
    };
  }, [active, bridge, boundRef, boundGeneration]);

  // 표시 영역에 맞춰 PTY 치수를 바꾼다. focus 칸이 아니어도 보이면 따른다. 안 그러면 xterm만 새 폭이고
  // PTY는 옛 폭이라 TUI가 옛 폭으로 그려 잘린다.
  useEffect(() => {
    if (!liveKey || !bridge || boundRef === null) return;
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
  }, [liveKey, bridge, boundRef, boundGeneration, size?.width, size?.height]);

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
      {missing && showScreen ? <MissingOutput /> : null}
      {phase.kind === "choose" ? (
        <FolderChoice
          folders={phase.folders}
          onChoose={(folder) => void open(folder)}
        />
      ) : null}
      <div
        ref={screenRef}
        className={styles.screen}
        hidden={!showScreen}
        role="region"
        aria-label={t("terminal.label.output")}
        data-terminal-screen=""
      >
        <div ref={hostRef} className={styles.screenHost} />
        <canvas ref={edgeRef} className={styles.edge} aria-hidden="true" />
      </div>
      {showScreen || phase.kind === "choose" || banner ? null : (
        <div className={styles.fill} />
      )}
      {banner}
    </div>
  );
}
