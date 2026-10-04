import {
  CATALOG_REFRESH_INTERVAL_MS,
  type CatalogEntry,
  catalogEntryOutputSchema,
  type CatalogState,
  modelCatalogRead,
} from "../../../contracts/lophn-agent/mod.ts";
import type { Result } from "../../../base/mod.ts";
import { err, ok } from "../../../base/mod.ts";
import type {
  Input,
  Output,
  ReadSnapshot,
  RequestContext,
} from "../../../contracts/platform/mod.ts";
import { parseActor } from "../../../contracts/platform/mod.ts";
import {
  type CatalogLayers,
  type EntryIdentity,
  entryKey,
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
export type SnapshotEntry = CatalogEntry;

// catalog와 state의 최신 자료. snapshot_hash가 두 파일의 연결 근거다.
export type CatalogStore = {
  entries: CatalogEntry[];
  state: CatalogState;
};

// 시각·network·파일 시스템은 인자로 받는다. 테스트에서 끼운다.
export type CatalogClock = { nowMs(): number };
export type SnapshotLoader = () => Promise<CatalogEntry[]>;

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
  fetch?: HttpFetch;
};

const DEFAULT_FILES: FilesLike = {
  readTextFile: (path) => Deno.readTextFile(path),
  writeTextFile: (path, text, options) =>
    Deno.writeTextFile(path, text, options),
  rename: (from, to) => Deno.rename(from, to),
  remove: (path) => Deno.remove(path),
  mkdir: (path, options) => Deno.mkdir(path, options),
};

