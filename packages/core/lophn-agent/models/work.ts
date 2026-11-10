import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import {
  CATALOG_REFRESH_INTERVAL_MS,
  type CatalogEntry,
  catalogEntryOutputSchema,
  type CatalogState,
  modelCatalogRead,
} from "../../../protocol/lophn-agent/mod.ts";
import type { Result } from "../../../base/mod.ts";
import { err, formatAt, ok } from "../../../base/mod.ts";
import type {
  Input,
  Output,
  ReadDefinition,
  ReadSnapshot,
  RequestContext,
} from "../../../protocol/server/mod.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import {
  type CatalogLayers,
  hashEntries,
  initialState,
  mergeCatalogLayers,
  parseEntries,
  parseState,
  stateAfterChecked,
  stateAfterFailure,
  stateAfterReceived,
  validateCatalogResponse,
} from "./model.ts";
import {
  fetchCatalog,
  type HttpFetch,
  parseCatalogBody as validateCatalogBody,
} from "./adapters/models-dev.ts";

export { CATALOG_REFRESH_INTERVAL_MS };

// 동봉 snapshot. 항목 모양은 models.dev 해석 결과와 같다.

// catalog와 state의 최신 자료. snapshot_hash가 두 파일의 연결 근거다.
type CatalogStore = {
  entries: CatalogEntry[];
  state: CatalogState;
};

// 시각·network·파일 시스템은 인자로 받는다. 테스트에서 끼운다.
type CatalogClock = { nowMs(): number };
type SnapshotLoader = () => Promise<CatalogEntry[]>;

export type FilesLike = {
  readTextFile(path: string): Promise<string>;
  writeTextFile(
    path: string,
    text: string,
    options?: { mode?: number },
  ): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
};

export type CatalogWorkInput = {
  dataRoot: string;
  clock: CatalogClock;
  files: FilesLike;
  loadSnapshot: SnapshotLoader;
  // 설정 `lophn-agent.model.catalog_auto_update`의 값. 설정이 정본이고 state 파일의 auto_update는 이것을 따른다.
  autoUpdate: boolean;
  fetch?: HttpFetch;
};

const DEFAULT_FILES: FilesLike = {
  readTextFile: (path) => readFile(path, "utf8"),
  writeTextFile: (path, text, options) => writeFile(path, text, options),
  rename: (from, to) => rename(from, to),
  remove: (path) => rm(path),
  mkdir: async (path, options) => {
    await mkdir(path, options);
  },
};

function catalogPaths(dataRoot: string): {
  directory: string;
  catalog: string;
  state: string;
} {
  const directory = `${dataRoot}/derived/lophn-agent`;
  return {
    directory,
    catalog: `${directory}/catalog.json`,
    state: `${directory}/catalog-state.json`,
  };
}

// 갱신은 turn을 막지 않는 single-flight다. 진행 중 요청은 같은 진행을 기다린다(plan 완료 2).
export type CatalogRefresher = {
  // 저장된 catalog와 state를 읽는다. 파일이 없으면 동봉 snapshot에서 다시 만든다(plan 완료 1).
  load(): Promise<Result<CatalogStore>>;
  // 마지막 확인 뒤 CATALOG_REFRESH_INTERVAL_MS가 지났으면 갱신을 시작한다.
  // 시작한 갱신이 끝나면 풀린다. 갱신하지 않으면 바로 풀린다.
  kickAutoUpdate(): Promise<void>;
  // 사람의 즉시 새로 받기. TTL을 건너뛰되 검증과 개인 자료 규칙은 유지한다.
  refreshNow(): Promise<Result<CatalogStore>>;
};

