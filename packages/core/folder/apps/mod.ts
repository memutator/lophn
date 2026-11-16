// 두 번째 기계가 앱을 받는 길. 컴퓨터는 `sync_to`가 있는 앱의 앱 기록, 활성 release, source bundle을 자기 하위 폴더에
// 쓰고, 다른 기계의 source bundle을 `refs/remotes/<mch>/*`로 받고, 폴더의 앱을 같은 id로 들인다(take-in).
// 계기(언제 부르나)와 route 등록은 조립(`folder-surface`)이 한다.
import { err, ok, type Result } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type {
  TakeInInput,
  TakeInOutput,
} from "../../../protocol/folder/take-in.ts";
import { createFolderReader, createFolderWriter } from "../fs.ts";
import type { FolderAppsDeps } from "./deps.ts";
import { writeAppRecord } from "./records.ts";
import { pruneReleases, writeActiveRelease } from "./releases.ts";
import { createRepository, exportSource, fetchSource } from "./source.ts";
import {
  clearStreamError,
  setSourceRead,
  setStreamError,
  sourceCursor,
} from "./state.ts";
import { type AvailableApp, available, takeIn } from "./take-in.ts";
import type { Target } from "./target.ts";

export type {
  FolderAppProgress,
  FolderAppRecordCopy,
  FolderAppsDeps,
  FolderAppsHost,
  FolderLocalApp,
  InstalledBundle,
  LocalApp,
} from "./deps.ts";
export type { AvailableApp } from "./take-in.ts";

export type FolderApps = {
  /** 그 앱의 release 폴더(없을 때만), source bundle(branch가 바뀌었을 때만), `app.json`(바뀌었을 때만)을 쓴다. */
  runApp(app: Id<"app">): Promise<Result<void>>;
  /** 다른 기계의 source bundle을 번호 순서로 검사하고 받는다. 이 기계에 source가 없으면 저장소를 만든다. */
  importSource(app: Id<"app">): Promise<Result<void>>;
  takeIn(input: TakeInInput): Promise<Result<TakeInOutput>>;
  available(): Result<AvailableApp[]>;
};

export function createFolderApps(deps: FolderAppsDeps): FolderApps {
  const { host } = deps;
  const now = () => deps.clock.now();

  return {
    async runApp(id) {
      const app = deps.apps().find((each) => each.app === id);
      if (app === undefined) return ok(undefined);
      const destination = deps.destinations.resolve(app.sync_to);
      // 이 기계에 그 이름이 없으면 이 기계에서 내보내지 않는다.
      if (destination === null) return ok(undefined);
      if (destination.state !== "ok") {
        return err({
          code: "unavailable",
          message: `the sync folder "${app.sync_to}" is ${destination.state}`,
        });
      }
      const me = deps.machine();
      const target: Target = {
        me,
        app,
        destination: app.sync_to,
        writer: createFolderWriter({
          root: destination.path,
          machine: me,
          random: deps.random,
        }),
        reader: createFolderReader(destination.path),
        sql: deps.sql,
        random: deps.random,
        dataRoot: deps.dataRoot,
        now,
        nowMs: () => deps.clock.nowMs(),
      };
      const key = { machine: me, app: id, destination: app.sync_to };
      let first: Result<void> = ok(undefined);
      const release = await writeActiveRelease(target);
      if (!release.ok) first = release;
      else {
        const pruned = await pruneReleases(target);
        if (!pruned.ok) first = pruned;
      }
      // source가 실패해도 앱 기록과 data 내보내기는 막지 않는다. 그 앱의 오류로 남긴다.
      const source = await exportSource(target);
      if (source.ok) clearStreamError(deps.sql, { ...key, stream: "source" });
      else {
        setStreamError(
          deps.sql,
          { ...key, stream: "source" },
          { ...source.error, at: now() },
        );
        if (first.ok) {
          first = err({ code: "unavailable", message: source.error.message });
        }
      }
      const record = await writeAppRecord(target, deps.progress(id));
      if (!record.ok) return record;
      // 앱 기록을 쓰면 app stream의 오류가 지워지므로 release 오류는 그 뒤에 남긴다.
      if (!release.ok) {
        setStreamError(
          deps.sql,
          { ...key, stream: "app" },
          {
            code: "release_incomplete",
            message: release.error.message,
            at: now(),
          },
        );
      }
      return first;
    },

    async importSource(id) {
      const local = host.app(id);
      if (!local.ok) return local;
      if (local.value === null) return ok(undefined);
      const me = deps.machine();
      let repo = local.value.source_path;
      let first: Result<void> = ok(undefined);
      const copies = deps
        .records()
        .filter((copy) => copy.record.app === id && copy.origin !== me)
        .sort((a, b) => (a.origin < b.origin ? -1 : 1));
      for (const { origin, destination: name, record } of copies) {
        const destination = deps.destinations.resolve(name);
        if (destination === null || destination.state === "missing") continue;
        const reader = createFolderReader(destination.path);
        const key = { machine: me, app: id, origin };
        if (repo === null) {
          if (local.value.code_commit === null) continue;
          const made = await createRepository({
            dataRoot: deps.dataRoot,
            app: id,
            origin,
            reader,
            head: record.source.head,
            commit: local.value.code_commit,
            random: deps.random,
          });
          if (!made.ok) {
            setSourceRead(deps.sql, key, {
              error: {
                code: "source_failed",
                message: made.error.message,
                at: now(),
              },
            });
            if (first.ok) first = made;
            continue;
          }
          if (made.value === null) continue;
          const linked = await host.connectSource(
            id,
            local.value.revision,
            made.value.path,
          );
          if (!linked.ok) return linked;
          repo = made.value.path;
          setSourceRead(deps.sql, key, {
            cursor: made.value.cursor,
            at: now(),
          });
        }
        const fetched = await fetchSource({
          repo,
          reader,
          origin,
          app: id,
          cursor: sourceCursor(deps.sql, me, id, origin),
          head: record.source.head,
          dataRoot: deps.dataRoot,
          random: deps.random,
        });
        setSourceRead(deps.sql, key, { cursor: fetched.cursor, at: now() });
        if (fetched.stopped === null) continue;
        if ("waiting_for" in fetched.stopped) {
          setSourceRead(deps.sql, key, fetched.stopped);
        } else {
          const { error } = fetched.stopped;
          setSourceRead(deps.sql, key, { error: { ...error, at: now() } });
          if (first.ok) {
            first = err({ code: "unavailable", message: error.message });
          }
        }
      }
      return first;
    },

    takeIn: (input) => takeIn(deps, host, input),
    available: () => available(deps, host),
  };
}
