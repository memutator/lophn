// 런처·앱 공간 테스트의 가짜 통로. core를 부르지 않고 부른 것을 기록한다.
import { newId } from "../../prefixed-id.ts";
import type { AppRow, AppsSource, RunState, SourceResult } from "../source.ts";

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

interface FakeAppsOptions {
  rows?: readonly AppRow[];
  runs?: Readonly<Record<string, RunState>>;
  /** 앱 공간이 여는 화면. 없으면 unavailable이다. */
  screen?: string;
  listFails?: boolean;
  /** 등록 결과 code. 없으면 성공이다. */
  createCode?: string;
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
    create(draft) {
      calls.push(["create", draft.name, draft.description]);
      if (options.createCode) {
        return Promise.resolve({ ok: false, code: options.createCode });
      }
      const row = appRow(newId("app"), draft.name);
      rows = [...rows, row];
      return Promise.resolve({ ok: true, value: row });
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

const GALLERY_IDS = [
  "app_01h455vb4pex5v6nkc6gd5fd11",
  "app_01h455vb4pex5v6nkc6gd5fd12",
  "app_01h455vb4pex5v6nkc6gd5fd13",
  "app_01h455vb4pex5v6nkc6gd5fd14",
  "app_01h455vb4pex5v6nkc6gd5fd15",
] as const;

/** 런처 gallery가 그리는 앱: 실행 중·멈춤·응답 없음과 보관 하나. */
export function galleryApps() {
  const [grocery, planner, reading, report, habit] = GALLERY_IDS;
  return fakeApps({
    rows: [
      appRow(grocery, "Grocery budget"),
      appRow(planner, "Quarter planner"),
      appRow(reading, "Reading list"),
      appRow(report, "Weekly report"),
      appRow(habit, "Habit tracker", { archived: true }),
    ],
    runs: {
      [grocery]: "running",
      [planner]: "stopped",
      [reading]: "running",
      [report]: "unavailable",
    },
  });
}