export function createCatalogRefresher(
  input: CatalogWorkInput,
): CatalogRefresher {
  const files = input.files ?? DEFAULT_FILES;
  const paths = catalogPaths(input.dataRoot);
  // single-flight 락. 갱신은 하나만 진행한다.
  let inFlight: Promise<Result<CatalogStore>> | undefined;
  let cached: CatalogStore | undefined;

  async function readLayeredFromDisk(): Promise<Result<CatalogLayers>> {
    const layers = {
      release_snapshot: [],
      models_dev: [],
      lophn_patch: [],
      user: [],
    } as CatalogLayers;
    try {
      const text = await files.readTextFile(paths.catalog);
      const entries = parseEntries(text);
      if (entries === undefined) {
        // 깨진 catalog 파일은 갱신 전체 거절 사유가 아니라 snapshot 복구 대상이다.
        return ok(layers);
      }
      layers.models_dev = entries;
    } catch {
      // catalog 파일이 없으면 snapshot에서 다시 만든다(plan 완료 1).
      return ok(layers);
    }
    return ok(layers);
  }

  async function rebuildFromSnapshot(): Promise<Result<CatalogStore>> {
    const snapshot = await input.loadSnapshot();
    // snapshot 전체 검증. 동봉 자료도 예외가 아니다.
    const validated = validateCatalogResponse(snapshot);
    if (!validated.ok) return validated;
    const entries = validated.value;
    const hash = await hashEntries(entries);
    // 마지막 확인은 비워 둔다. 새 data root가 주기를 기다리지 않고 바로 갱신해야 한다.
    const state = initialState(input.autoUpdate, hash);
    // state만 쓰면 다음 load가 catalog가 비어 있어 state를 무시한다. 둘을 함께 쓴다.
    // 쓰지 못해도 메모리 값으로 계속 간다.
    await persist(entries, state);
    return ok({ entries, state });
  }

  async function load(): Promise<Result<CatalogStore>> {
    if (cached !== undefined) return ok(cached);
    const layered = await readLayeredFromDisk();
    if (!layered.ok) return layered;
    let state: CatalogState | undefined;
    try {
      state = parseState(await files.readTextFile(paths.state));
    } catch {
      state = undefined;
    }
    if (layered.value.models_dev.length === 0) {
      const rebuilt = await rebuildFromSnapshot();
      if (!rebuilt.ok) return rebuilt;
      cached = rebuilt.value;
      return ok(cached);
    }
    if (state === undefined) {
      // state 파일만 깨졌으면 catalog 자료를 유지하고 hash를 다시 저장한다.
      const hash = await hashEntries(mergeCatalogLayers(layered.value));
      const at = input.clock.nowMs();
      const next = stateAfterChecked(initialState(input.autoUpdate, hash), at);
      const entries = mergeCatalogLayers(layered.value);
      await persist(entries, next);
      return ok({ entries, state: next });
    }
    const entries = mergeCatalogLayers(layered.value);
    if (state.auto_update !== input.autoUpdate) {
      const next = { ...state, auto_update: input.autoUpdate };
      await writeAtomic(paths.state, JSON.stringify(next, null, 2));
      return ok({ entries, state: next });
    }
    return ok({ entries, state });
  }

  async function writeAtomic(
    path: string,
    text: string,
  ): Promise<Result<void>> {
    const temporary = `${path}.tmp`;
    try {
      // derived/lophn-agent를 만드는 곳이 따로 없다.
      await files.mkdir(paths.directory, { recursive: true });
      await files.writeTextFile(temporary, text, { mode: 0o600 });
      await files.rename(temporary, path);
      return ok(undefined);
    } catch {
      return err({ code: "unavailable", message: "catalog를 쓸 수 없다" });
    }
  }

  async function persist(
    entries: CatalogEntry[],
    state: CatalogState,
  ): Promise<Result<void>> {
    const written = await writeAtomic(
      paths.catalog,
      JSON.stringify(entries, null, 2),
    );
    if (!written.ok) return written;
    return await writeAtomic(paths.state, JSON.stringify(state, null, 2));
  }

  async function runRefresh(): Promise<Result<CatalogStore>> {
    const current = await load();
    if (!current.ok) return current;
    if (!input.fetch) {
      // 테스트 주입이 없으면 network을 만지지 않는다. 정상본을 그대로 돌려준다.
      return current;
    }
    const nowMs = input.clock.nowMs();
    // servable catalog가 있을 때만 조건부 GET을 보낸다. 없으면 ETag 없이 받는다.
    const etag =
      current.value.entries.length > 0 ? current.value.state.etag : null;
    const result = await fetchCatalog(etag, input.fetch);
    if (result.kind === "unchanged") {
      const next = stateAfterChecked(current.value.state, nowMs);
      const written = await persist(current.value.entries, next);
      if (!written.ok) return written;
      cached = { entries: current.value.entries, state: next };
      return ok(cached!);
    }
    if (result.kind === "failed") {
      const next = stateAfterFailure(current.value.state, result.code);
      const written = await persist(current.value.entries, next);
      if (!written.ok) return written;
      cached = { entries: current.value.entries, state: next };
      return ok(cached!);
    }
    // JSON 해석을 먼저 하고, 실패면 전체 거절이다.
    const bodyParsed = validateCatalogBody(result.body, formatAt(nowMs));
    if (!bodyParsed.ok) {
      const next = stateAfterFailure(current.value.state, "invalid_input");
      const written = await persist(current.value.entries, next);
      if (!written.ok) return written;
      cached = { entries: current.value.entries, state: next };
      return ok(cached!);
    }
    const incoming = bodyParsed.value;
    // 항목 schema·값 검증을 마친 뒤에만 교체한다. 한 항목이라도 넘지 못하면
    // 전체를 거절하고 마지막 정상본을 유지한다.
    const validated = validateCatalogResponse(incoming);
    if (!validated.ok) {
      const next = stateAfterFailure(current.value.state, "invalid_input");
      const written = await persist(current.value.entries, next);
      if (!written.ok) return written;
      cached = { entries: current.value.entries, state: next };
      return ok(cached!);
    }
    // models_dev 층 교체는 accepted response 한 번으로 모델·provider·가격을 함께 바꾼다.
    const layered = await readLayeredFromDisk();
    if (!layered.ok) return layered;
    const merged = mergeCatalogLayers({
      ...layered.value,
      models_dev: validated.value,
    });
    const hash = await hashEntries(merged);
    const next = stateAfterReceived(
      current.value.state,
      nowMs,
      result.etag,
      hash,
    );
    const written = await persist(merged, next);
    if (!written.ok) return written;
    cached = { entries: merged, state: next };
    return ok(cached!);
  }

  return {
    async load() {
      return await load();
    },
    async kickAutoUpdate() {
      // 이미 진행 중이면 새 요청을 만들지 않고 그 진행을 기다린다(single-flight).
      if (inFlight === undefined) {
        const loaded = await load();
        if (!loaded.ok) return;
        if (!refreshDueAt(loaded.value.state, input.clock.nowMs())) return;
        inFlight ??= runRefresh().finally(() => {
          inFlight = undefined;
        });
      }
      await inFlight;
    },
    async refreshNow() {
      if (inFlight !== undefined) return await inFlight;
      inFlight = runRefresh().finally(() => {
        inFlight = undefined;
      });
      return await inFlight;
    },
  };
}

