// 활성 context의 계약 경로가 든 폴더를 core가 `Deno.watchFs`로 보고, 바뀌면 그 context의 index를 따라잡게
// 한다(docs/architecture/documents.md 3.2 "따라잡기", 7.4, documents/contexts#R23). 사람이 열지 않아도 위반이
// 늘면 알리려는 것이 전부라 신호는 힌트일 뿐이다: 변화 목록·이력·event·화면 상태를 만들지 않고, 놓쳐도 다음
// 검색·열기의 훑기가 따라잡는다.
//
// - 감시 대상: 활성 context(적용 판이 있는 것, `context.work_list`가 돌려준다)마다 그 판의 계약이 가리키는 폴더(watch 모듈의
//   `watchFolders`)를 Project의 모든 폴더 아래에서 본다. 보관된 context와 보관된 project의 폴더는 보지 않는다.
// - 합침: 모듈의 detector가 500ms 동안 합친다. 창이 닫히면 `catchUp(context)`를 한 번 부른다.
// - 다시 정하기: 감시 집합은 context의 입력(적용 판 hash와 Project 폴더)이 바뀔 때 그 context 것만 다시 연다.
//   입력을 보는 때는 core 시작, scan이 입력을 읽을 때(`observe`), 판·보관·project command가 받아들여질 때다.
// - 없는 폴더: 열지 못하면 그 폴더는 건너뛴다. 그 context는 다음 다시 정하기(입력이 같아도)에서 다시 시도한다.
//   더 위 폴더를 대신 보지 않는다.
//
// 이 모듈은 core의 module graph에 들어간다. node:sqlite와 동기 file API는 쓰지 않는다. 감시는 async
// `Deno.watchFs`뿐이다.
import type { Result } from "../../packages/base/mod.ts";
import type {
  ContextWorkInput,
  ContextWorkList,
} from "../../packages/protocol/projects/mod.ts";
import {
  type ChangeDetector,
  createChangeDetector,
  type FsWatch,
  startFsWatch,
  type Timer,
  type WatchFs,
} from "../../packages/documents/contexts/watch/mod.ts";

export type ContextsWatchDeps = {
  // 활성 context 전체와 그 폴더·적용 판 hash(`context.work_list`). 읽지 못하면 err다.
  list(): Promise<Result<ContextWorkList>>;
  readInput(input: { context: string }): Promise<Result<ContextWorkInput>>;
  // 그 context의 index를 따라잡게 한다(2초 규칙과 도는 scan을 건너뛴다). 기다리지 않는다.
  catchUp(context: string): void | Promise<unknown>;
  // 제품은 `Deno.watchFs`, 시험은 fake.
  watchFs: WatchFs;
  // 시험이 바꿔 끼운다. 제품은 setTimeout.
  timer?: Timer;
  // 합침 시간(ms). 기본 500.
  window_ms?: number;
  log?(message: string): void;
};

export type ContextsWatch = {
  // 활성 context 전체를 읽어 감시를 시작한다. 새로 감시하게 된 context는 한 번 따라잡는다.
  start(): Promise<void>;
  // scan이 읽은 입력에 감시를 맞춘다. 따라잡지는 않는다(그 scan이 곧 따라잡기다).
  observe(input: ContextWorkInput): void;
  // 받아들여진 command가 감시 집합을 바꿀 수 있으면 다시 정한다.
  onCommand(command: string, input: unknown): void;
  // 이 context의 입력을 다시 읽어 감시를 맞춘다. 다시 열었으면 한 번 따라잡는다.
  refresh(context: string): Promise<void>;
  // 시험·진단: 지금 감시하는 context와 그 감시 폴더(Project 폴더 기준 상대 경로).
  watching(): ReadonlyMap<string, readonly string[]>;
  stop(): void;
};

type Entry = {
  key: string;
  detector: ChangeDetector;
  watches: FsWatch[];
  folders: string[];
  // 폴더를 열지 못한 적이 있다.
  incomplete: boolean;
};

