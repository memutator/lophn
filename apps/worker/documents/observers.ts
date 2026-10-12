// root별 관측 loop 관리자(documents plan Q15). 관측 근거가 반영될 때마다 활성 root
// 집합과 규칙에 loop를 맞춘다. 새 root는 loop를 시작하고, 사라진 root는 멈추고, 규칙·
// project 판이 바뀐 root는 멈춘 뒤 다시 시작해 전체 대조를 한다(file-tracking#R3).
// 바뀌지 않은 root의 loop는 건드리지 않는다.
import {
  INSTRUCTION_FILE_NAME,
  type ObserveDeps,
  type ObserveInstruction,
  type ObserveInstructionDeps,
  type ObserveRoot,
  rootSignature,
} from "../../../packages/core/projects/file-tracking/mod.ts";
import type { BasisStore } from "./basis.ts";

export type RootObservers = {
  // 근거에 맞춘다. 반영 때마다 부르고, 시험도 같은 함수를 부른다.
  sync(): void;
  // 지금 loop가 도는 root.
  running(): readonly string[];
  // 지금 loop가 도는 등록된 지침 파일.
  runningInstructions(): readonly string[];
  // 사람이 그 지침 파일에 쓴 직후 바로 다시 읽게 한다. 등록 밖 경로는 아무것도 하지 않는다.
  nudge(path: string): void;
  // 모든 loop를 멈춘다.
  stopAll(): void;
};

export type RootObserversOptions = {
  store: BasisStore;
  // loop 하나를 돈다. 제품은 `observeRoot`이고 시험이 바꿔 끼운다.
  observe(deps: ObserveDeps, request: ObserveRoot): Promise<void>;
  // watch·scan·read·제출 같은 root 공통 의존. stop과 basisFor는 관리자가 채운다.
  deps: Omit<ObserveDeps, "stop">;
  // 등록된 지침 파일의 loop. 없으면 지침 파일은 관측하지 않는다.
  instruction?: {
    observe(
      deps: ObserveInstructionDeps,
      request: ObserveInstruction,
    ): Promise<void>;
    deps: Omit<ObserveInstructionDeps, "stop" | "nudge">;
  };
};

type Running = { signature: string; stop: { stopped: boolean } };

export function createRootObservers(
  options: RootObserversOptions,
): RootObservers {
  const running = new Map<string, Running>();
  const instructions = new Map<
    string,
    { stop: { stopped: boolean }; nudge: { requested: boolean } }
  >();
  let stopped = false;

  function start(root: string, signature: string, request: ObserveRoot) {
    const stop = { stopped: false };
    running.set(root, { signature, stop });
    // loop는 stop이 서면 끝난다. 끝난 loop가 새로 뜬 같은 root의 항목을 지우지 않는다.
    void options.observe({ ...options.deps, stop }, request).catch(() => {
      // loop 하나의 실패가 다른 root를 막지 않는다. 다음 근거 반영이 다시 띄운다.
    }).finally(() => {
      if (running.get(root)?.stop === stop) running.delete(root);
    });
  }

  // 지침 파일은 등록된 exact 경로 하나마다 loop 하나다. 등록에서 사라지면 멈춘다. 문서 연결·판은
  // 제출 때 store에서 읽으므로 바뀌어도 loop를 다시 띄우지 않는다.
  function syncInstructions() {
    const config = options.instruction;
    if (config === undefined) return;
    const desired = new Set(
      options.store.instructions().map((entry) => entry.path),
    );
    for (const [path, held] of instructions) {
      if (!desired.has(path)) {
        held.stop.stopped = true;
        instructions.delete(path);
      }
    }
    for (const path of desired) {
      if (instructions.has(path)) continue;
      const held = {
        stop: { stopped: false },
        nudge: { requested: false },
      };
      instructions.set(path, held);
      void config.observe(
        { ...config.deps, stop: held.stop, nudge: held.nudge },
        { path, relative: INSTRUCTION_FILE_NAME },
      ).catch(() => {
        // loop 하나의 실패가 다른 파일을 막지 않는다. 다음 근거 반영이 다시 띄운다.
      }).finally(() => {
        if (instructions.get(path) === held) instructions.delete(path);
      });
    }
  }

  return {
    sync() {
      if (stopped) return;
      syncInstructions();
      const desired = new Map<
        string,
        { signature: string; request: ObserveRoot }
      >();
      // 보관된 연결만 project별로 한 번 모은다(연결 수에 root 수를 곱하지 않는다).
      const archivedBy = new Map<string, string[]>();
      for (const link of options.store.links()) {
        if (link.status !== "archived") continue;
        const held = archivedBy.get(link.project) ?? [];
        held.push(link.path);
        archivedBy.set(link.project, held);
      }
      for (const root of options.store.roots()) {
        const archived = (archivedBy.get(root.project) ?? []).filter((path) =>
          path.startsWith(`${root.root}/`)
        );
        desired.set(root.root, {
          signature: rootSignature(root, archived),
          request: {
            root: root.root,
            patterns: root.patterns,
            useGitignore: root.use_gitignore,
            enabled: true,
          },
        });
      }
      for (const [root, held] of running) {
        const want = desired.get(root);
        if (want === undefined || want.signature !== held.signature) {
          held.stop.stopped = true;
          running.delete(root);
        }
      }
      for (const [root, want] of desired) {
        if (!running.has(root)) start(root, want.signature, want.request);
      }
    },
    running: () => [...running.keys()],
    runningInstructions: () => [...instructions.keys()],
    nudge(path) {
      const held = instructions.get(path);
      if (held !== undefined) held.nudge.requested = true;
    },
    stopAll() {
      stopped = true;
      for (const held of instructions.values()) held.stop.stopped = true;
      instructions.clear();
      for (const held of running.values()) held.stop.stopped = true;
      running.clear();
    },
  };
}
