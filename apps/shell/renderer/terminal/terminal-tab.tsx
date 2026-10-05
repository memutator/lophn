import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useObservedSize } from "@lophn/design/components";
import { t } from "@lophn/wording";

import type {
  TerminalRuntime,
  TerminalSnapshotReply,
} from "../../ipc/terminal.ts";
import type { TerminalDeps } from "./deps.ts";
import { ExitBanner, MissingOutput } from "./exit-banner.tsx";
import { FolderChoice, StartNotice } from "./folder-choice.tsx";
import {
  acceptOutput,
  endingOf,
  folderTitle,
  type Phase,
  phaseOfReply,
  phaseOfRuntime,
  splitInput,
} from "./model.ts";
import type { TerminalEntry } from "./store.ts";
import type { TerminalView } from "./xterm-view.ts";
import styles from "./terminal.module.css";

export interface TerminalTabProps {
  tabKey: string;
  project: string;
  /** layout에 남은 시작 폴더. 복원한 탭을 사람이 다시 시작할 때 쓴다. */
  folderRef: string | null;
  /** focus 칸의 고른 탭이다. 이때만 입력·resize를 보낸다(shell/terminal#R3). */
  active: boolean;
  deps: TerminalDeps;
  /** 시작한 폴더를 탭 제목과 layout에 남긴다. */
  onStarted?: (info: { title: string | null; folderRef: string }) => void;
}

const IDLE: Phase = { kind: "idle" };
const DEFAULT_POLL_MS = 40;
// 이 renderer에서 사람이 첫 열기 안내를 숨겼다.
let noticeHidden = false;
// 같은 탭의 시작이 두 번 나가지 않게 한다. 탭 화면이 다시 그려져도 하나다.
const opening = new Set<string>();

function sameRuntime(a: Phase, b: Phase): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "live" && b.kind === "live") {
    return a.runtime.generation === b.runtime.generation &&
      a.runtime.state === b.runtime.state;
  }
  if (a.kind === "ended" && b.kind === "ended") {
    return a.ending === b.ending &&
      a.runtime?.generation === b.runtime?.generation &&
      a.runtime?.exit_code === b.runtime?.exit_code;
  }
  return false;
}

