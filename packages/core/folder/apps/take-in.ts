// 다른 기계가 폴더에 내놓은 앱을 이 기계에 들인다. 다른 기계의 source git bundle에서 commit을 받아
// 이 기계의 source 저장소를 만들거나(이미 있으면 fetch) 같은 app id로 등록하고, 그 commit에서 이 기계의
// release 준비(`prepareRelease`)를 돌려 `prepared` release로 적는다.
// grant, 동의, secret, OAuth, invocation 기록, 앱 data는 옮기지 않는다: 활성화는 이 기계에서 사람에게 묻는다.
import { stat } from "node:fs/promises";
import { err, ok, type Result } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type {
  TakeInInput,
  TakeInOutput,
} from "../../../protocol/folder/take-in.ts";
import { createFolderReader } from "../fs.ts";
import type {
  FolderAppRecordCopy,
  FolderAppsDeps,
  FolderAppsHost,
} from "./deps.ts";
import { git, hasCommit } from "./git.ts";
import {
  createRepository,
  fetchPeerSources,
  type PeerSource,
  type PeerSourceResult,
} from "./source.ts";
import { setSourceRead, sourceCursor } from "./state.ts";

const incomplete = (message: string): Result<never> =>
  err({
    code: "invalid_input",
    message,
    details: { reason: "source_incomplete" },
  });

const conflict = (
  message: string,
  details: Record<string, unknown>,
): Result<never> => err({ code: "conflict", message, details });

/** 앱마다 기록이 가장 최근인 기계의 것. `from`이 있으면 그 기계의 것. */
export function pickRecord(
  copies: readonly FolderAppRecordCopy[],
  app: Id<"app">,
  from?: Id<"mch">,
): FolderAppRecordCopy | null {
  let best: FolderAppRecordCopy | null = null;
  for (const copy of copies) {
    if (copy.record.app !== app) continue;
    if (from !== undefined && copy.origin !== from) continue;
    if (best === null || copy.record.updated_at > best.record.updated_at) {
      best = copy;
    }
  }
  return best;
}

async function isInstalledPackage(path: string): Promise<boolean> {
  try {
    return (await stat(`${path}/package.json`)).isFile();
  } catch {
    return false;
  }
}

const SDK_FILE_DEP = /^file:(?:\.\/)?\.lophn\/sdk\/(.+)$/;

// commit의 `package.json`이 고정한 `@lophn/*` 판은 이 기계의 설치 사본에, `@me/*` 판은 이 기계의 catalog와
// 설치 사본에 있어야 한다. 앱을 등록하거나 build를 띄우기 전에 먼저 본다.
async function checkCommitDependencies(
  repo: string,
  commit: string,
  dataRoot: string,
  host: FolderAppsHost,
): Promise<Result<void>> {
  const shown = await git(repo, "show", `${commit}:package.json`);
  if (!shown.ok) return ok(undefined);
  let manifest: {
    dependencies?: Record<string, unknown>;
    devDependencies?: Record<string, unknown>;
  };
  try {
    manifest = JSON.parse(shown.value);
  } catch {
    return ok(undefined);
  }
  if (typeof manifest !== "object" || manifest === null) return ok(undefined);
  const all = { ...manifest.devDependencies, ...manifest.dependencies };
  const sdk: string[] = [];
  const mine: string[] = [];
  for (const name of Object.keys(all).sort()) {
    const value = all[name];
    if (typeof value !== "string") continue;
    const match = SDK_FILE_DEP.exec(value);
    if (match === null) continue;
    const rest = match[1]!;
    if (rest.startsWith("@me/")) {
      const parts = rest.slice("@me/".length).split("/");
      if (parts.length !== 2) continue;
      const [part, version] = parts as [string, string];
      if (name !== `@me/${part}`) continue;
      if (
        !host.published(name, version) ||
        !(await isInstalledPackage(`${dataRoot}/sdk/@me/${part}/${version}`))
      ) {
        mine.push(`${name}@${version}`);
      }
    } else {
      const parts = rest.split("/");
      if (parts.length !== 2) continue;
      const [part, version] = parts as [string, string];
      if (name !== `@lophn/${part}`) continue;
      if (!(await isInstalledPackage(`${dataRoot}/sdk/${part}/${version}`))) {
        sdk.push(`${name}@${version}`);
      }
    }
  }
  if (sdk.length > 0) {
    return conflict(
      `this lophn does not have ${sdk.join(", ")}; update lophn on this machine`,
      { reason: "sdk_missing", packages: sdk },
    );
  }
  if (mine.length > 0) {
    return conflict(
      `${mine.join(", ")} is not published on this machine; publish the same package version here first`,
      { reason: "dependency_missing", packages: mine },
    );
  }
  return ok(undefined);
}