// 갱신 시점 판정. 마지막 확인이 없으면 갱신한다.
function refreshDueAt(state: CatalogState, nowMs: number): boolean {
  if (!state.auto_update) return false;
  if (state.last_checked_at === null) return true;
  return (
    nowMs - Date.parse(state.last_checked_at) >= CATALOG_REFRESH_INTERVAL_MS
  );
}

// read 응답 한도(READ_MAX_ROWS 500) 안에 두는 한 page의 row 예산이다. 중첩 배열의 항목도 row로 센다.
const CATALOG_PAGE_ROWS = 400;

function countRows(value: unknown): number {
  if (Array.isArray(value)) {
    return value.length + value.reduce((sum, item) => sum + countRows(item), 0);
  }
  if (value !== null && typeof value === "object") {
    return Object.values(value).reduce<number>(
      (sum, item) => sum + countRows(item),
      0,
    );
  }
  return 0;
}

type CatalogReadDeps = {
  // derived 파일(catalog.json, catalog-state.json)의 동기 reader다. 파일이 없으면 null이다.
  // read handler는 Promise를 돌려주지 않고 core graph는 동기 file API를 못 쓰므로 조립이 끼운다.
  readDerived(sql: ReadSnapshot["sql"], name: string): string | null;
  // 동봉 snapshot과 그 hash다. 정상 파일이 없을 때의 답이다.
  snapshot: { entries: CatalogEntry[]; hash: string };
  // 사람이 적은 model 정보(user 층)다. 같은 열쇠의 catalog 항목을 이긴다. derived 파일에는 쓰지 않는다.
  userEntries(sql: ReadSnapshot["sql"]): CatalogEntry[];
};