// 프로젝트 작업대의 터미널 탭. PTY는 host가 갖고 이 화면은 보이고 입력을 넘길
// 뿐이다. 탭을 숨기거나 옮겨도 shell은 그대로이고 다시 그리면 같은 runtime에
// 붙는다(shell/terminal#R7, R8).
export function TerminalTab(
  { tabKey, project, folderRef, active, deps, onStarted }: TerminalTabProps,
) {
  const { store, bridge } = deps;
  const subscribe = useCallback(
    (listener: () => void) => store.subscribe(listener),
    [store],
  );
  const entry: TerminalEntry | undefined = useSyncExternalStore(
    subscribe,
    () => store.get(tabKey),
  );
  const phase = entry?.phase ?? IDLE;
  const [missing, setMissing] = useState(false);
  const [notice, setNotice] = useState(!noticeHidden);
  const hostRef = useRef<HTMLDivElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<TerminalView | null>(null);
  const lastSeqRef = useRef(0);
  const activeRef = useRef(active);
  const inputChain = useRef<Promise<unknown>>(Promise.resolve());
  const lastSize = useRef<string>("");
  const size = useObservedSize(screenRef);
  activeRef.current = active;

  const setPhase = useCallback((next: Phase) => {
    const current = store.get(tabKey)?.phase ?? IDLE;
    if (!sameRuntime(current, next)) store.update(tabKey, { phase: next });
  }, [store, tabKey]);

  const apply = useCallback((value: TerminalSnapshotReply) => {
    const step = acceptOutput(
      lastSeqRef.current,
      value.runtime.generation,
      value.output,
    );
    for (const text of step.writes) viewRef.current?.write(text);
    lastSeqRef.current = step.lastSeq;
    if (step.missing || value.runtime.dropped_output) setMissing(true);
    setPhase(phaseOfRuntime(value.runtime));
  }, [setPhase]);

  const begin = useCallback((runtime: TerminalRuntime) => {
    lastSeqRef.current = 0;
    lastSize.current = "";
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
  }, [store, tabKey, onStarted]);

  const open = useCallback(async (folder: string | null) => {
    if (opening.has(tabKey)) return;
    if (!bridge) {
      store.update(tabKey, {
        phase: { kind: "refused", reason: "unavailable" },
      });
      return;
    }
    opening.add(tabKey);
    store.update(tabKey, {
      requested: true,
      folderRef: folder,
      phase: { kind: "opening" },
    });
    try {
      const reply = await bridge.open(
        folder === null ? { project } : { project, folder_ref: folder },
      );
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
  }, [bridge, store, tabKey, project, begin]);

  // 사람이 누른 다시 시작. 옛 입력을 다시 보내지 않고 새 generation으로 연다(R9).
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
    if (!host) return;
    const view = deps.createView(host);
    viewRef.current = view;
    const off = view.onData((text) => {
      const current = store.get(tabKey);
      if (
        !activeRef.current || !bridge || !current?.terminalRef ||
        current.phase.kind !== "live"
      ) return;
      const ref = {
        terminal_ref: current.terminalRef,
        generation: current.generation,
      };
      for (const part of splitInput(text)) {
        inputChain.current = inputChain.current.then(() =>
          bridge.input({ ...ref, text: part })
        );
      }
    });
    return () => {
      off();
      view.dispose();
      viewRef.current = null;
    };
  }, [deps, store, tabKey, bridge]);

  // 처음 그릴 때: 살아 있는 runtime이 있으면 다시 붙고, 사람이 연 탭이면 시작하고,
  // 복원한 탭이면 누를 때까지 기다린다(shell/workspace#R7).
  useEffect(() => {
    lastSeqRef.current = 0;
    const current = store.get(tabKey);
    if (current?.terminalRef && bridge) {
      const terminalRef = current.terminalRef;
      void bridge.snapshot({ terminal_ref: terminalRef, after_seq: 0 }).then(
        (reply) => {
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
        },
      );
    } else if (current?.requested && current.phase.kind === "opening") {
      void open(current.folderRef ?? folderRef);
    } else if (!current) {
      store.update(tabKey, { phase: IDLE });
    }
    // 탭마다 한 번이다.
  }, [tabKey]);

  // 살아 있는 동안 host buffer를 이어 읽는다. 끝나면 멈춘다.
  const liveRuntime = phase.kind === "live" ? phase.runtime : null;
  const liveKey = liveRuntime && entry?.terminalRef
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

  // 고른 탭일 때만 main의 focus 표에 이 터미널을 적는다. 떠나면 지운다(R3).
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

  // 표시 영역에 맞춰 PTY 치수를 바꾼다. 고른 탭일 때만 보낸다.
  useEffect(() => {
    if (!active || !liveKey || !bridge || boundRef === null) return;
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
    active,
    liveKey,
    bridge,
    boundRef,
    boundGeneration,
    size?.width,
    size?.height,
  ]);

  const showScreen = phase.kind === "live" ||
    (phase.kind === "ended" && phase.runtime !== null);
  const showNotice = notice && phase.kind !== "idle" &&
    !(phase.kind === "refused" && phase.reason === "unavailable");

  let banner = null;
  if (phase.kind === "ended") {
    banner = (
      <ExitBanner
        state={{
          kind: "ended",
          ending: phase.ending,
          exitCode: phase.runtime?.exit_code ?? null,
        }}
        onRestart={() => void restart()}
      />
    );
  } else if (phase.kind === "idle") {
    banner = (
      <ExitBanner
        state={{ kind: "not_started" }}
        onRestart={() => void restart()}
      />
    );
  } else if (phase.kind === "refused") {
    banner = (
      <ExitBanner
        state={{ kind: "refused", reason: phase.reason }}
        onRestart={phase.reason === "no_folder"
          ? undefined
          : () => void open(entry?.folderRef ?? folderRef)}
      />
    );
  }

  return (
    <div
      className={styles.terminal}
      data-terminal-tab={tabKey}
      data-phase={phase.kind}
    >
      {showNotice
        ? (
          <StartNotice
            onHide={() => {
              noticeHidden = true;
              setNotice(false);
            }}
          />
        )
        : null}
      {missing && showScreen ? <MissingOutput /> : null}
      {phase.kind === "choose"
        ? (
          <FolderChoice
            folders={phase.folders}
            onChoose={(folder) => void open(folder)}
          />
        )
        : null}
      <div
        ref={screenRef}
        className={styles.screen}
        hidden={!showScreen}
        role="region"
        aria-label={t("terminal.label.output")}
        data-terminal-screen=""
      >
        <div ref={hostRef} className={styles.screenHost} />
      </div>
      {showScreen || phase.kind === "choose"
        ? null
        : <div className={styles.fill} />}
      {banner}
    </div>
  );
}