function peersFor(
  deps: FolderAppsDeps,
  copies: readonly FolderAppRecordCopy[],
  app: Id<"app">,
  me: Id<"mch">,
  useStoredCursor: boolean,
): PeerSource[] {
  const out: PeerSource[] = [];
  const sorted = copies
    .filter((copy) => copy.record.app === app)
    .sort((a, b) => (a.origin < b.origin ? -1 : 1));
  for (const copy of sorted) {
    const destination = deps.destinations.resolve(copy.destination);
    if (destination === null || destination.state === "missing") continue;
    out.push({
      origin: copy.origin,
      reader: createFolderReader(destination.path),
      head: copy.record.source.head,
      cursor: useStoredCursor
        ? sourceCursor(deps.sql, me, app, copy.origin)
        : 0,
    });
  }
  return out;
}

function savePeerResults(
  deps: FolderAppsDeps,
  me: Id<"mch">,
  app: Id<"app">,
  results: readonly PeerSourceResult[],
): void {
  const at = deps.clock.now();
  for (const one of results) {
    if (one.cursor > 0) {
      setSourceRead(
        deps.sql,
        { machine: me, app, origin: one.origin },
        { cursor: one.cursor, at },
      );
    }
  }
}

export async function takeIn(
  deps: FolderAppsDeps,
  host: FolderAppsHost,
  input: TakeInInput,
): Promise<Result<TakeInOutput>> {
  const me = deps.machine();
  const app = input.app as Id<"app">;
  const copies = deps.records().filter((copy) => copy.origin !== me);
  const found = pickRecord(copies, app, input.from as Id<"mch"> | undefined);
  if (found === null) {
    return err({
      code: "not_found",
      message: "the app is not in a sync folder",
    });
  }
  const { record } = found;
  const commit = input.release ?? record.active_release?.code_commit;
  if (commit === undefined) {
    return err({
      code: "not_found",
      message: "the app has no active release in the sync folder",
    });
  }
  const local = host.app(app);
  if (!local.ok) return local;
  if (local.value !== null) {
    const existing = host.releaseWithCommit(app, commit);
    if (!existing.ok) return existing;
    if (existing.value !== null) {
      return ok({
        app,
        release: existing.value,
        source_path: local.value.source_path,
        installed: "existing",
      });
    }
  }
  const destination = deps.destinations.resolve(found.destination);
  if (destination === null) {
    return err({
      code: "not_found",
      message: `the sync folder "${found.destination}" is not set on this machine`,
    });
  }

  let sourcePath = local.value?.source_path ?? null;
  if (local.value === null) {
    const owner = host.slugOwner(record.slug);
    if (!owner.ok) return owner;
    if (owner.value !== null) {
      return conflict(`the slug ${record.slug} is used by another app here`, {
        reason: "slug_in_use",
        app: owner.value,
      });
    }
    const repo = await createRepository({
      dataRoot: deps.dataRoot,
      app,
      peers: peersFor(deps, copies, app, me, false),
      commit,
      random: deps.random,
      beforeFinalize: (dir) =>
        checkCommitDependencies(dir, commit, deps.dataRoot, host),
    });
    if (!repo.ok) return repo;
    if (repo.value === null) {
      return incomplete(
        `source commit ${commit.slice(0, 7)} has not arrived in the sync folder yet`,
      );
    }
    const created = await host.createApp({
      id: app,
      slug: record.slug,
      name: record.name,
      description: record.description,
    });
    if (!created.ok) return created;
    const linked = await host.connectSource(
      app,
      created.value.revision,
      repo.value.path,
    );
    if (!linked.ok) return linked;
    sourcePath = repo.value.path;
    savePeerResults(deps, me, app, repo.value.results);
  } else if (sourcePath === null) {
    const repo = await createRepository({
      dataRoot: deps.dataRoot,
      app,
      peers: peersFor(deps, copies, app, me, false),
      commit,
      random: deps.random,
      beforeFinalize: (dir) =>
        checkCommitDependencies(dir, commit, deps.dataRoot, host),
    });
    if (!repo.ok) return repo;
    if (repo.value === null) {
      return incomplete(
        `source commit ${commit.slice(0, 7)} has not arrived in the sync folder yet`,
      );
    }
    const linked = await host.connectSource(
      app,
      local.value.revision,
      repo.value.path,
    );
    if (!linked.ok) return linked;
    sourcePath = repo.value.path;
    savePeerResults(deps, me, app, repo.value.results);
  } else {
    if (!(await hasCommit(sourcePath, commit))) {
      const results = await fetchPeerSources({
        repo: sourcePath,
        app,
        peers: peersFor(deps, copies, app, me, true),
        dataRoot: deps.dataRoot,
        random: deps.random,
      });
      savePeerResults(deps, me, app, results);
      if (!(await hasCommit(sourcePath, commit))) {
        return incomplete(
          `source commit ${commit.slice(0, 7)} has not arrived in the sync folder yet`,
        );
      }
    }
    const checked = await checkCommitDependencies(
      sourcePath,
      commit,
      deps.dataRoot,
      host,
    );
    if (!checked.ok) return checked;
  }

  const prepared = await host.prepareRelease({ app, sourcePath, commit });
  if (!prepared.ok) {
    // 앱 등록과 release 준비는 따로 commit된다. 앱만 남았으면 다시 take-in이 release만 준비해 고친다.
    if (local.value !== null) return prepared;
    return err({
      ...prepared.error,
      message: `${prepared.error.message}. The app was added without a release; take it in again to prepare only the release.`,
    });
  }
  return ok({
    app,
    release: prepared.value,
    source_path: sourcePath,
    installed: local.value === null ? "app_and_release" : "release",
  });
}