const realTimer: Timer = {
  set: (ms, run) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

// 제품의 watchFs. 폴더가 없으면 던진다(어댑터가 건너뛴다).
export const denoWatchFs: WatchFs = (path, options) =>
  Deno.watchFs(path, options);

// 감시 집합이 같은지 가르는 입력: 적용 판 hash와 Project 폴더.
function keyOf(bundleHash: string, roots: readonly string[]): string {
  return `${bundleHash}\n${roots.join("\n")}`;
}

const PROJECT_COMMANDS = new Set([
  "project.archive",
  "project.unarchive",
  "project.update",
]);

export function createContextsWatch(deps: ContextsWatchDeps): ContextsWatch {
  const timer = deps.timer ?? realTimer;
  const entries = new Map<string, Entry>();
  let stopped = false;
  // 입력을 읽는 일과 적용하는 일은 부른 순서대로 하나씩 돈다.
  let chain: Promise<unknown> = Promise.resolve();
  const enqueue = (run: () => Promise<void> | void): Promise<void> => {
    const next = chain.then(async () => {
      if (!stopped) await run();
    }).catch((error) => {
      deps.log?.(`context watch: ${String(error)}`);
    });
    chain = next;
    return next;
  };

  function drop(context: string) {
    const entry = entries.get(context);
    if (entry === undefined) return;
    entries.delete(context);
    entry.detector.close();
    for (const watch of entry.watches) watch.close();
  }

  function catchUp(context: string) {
    try {
      void Promise.resolve(deps.catchUp(context)).catch((error) =>
        deps.log?.(`context watch catch-up: ${String(error)}`)
      );
    } catch (error) {
      deps.log?.(`context watch catch-up: ${String(error)}`);
    }
  }

  // 입력에 감시를 맞춘다. 감시 집합이 새로 열렸거나 바뀌었으면 true.
  function apply(input: ContextWorkInput): boolean {
    const context = input.context;
    const existing = entries.get(context);
    if (input.applied === null || input.roots.length === 0) {
      drop(context);
      return false;
    }
    const key = keyOf(input.applied.bundle_hash, input.roots);
    if (
      existing !== undefined && existing.key === key && !existing.incomplete
    ) {
      return false;
    }
    drop(context);
    const detector = createChangeDetector({
      timer,
      ...(deps.window_ms === undefined ? {} : { window_ms: deps.window_ms }),
      rescan: (contexts) => {
        if (stopped) return;
        for (const id of contexts) catchUp(id);
      },
    });
    const diff = detector.apply([{
      context,
      contract: input.applied.content.contract,
    }]);
    const entry: Entry = {
      key,
      detector,
      watches: [],
      folders: diff.start.map((folder) =>
        folder.recursive ? `${folder.path}/**` : folder.path
      ),
      incomplete: false,
    };
    const watchFs: WatchFs = (path, options) => {
      try {
        return deps.watchFs(path, options);
      } catch (error) {
        entry.incomplete = true;
        throw error;
      }
    };
    for (const root of input.roots) {
      const watch = startFsWatch({ root, detector, watchFs });
      watch.update(diff);
      entry.watches.push(watch);
    }
    entries.set(context, entry);
    return true;
  }

  async function refreshOne(context: string) {
    const read = await deps.readInput({ context });
    if (stopped) return;
    if (!read.ok) {
      // 없어진 context는 더 감시하지 않는다. 읽지 못한 것(unavailable)은 있던 감시를 그대로 둔다.
      if (read.error.code === "not_found") drop(context);
      return;
    }
    if (apply(read.value)) catchUp(context);
  }

  async function refreshAll() {
    const listed = await deps.list();
    if (stopped) return;
    if (!listed.ok) {
      deps.log?.(`context watch: ${listed.error.message}`);
      return;
    }
    const active = new Map(
      listed.value.contexts.map((entry) => [entry.context, entry]),
    );
    for (const context of [...entries.keys()]) {
      if (!active.has(context)) drop(context);
    }
    for (const [context, entry] of active) {
      const existing = entries.get(context);
      // 목록의 입력이 열려 있는 감시와 같으면 계약을 다시 읽지 않는다.
      if (
        existing !== undefined && !existing.incomplete &&
        existing.key === keyOf(entry.bundle_hash, entry.roots)
      ) {
        continue;
      }
      // 폴더가 없는 context는 감시하지 않는다.
      if (entry.roots.length === 0) {
        drop(context);
        continue;
      }
      await refreshOne(context);
    }
  }

  function contextOf(input: unknown): string | undefined {
    if (typeof input !== "object" || input === null) return undefined;
    const context = (input as Record<string, unknown>)["context"];
    return typeof context === "string" ? context : undefined;
  }

  return {
    start: () => enqueue(refreshAll),
    observe(input) {
      void enqueue(() => {
        apply(input);
      });
    },
    onCommand(command, input) {
      if (PROJECT_COMMANDS.has(command)) {
        void enqueue(refreshAll);
        return;
      }
      if (
        command === "context.archive" || command === "context.unarchive" ||
        command === "bundle.rollback"
      ) {
        const context = contextOf(input);
        if (context !== undefined) void enqueue(() => refreshOne(context));
      }
    },
    refresh: (context) => enqueue(() => refreshOne(context)),
    watching: () =>
      new Map([...entries].map(([context, entry]) => [context, entry.folders])),
    stop() {
      stopped = true;
      for (const context of [...entries.keys()]) drop(context);
    },
  };
}
