// 두 번째 기계가 앱을 받는 길. 컴퓨터는 `sync_to`가 있는 앱의 앱 기록과 source git bundle을 자기 하위 폴더에
// 쓰고, 다른 기계의 source bundle을 `refs/remotes/<mch>/*`로 받고, 폴더의 앱을 같은 id로 들여 local에서 release를 준비한다(take-in).
// 계기(언제 부르나)와 route 등록은 조립(`folder-surface`)이 한다.
import { err, ok, type Result } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type {
  TakeInInput,
  TakeInOutput,
} from "../../../protocol/folder/take-in.ts";
import { createFolderReader, createFolderWriter } from "../fs.ts";
import type { FolderAppsDeps } from "./deps.ts";
import { exportPackages } from "./packages.ts";
import { writeAppRecord } from "./records.ts";
import {
  createRepository,
  exportSource,
  fetchPeerSources,
  type PeerSource,
} from "./source.ts";
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
  LocalApp,
} from "./deps.ts";
export type { AvailableApp } from "./take-in.ts";

export type FolderApps = {
  /** 그 앱의 source bundle(branch가 바뀌었을 때만)과 `app.json`(바뀌었을 때만)을 쓴다. */
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
      // source가 실패해도 앱 기록과 data 내보내기는 막지 않는다. 그 앱의 오류로 남긴다.
      const source = await exportSource(target);
      if (source.ok) clearStreamError(deps.sql, { ...key, stream: "source" });
      else {
        setStreamError(
          deps.sql,
          { ...key, stream: "source" },
          { ...source.error, at: now() },
        );
        first = err({ code: "unavailable", message: source.error.message });
      }
      // package file도 앱 기록과 같이 막지 않는다. 실패는 다음 계기에 다시 시도한다.
      const packages = await exportPackages(target, host);
      if (!packages.ok && first.ok) {
        first = err({ code: "unavailable", message: packages.error.message });
      }
      const record = await writeAppRecord(target, deps.progress(id));
      if (!record.ok) return record;
      return first;
    },

    async importSource(id) {
      const local = host.app(id);
      if (!local.ok) return local;
      if (local.value === null) return ok(undefined);
      const me = deps.machine();
      let repo = local.value.source_path;
      const copies = deps
        .records()
        .filter((copy) => copy.record.app === id && copy.origin !== me)
        .sort((a, b) => (a.origin < b.origin ? -1 : 1));
      const peers: PeerSource[] = [];
      for (const { origin, destination: name, record } of copies) {
        const destination = deps.destinations.resolve(name);
        if (destination === null || destination.state === "missing") continue;
        peers.push({
          origin,
          reader: createFolderReader(destination.path),
          head: record.source.head,
          cursor: sourceCursor(deps.sql, me, id, origin),
        });
      }
      if (peers.length === 0) return ok(undefined);
      if (repo === null) {
        if (local.value.code_commit === null) return ok(undefined);
        const made = await createRepository({
          dataRoot: deps.dataRoot,
          app: id,
          peers,
          commit: local.value.code_commit,
          random: deps.random,
        });
        if (!made.ok) {
          for (const peer of peers) {
            setSourceRead(
              deps.sql,
              { machine: me, app: id, origin: peer.origin },
              {
                error: {
                  code: "source_failed",
                  message: made.error.message,
                  at: now(),
                },
              },
            );
          }
          return made;
        }
        if (made.value === null) return ok(undefined);
        const linked = await host.connectSource(
          id,
          local.value.revision,
          made.value.path,
        );
        if (!linked.ok) return linked;
        repo = made.value.path;
        for (const result of made.value.results) {
          setSourceRead(
            deps.sql,
            { machine: me, app: id, origin: result.origin },
            { cursor: result.cursor, at: now() },
          );
        }
      }
      let first: Result<void> = ok(undefined);
      const results = await fetchPeerSources({
        repo,
        app: id,
        peers: peers.map((peer) => ({
          ...peer,
          cursor: sourceCursor(deps.sql, me, id, peer.origin),
        })),
        dataRoot: deps.dataRoot,
        random: deps.random,
      });
      for (const result of results) {
        const key = { machine: me, app: id, origin: result.origin };
        setSourceRead(deps.sql, key, { cursor: result.cursor, at: now() });
        if (result.stopped === null) continue;
        if ("waiting_for" in result.stopped) {
          setSourceRead(deps.sql, key, result.stopped);
        } else {
          const { error } = result.stopped;
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
