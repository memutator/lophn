// active domain 그릇(project의 등록 폴더들, 앱의 source 폴더)의 파일 변화를 core가 `Deno.watchFs`로 보고, 바뀌면 그
// domain을 다시 sync하게 한다. 사람이 열지 않아도 위반이 늘면 사람에게 알리려는 것이 전부라 신호는 힌트일
// 뿐이다: 변화 목록·이력·event를 만들지 않고, 놓쳐도 다음 읽기 앞 sync가 따라잡는다.
//
// - 감시 대상: domain마다 (a) 그 root들 아래 `kindWatchFolders(적용 중인 kinds)`, (b) domain 폴더
//   (`<data>/domains/<dom>/`, 재귀 아님, `kinds.yaml` 이벤트만 본다). 보관된 domain·그릇은 보지 않는다.
// - 합침: detector가 500ms 동안 합친다. 창이 닫히면 `catchUp(domain)`(force sync)를 한 번 부르고, 그 응답이
//   적용 중인 kinds 파일 hash와 달라졌으면(`kinds.yaml`이 바뀌었다) 그 domain의 감시를 다시 정한다.
// - 없는 폴더: 열지 못하면 건너뛴다. domain 폴더는 감시를 열기 전에 만든다(처음 쓴 `kinds.yaml`을 놓치지 않으려고).
//   만들지 못하면 건너뛰고 그 domain은 다음 다시 정하기(command)에서 다시 시도한다.
//
// 이 모듈은 core의 module graph에 들어간다. node:sqlite와 동기 file API는 쓰지 않는다.
import { mkdir } from "node:fs/promises";
import type { Result } from "../../../../../base/mod.ts";
import {
  appArchive,
  appConnectSource,
  appCreate,
  appUnarchive,
} from "../../../../../protocol/apps/apps.ts";
import {
  domainArchive,
  domainCreate,
  domainFolder,
  domainUnarchive,
} from "../../../../../protocol/domains/mod.ts";
import { DOMAIN_KINDS_FILE } from "../../../../../protocol/domains/paths.ts";
import {
  type Kind,
  type KindsSyncResponse,
  kindWatchFolders,
} from "../../../../../protocol/projects/mod.ts";
import { projectApi } from "../../../../../protocol/projects/project-api.ts";
import { createChangeDetector } from "./detector.ts";
import { type FsWatch, startFsWatch } from "./fs.ts";
import type { ChangeDetector, Timer, WatchFs } from "./types.ts";

type KindsWatchDeps = {
  dataRoot: string;
  // active project와 그 root들.
  list(): { domain: string; roots: string[] }[];
  // 적용 중인 kinds(`kind.get`의 답). 읽지 못하면 err다.
  kindsOf(
    domain: string,
  ): Promise<
    Result<{ status: { applied_hash: string | null }; kinds: Kind[] | null }>
  >;
  // 그 project를 force sync한다. 기다리지 않는 쪽은 이 함수를 부르는 watch다.
  catchUp(domain: string): Promise<Result<KindsSyncResponse>>;
  // 제품은 `Deno.watchFs`.
  watchFs: WatchFs;
  // domain 폴더를 만든다. 기본은 `mkdir(path, { recursive: true })`.
  ensureDir?(path: string): Promise<void>;
  log?(message: string): void;
};

export type KindsWatch = {
  // active domain 전부를 읽어 감시를 열고 각각 한 번 sync한다.
  start(): Promise<void>;
  // 받아들여진 command가 감시 집합을 바꿀 수 있으면 전체를 다시 정한다.
  onCommand(command: string): void;
  stop(): void;
};

type Entry = {
  roots: string;
  detectors: ChangeDetector[];
  watches: FsWatch[];
  // 열 때 읽은 적용 중인 kinds 파일 hash. null이면 없거나 읽지 못했다.
  applied: string | null;
  // 폴더를 열지 못한 적이 있다.
  incomplete: boolean;
  // kinds 파일이 바뀐 것을 알았다. 다음 다시 정하기가 이 project를 다시 연다.
  stale: boolean;
};