export type AvailableApp = {
  app: Id<"app">;
  name: string;
  slug: string;
  machine: Id<"mch">;
  release: {
    code_commit: string;
    data_schema: number;
    created_at: string;
  } | null;
};

/**
 * 다른 기계가 내놓았고 이 기계에 아직 없는 앱. 앱마다 기록이 가장 최근인 기계의 것 하나. take-in이 앱을 만든 뒤 release
 * 준비에 실패해 release가 하나도 없는 앱도 든다: 다시 take-in하면 release만 준비한다.
 */
export function available(
  deps: FolderAppsDeps,
  host: FolderAppsHost,
): Result<AvailableApp[]> {
  const me = deps.machine();
  const copies = deps.records().filter((copy) => copy.origin !== me);
  const out: AvailableApp[] = [];
  for (const app of new Set(
    copies.map((copy) => copy.record.app as Id<"app">),
  )) {
    const local = host.app(app);
    if (!local.ok) return local;
    if (local.value !== null && local.value.code_commit !== null) continue;
    const { origin, record } = pickRecord(copies, app)!;
    out.push({
      app,
      name: record.name,
      slug: record.slug,
      machine: origin,
      release:
        record.active_release === null
          ? null
          : {
              code_commit: record.active_release.code_commit,
              data_schema: record.active_release.data_schema,
              created_at: record.active_release.created_at,
            },
    });
  }
  return ok(out.sort((a, b) => (a.app < b.app ? -1 : 1)));
}
