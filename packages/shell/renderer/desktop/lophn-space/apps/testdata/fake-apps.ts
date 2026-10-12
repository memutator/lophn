// apps 화면·앱 공간 테스트의 가짜 통로. core를 부르지 않고 부른 것을 기록한다.
import type { AppRow, AppsSource, RunState, SourceResult } from "../source.ts";

export const BUDGET = "app_01h455vb4pex5v6nkc6gd5fd01";
export const NOTES = "app_01h455vb4pex5v6nkc6gd5fd02";
export const OLD = "app_01h455vb4pex5v6nkc6gd5fd03";
export const BUDGET_RELEASE = "rel_01h455vb4pex5v6nkc6gd5fd01";

export function appRow(
  id: string,
  name: string,
  options: Partial<Omit<AppRow, "id" | "name">> = {},
): AppRow {
  return {
    id,
    name,
    archived: false,
    release: null,
    revision: "7",
    ...options,
  };
}

export interface FakeAppsOptions {
  rows?: readonly AppRow[];
  runs?: Readonly<Record<string, RunState>>;
  /** 앱 공간이 여는 화면. 없으면 unavailable이다. */
  screen?: string;
  listFails?: boolean;
  /** 보관·꺼내기 결과 code. 없으면 성공이다. */
  archiveCode?: string;
}

export function fakeApps(options: FakeAppsOptions = {}) {
  let rows = [...(options.rows ?? [])];
  const calls: unknown[][] = [];
  const source: AppsSource = {
    watch(listener) {
      listener({ state: "ready" });
      return () => {};
    },
    list() {
      calls.push(["list"]);
      return Promise.resolve(
        options.listFails
          ? { ok: false, code: "unavailable" }
          : { ok: true, value: rows },
      );
    },
    get(app) {
      calls.push(["get", app]);
      return Promise.resolve({
        ok: true,
        value: rows.find((row) => row.id === app) ?? null,
      });
    },
    runtime(app) {
      calls.push(["runtime", app]);
      const run = options.runs?.[app];
      return Promise.resolve(
        run ? { ok: true, value: run } : { ok: false, code: "unavailable" },
      );
    },
    setArchived(app, archived) {
      calls.push(["archive", app.id, archived, app.revision]);
      if (options.archiveCode) {
        return Promise.resolve({ ok: false, code: options.archiveCode });
      }
      const next: AppRow = {
        ...app,
        archived,
        revision: String(Number(app.revision) + 1),
      };
      rows = rows.map((row) => row.id === app.id ? next : row);
      return Promise.resolve({ ok: true, value: next });
    },
    entryScreen(app, release): Promise<SourceResult<string>> {
      calls.push(["entry", app, release]);
      return Promise.resolve(
        options.screen
          ? { ok: true, value: options.screen }
          : { ok: false, code: "unavailable" },
      );
    },
  };
  return { source, calls };
}