const realTimer: Timer = {
  set: (ms, run) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

// 제품의 watchFs. 폴더가 없으면 던진다(어댑터가 건너뛴다).
export const denoWatchFs: WatchFs = (path, options) =>
  Deno.watchFs(path, options);

// 감시 집합(active domain과 그 그릇의 폴더)을 바꿀 수 있는 command.
const WATCH_COMMANDS: Set<string> = new Set([
  projectApi.register.name,
  projectApi.edit.name,
  projectApi.relinkFolder.name,
  projectApi.archive.name,
  projectApi.unarchive.name,
  appCreate.name,
  appConnectSource.name,
  appArchive.name,
  appUnarchive.name,
  domainCreate.name,
  domainArchive.name,
  domainUnarchive.name,
]);

export function createKindsWatch(deps: KindsWatchDeps): KindsWatch {
  const entries = new Map<string, Entry>();
  let stopped = false;
  // 읽고 여는 일은 부른 순서대로 하나씩 돈다.
  let chain: Promise<unknown> = Promise.resolve();
  const enqueue = (run: () => Promise<void>): Promise<void> => {
    const next = chain.then(async () => {
      if (!stopped) await run();
    }).catch((error) => deps.log?.(`kinds watch: ${String(error)}`));
    chain = next;
    return next;
  };

  function drop(domain: string) {
    const entry = entries.get(domain);
    if (entry === undefined) return;
    entries.delete(domain);
    for (const detector of entry.detectors) detector.close();
    for (const watch of entry.watches) watch.close();
  }

  function catchUp(domain: string) {
    void deps.catchUp(domain).then((synced) => {
      if (stopped) return;
      if (!synced.ok) {
        deps.log?.(`kinds sync ${domain}: ${synced.error.message}`);
        return;
      }
      const entry = entries.get(domain);
      if (
        entry !== undefined &&
        synced.value.status.applied_hash !== entry.applied
      ) {
        entry.stale = true;
        void enqueue(refreshAll);
      }
    }, (error) => deps.log?.(`kinds sync ${domain}: ${String(error)}`));
  }

  async function open(domain: string, roots: string[]) {
    const got = await deps.kindsOf(domain);
    if (stopped) return;
    drop(domain);
    const entry: Entry = {
      roots: roots.join("\n"),
      detectors: [],
      watches: [],
      applied: got.ok ? got.value.status.applied_hash : null,
      incomplete: !got.ok,
      stale: false,
    };
    const watchFs: WatchFs = (path, options) => {
      try {
        return deps.watchFs(path, options);
      } catch (error) {
        entry.incomplete = true;
        throw error;
      }
    };
    const rescan = () => {
      if (!stopped) catchUp(domain);
    };
    const detector = (folders: { path: string; recursive: boolean }[]) => {
      const made = createChangeDetector({ timer: realTimer, rescan });
      entry.detectors.push(made);
      return { made, diff: made.apply([{ key: domain, folders }]) };
    };

    if (got.ok && got.value.kinds !== null) {
      const content = detector(kindWatchFolders(got.value.kinds));
      for (const root of roots) {
        const watch = startFsWatch({ root, detector: content.made, watchFs });
        watch.update(content.diff);
        entry.watches.push(watch);
      }
    }

    // PM이 처음 kinds.yaml을 쓸 때 폴더 감시가 이미 열려 있어야 한다.
    // 폴더가 없으면 감시가 열리지 않아 처음 쓴 kinds.yaml을 놓치므로 먼저 만든다. 못 만들면 incomplete라 다음에 다시 시도한다.
    const kindsDir = domainFolder(deps.dataRoot, domain);
    try {
      await (deps.ensureDir ??
        ((path) => mkdir(path, { recursive: true })))(kindsDir);
    } catch (error) {
      entry.incomplete = true;
      deps.log?.(`kinds watch: ${kindsDir}: ${String(error)}`);
    }
    const file = detector([{ path: "", recursive: false }]);
    const onlyKinds: ChangeDetector = {
      ...file.made,
      signal: (paths) =>
        file.made.signal(paths.filter((path) => path === DOMAIN_KINDS_FILE)),
    };
    const watch = startFsWatch({
      root: kindsDir,
      detector: onlyKinds,
      watchFs,
    });
    watch.update(file.diff);
    entry.watches.push(watch);

    entries.set(domain, entry);
    catchUp(domain);
  }

  async function refreshAll() {
    const active = deps.list();
    const names = new Set(active.map((item) => item.domain));
    for (const domain of [...entries.keys()]) {
      if (!names.has(domain)) drop(domain);
    }
    for (const { domain, roots } of active) {
      const existing = entries.get(domain);
      if (
        existing !== undefined && !existing.incomplete && !existing.stale &&
        existing.roots === roots.join("\n")
      ) continue;
      await open(domain, roots);
    }
  }

  return {
    start: () => enqueue(refreshAll),
    onCommand(command) {
      if (WATCH_COMMANDS.has(command)) void enqueue(refreshAll);
    },
    stop() {
      stopped = true;
      for (const domain of [...entries.keys()]) drop(domain);
    },
  };
}