export function catalogPaths(dataRoot: string): {
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

// 갱신은 run을 막지 않는 single-flight다. 진행 중 요청은 같은 진행을 기다린다(plan 완료 2).
export type CatalogRefresher = {
  // 저장된 catalog와 state를 읽는다. 파일이 없으면 동봉 snapshot에서 다시 만든다(plan 완료 1).
  load(): Promise<Result<CatalogStore>>;
  // 마지막 확인 뒤 24시간이 지났으면 비동기로 갱신을 시작한다. 기다리지 않는다(R4).
  kickAutoUpdate(): void;
  // 사람의 즉시 새로 받기. TTL을 건너뛰되 검증과 개인 자료 규칙은 유지한다(R4, R6).
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
      layers.models_dev = entries.filter((entry) => entry.source !== "user");
      layers.user = entries.filter((entry) => entry.source === "user");
    } catch {
      // catalog 파일이 없으면 snapshot에서 다시 만든다(plan 완료 1).
      return ok(layers);
    }
    return ok(layers);
  }

  async function rebuildFromSnapshot(): Promise<Result<CatalogStore>> {
    const snapshot = await input.loadSnapshot();
    // snapshot 전체 검증(R5). 동봉 자료도 예외가 아니다.
    const validated = validateCatalogResponse(snapshot);
    if (!validated.ok) return validated;
    const entries = validated.value;
    const hash = await hashEntries(entries);
    // 복구 시점을 마지막 확인으로 둔다. 재복구 직후의 중복 갱신을 막는다(R4).
    const state = stateAfterChecked(
      initialState(true, hash),
      input.clock.nowMs(),
    );
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
    if (
      layered.value.models_dev.length === 0 && layered.value.user.length === 0
    ) {
      const rebuilt = await rebuildFromSnapshot();
      if (!rebuilt.ok) return rebuilt;
      cached = rebuilt.value;
      return ok(cached);
    }
    if (state === undefined) {
      // state 파일만 깨졌으면 catalog 자료를 유지하고 hash를 다시 저장한다.
      const hash = await hashEntries(mergeCatalogLayers(layered.value));
      const at = input.clock.nowMs();
      const next = stateAfterChecked(initialState(true, hash), at);
      return ok({ entries: mergeCatalogLayers(layered.value), state: next });
    }
    return ok({ entries: mergeCatalogLayers(layered.value), state });
  }

  async function writeAtomic(
    path: string,
    text: string,
  ): Promise<Result<void>> {
    const temporary = `${path}.tmp`;
    try {
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
    const etag = current.value.entries.length > 0
      ? current.value.state.etag
      : null;
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
    // JSON 해석을 먼저 하고, 실패면 전체 거절이다(R5).
    const bodyParsed = validateCatalogBody(result.body);
    if (!bodyParsed.ok) {
      const next = stateAfterFailure(current.value.state, "invalid_input");
      const written = await persist(current.value.entries, next);
      if (!written.ok) return written;
      cached = { entries: current.value.entries, state: next };
      return ok(cached!);
    }
    const incoming = bodyParsed.value;
    // 항목 schema·값 검증을 마친 뒤에만 교체한다(R5). 한 항목이라도 넘지 못하면
    // 전체를 거절하고 마지막 정상본을 유지한다.
    const validated = validateCatalogResponse(incoming);
    if (!validated.ok) {
      const next = stateAfterFailure(current.value.state, "invalid_input");
      const written = await persist(current.value.entries, next);
      if (!written.ok) return written;
      cached = { entries: current.value.entries, state: next };
      return ok(cached!);
    }
    // models_dev 층 교체는 accepted response 한 번으로 모델·provider·가격을 함께 바꾼다(R4).
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
    kickAutoUpdate() {
      // 이미 진행 중이면 새 요청을 만들지 않는다(single-flight).
      if (inFlight !== undefined) return;
      void load().then((loaded) => {
        if (!loaded.ok) return;
        if (!refreshDueAt(loaded.value.state, input.clock.nowMs())) return;
        inFlight = runRefresh().finally(() => {
          inFlight = undefined;
        });
      });
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

// 갱신 시점 판정(24시간). 마지막 확인이 없으면 갱신한다(R4).
export function refreshDueAt(
  state: CatalogState,
  nowMs: number,
): boolean {
  if (!state.auto_update) return false;
  if (state.last_checked_at === null) return true;
  return nowMs - Date.parse(state.last_checked_at) >=
    CATALOG_REFRESH_INTERVAL_MS;
}

// 동기 파일 읽기. read handler는 Promise를 돌려주지 않으므로 core read는 이것으로
// derived 파일을 읽는다(architecture §5.3).
export type SyncFiles = { readTextFile(path: string): string };

export type CatalogReadDeps = {
  // derived catalog 파일의 sync reader. core 조립이 root와 함께 끼운다.
  files: SyncFiles;
  loadSnapshot: () => CatalogEntry[];
};

// catalog의 read 정의. derived 파일을 읽고, 정상 파일이 없으면 동봉 snapshot에서
// 다시 만든다(plan 완료 1). refresh는 runtime 작업이므로 read는 여기 없다.
export function createCatalogRead(deps?: Partial<CatalogReadDeps>) {
  const files = deps?.files as SyncFiles | undefined;
  return {
    route: modelCatalogRead,
    handle(
      snapshot: ReadSnapshot,
      ctx: RequestContext,
      input: Input<typeof modelCatalogRead>,
    ) {
      if (typeof files?.readTextFile !== "function") {
        return err({
          code: "unavailable",
          message: "catalog read 파일 reader가 없다",
        });
      }
      const actor = parseActor(ctx.actor);
      if (
        actor === undefined || !modelCatalogRead.actors.includes(actor.kind)
      ) {
        return err({
          code: "forbidden",
          message: "catalog read actor 아니다",
        });
      }
      let catalog: CatalogEntry[];
      let state: CatalogState;
      try {
        catalog = parseEntries(files.readTextFile("catalog.json")) ?? [];
        state = parseState(files.readTextFile("catalog-state.json")) ??
          undefined as unknown as CatalogState;
      } catch {
        return err({
          code: "unavailable",
          message: "catalog 파일을 읽지 못했다",
        });
      }
      if (!state) {
        // 정상 파일이 없으면 동봉 snapshot에서 다시 만든다(plan 완료 1).
        const snapshotLoader = deps?.loadSnapshot;
        if (typeof snapshotLoader !== "function") {
          return err({
            code: "unavailable",
            message: "catalog가 준비되지 않았다",
          });
        }
        const fallback = snapshotLoader();
        const validated = validateCatalogResponse(fallback);
        if (!validated.ok) return validated;
        catalog = validated.value;
      }
      const visible = catalog.filter((entry) =>
        (input.provider_definition === undefined ||
          entry.provider_definition === input.provider_definition) &&
        (input.model_name === undefined ||
          entry.model_name === input.model_name)
      );
      const views: Output<typeof modelCatalogRead>["entries"] = [];
      for (const entry of visible) {
        const checked = catalogEntryOutputSchema.safeParse(entry);
        if (!checked.success) {
          return err({
            code: "internal",
            message: "catalog 항목이 올바르지 않다",
          });
        }
        views.push(checked.data);
      }
      return ok({
        state,
        entries: views,
        as_of_seq: snapshot.as_of_seq,
        next_cursor: null,
      });
    },
  };
}

export {
  entryKey,
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
export type { CatalogLayers, EntryIdentity };