// derived 파일을 읽고, 없거나 깨졌으면 동봉 snapshot을 쓴다. catalog 읽기와 저장 검사가 같은 바탕을 본다.
// 저장 검사가 snapshot만 보면 갱신으로 들어온 model의 option 값을 모두 거절한다.
export function catalogBase(
  deps: Pick<CatalogReadDeps, "readDerived" | "snapshot">,
  sql: ReadSnapshot["sql"],
): { catalog: CatalogEntry[]; state: CatalogState } {
  try {
    const catalogText = deps.readDerived(sql, "catalog.json");
    const stateText = deps.readDerived(sql, "catalog-state.json");
    if (catalogText !== null && stateText !== null) {
      const catalog = parseEntries(catalogText);
      const state = parseState(stateText);
      if (catalog !== undefined && state !== undefined) {
        return { catalog, state };
      }
    }
  } catch {
    // 읽지 못한 파일은 없는 것과 같이 snapshot으로 답한다.
  }
  return {
    catalog: deps.snapshot.entries,
    state: initialState(true, deps.snapshot.hash),
  };
}

// catalog의 read 정의. refresh는 runtime 작업이므로 read는 여기 없다.
export function createCatalogRead(
  deps: CatalogReadDeps,
): ReadDefinition<typeof modelCatalogRead> {
  return {
    route: modelCatalogRead,
    handle(
      snapshot: ReadSnapshot,
      ctx: RequestContext,
      input: Input<typeof modelCatalogRead>,
    ): Result<Output<typeof modelCatalogRead>> {
      const actor = parseActor(ctx.actor);
      if (
        actor === undefined ||
        !modelCatalogRead.actors.includes(actor.kind)
      ) {
        return err({
          code: "forbidden",
          message: "catalog read actor 아니다",
        });
      }
      const { catalog, state } = catalogBase(deps, snapshot.sql);
      // user 층이 같은 열쇠의 항목을 이긴다. 나머지 항목의 순서는 그대로 둔다(cursor가 위치다).
      const typed = deps.userEntries(snapshot.sql);
      const typedKeys = new Set(
        typed.map(
          (entry) => `${entry.provider_definition}\u0000${entry.model_name}`,
        ),
      );
      const merged = [
        ...catalog.filter(
          (entry) =>
            !typedKeys.has(
              `${entry.provider_definition}\u0000${entry.model_name}`,
            ),
        ),
        ...typed,
      ];
      const visible = merged.filter(
        (entry) =>
          (input.provider_definition === undefined ||
            entry.provider_definition === input.provider_definition) &&
          (input.model_name === undefined ||
            entry.model_name === input.model_name),
      );
      // catalog 전체는 read 응답 한도(500 row)를 크게 넘으므로 항목을 row 예산만큼 끊어 cursor로 잇는다.
      // cursor는 필터를 거친 목록의 위치다. 필터는 매 요청이 같이 보낸다.
      const start = input.cursor === undefined ? 0 : Number(input.cursor);
      if (!Number.isSafeInteger(start) || start < 0) {
        return err({
          code: "invalid_input",
          message: "cursor가 올바르지 않다",
        });
      }
      const views: Output<typeof modelCatalogRead>["entries"] = [];
      let rows = 0;
      let next = start;
      for (; next < visible.length; next += 1) {
        const checked = catalogEntryOutputSchema.safeParse(visible[next]);
        if (!checked.success) {
          return err({
            code: "internal",
            message: "catalog 항목이 올바르지 않다",
          });
        }
        const cost = 1 + countRows(checked.data);
        if (views.length > 0 && rows + cost > CATALOG_PAGE_ROWS) break;
        rows += cost;
        views.push(checked.data);
      }
      return ok({
        state,
        entries: views,
        as_of_seq: snapshot.as_of_seq,
        next_cursor: next < visible.length ? String(next) : null,
      });
    },
  };
}

export {
  hashEntries,
  initialState,
  mergeCatalogLayers,
  parseEntries,
  parseState,
  stateAfterChecked,
  stateAfterFailure,
  stateAfterReceived,
  validateCatalogResponse,
};
export type { CatalogLayers };
