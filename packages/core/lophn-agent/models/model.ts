import { sha256Hex } from "../../../base/mod.ts";
import {
  CATALOG_REFRESH_INTERVAL_MS,
  type CatalogEntry,
  catalogEntrySchema,
  type CatalogState,
  catalogStateSchema,
} from "../../../protocol/lophn-agent/mod.ts";
import { err, formatAt, ok, type Result } from "../../../base/mod.ts";

export { CATALOG_REFRESH_INTERVAL_MS };

// catalog 적용 순서(domain-model lophn-agent/harness/model "catalog 우선순위").
// release snapshot 위에 정상 갱신본을 겹치고 좁은 patch와 사람 보완이 그 위를 덮는다.
export const LAYER_ORDER = [
  "release_snapshot",
  "models_dev",
  "lophn_patch",
  "user",
] as const;
export type CatalogSource = (typeof LAYER_ORDER)[number];

export function layerRank(source: string): number {
  return LAYER_ORDER.indexOf(source as CatalogSource);
}

// model identity는 (provider_definition, model_name) 쌍이다. 같은 이름의
// 직접 제공처와 중계 제공처 항목은 별도 항목으로 유지한다(R1).
export type EntryIdentity = Readonly<{
  provider_definition: string;
  model_name: string;
}>;

export function entryKey(entry: EntryIdentity): string {
  return `${entry.provider_definition}\u0000${entry.model_name}`;
}

// 같은 identity의 항목이 여러 층에 있을 때 출처 등급이 높은 항목을 남긴다.
// 등급이 같으면 뒤의 것(나중에 적용된 층)을 남긴다(R3).
function preferred(previous: CatalogEntry, next: CatalogEntry): CatalogEntry {
  return layerRank(next.source) >= layerRank(previous.source) ? next : previous;
}

export function mergeEntries(
  entries: readonly (readonly CatalogEntry[])[],
): CatalogEntry[] {
  const merged = new Map<string, CatalogEntry>();
  for (const layer of entries) {
    for (const entry of layer) {
      const key = entryKey(entry);
      const previous = merged.get(key);
      merged.set(
        key,
        previous === undefined ? entry : preferred(previous, entry),
      );
    }
  }
  return [...merged.values()].sort((a, b) =>
    a.provider_definition.localeCompare(b.provider_definition) ||
    a.model_name.localeCompare(b.model_name)
  );
}

// 출처별로 분리해 둔 catalog 자료. 각 층은 파일로 유지하고 삭제해도
// snapshot에서 다시 만든다.
export type CatalogLayers = {
  release_snapshot: CatalogEntry[];
  models_dev: CatalogEntry[];
  lophn_patch: CatalogEntry[];
  user: CatalogEntry[];
};

export function emptyLayers(): CatalogLayers {
  return {
    release_snapshot: [],
    models_dev: [],
    lophn_patch: [],
    user: [],
  };
}

export function mergeCatalogLayers(layers: CatalogLayers): CatalogEntry[] {
  return mergeEntries([
    layers.release_snapshot,
    layers.models_dev,
    layers.lophn_patch,
    layers.user,
  ]);
}

// 사용자 보완이 덮을 수 있는 항목 필드. identity·출처·판은 보완 대상이 아니다(R3).
export const OVERRIDABLE_FIELDS = [
  "context_limit",
  "input_limit",
  "output_limit",
  "supports_tools",
  "input_media",
  "output_media",
  "options",
  "preview",
  "deprecated",
  "price_basis",
] as const;

export type UserPatch = Readonly<
  Partial<Pick<CatalogEntry, (typeof OVERRIDABLE_FIELDS)[number]>>
>;

// 사람 보완은 명시한 항목만 던다. patched 항목은 출처 user가 되지만
// 같은 identity의 하위 층 항목도 유지된다(R3, R13).
export function applyUserPatch(
  entry: CatalogEntry,
  patch: UserPatch,
  revision: string,
  at: string,
): CatalogEntry {
  const next: CatalogEntry = { ...entry };
  for (const field of OVERRIDABLE_FIELDS) {
    if (patch[field] !== undefined) {
      (next as Record<string, unknown>)[field] = patch[field];
    }
  }
  return {
    ...next,
    source: "user",
    source_revision: revision,
    checked_at: at,
    received_at: entry.received_at,
  };
}

// 갱신 목록의 항목 전체 검증(R5). 한 항목이라도 검증을 넘지 못하면 전체를 거절한다.
export function validateCatalogResponse(
  entries: readonly unknown[],
): Result<CatalogEntry[]> {
  if (entries.length === 0) {
    return err({ code: "invalid_input", message: "catalog 목록이 비어 있다" });
  }
  const parsed: CatalogEntry[] = [];
  for (const item of entries) {
    const checked = catalogEntrySchema.safeParse(item);
    if (!checked.success) {
      return err({
        code: "invalid_input",
        message: "catalog 항목이 올바르지 않다",
      });
    }
    parsed.push(checked.data);
  }
  const seen = new Set<string>();
  for (const entry of parsed) {
    const key = entryKey(entry);
    if (seen.has(key)) {
      return err({
        code: "invalid_input",
        message: "같은 model identity가 둘 이상 있다",
      });
    }
    seen.add(key);
    if (entry.price_basis !== null && entry.price_basis.rates.length === 0) {
      return err({ code: "invalid_input", message: "가격 구간이 비어 있다" });
    }
  }
  return ok(parsed);
}

// CatalogState 전이. checked_at은 확인 시각(304 포함), received_at은 정상 수신 시각(200)이다.

export function initialState(
  autoUpdate: boolean,
  snapshotHash: string,
): CatalogState {
  return {
    auto_update: autoUpdate,
    etag: null,
    last_checked_at: null,
    last_received_at: null,
    last_failure: null,
    snapshot_hash: snapshotHash,
  };
}

// 정상 200. 성공 시각과 실패 표시를 함께 갱신한다(Q19).
export function stateAfterReceived(
  state: CatalogState,
  atMs: number,
  etag: string | null,
  snapshotHash: string,
): CatalogState {
  const at = formatAt(atMs);
  return {
    auto_update: state.auto_update,
    etag,
    last_checked_at: at,
    last_received_at: at,
    last_failure: null,
    snapshot_hash: snapshotHash,
  };
}

// 정상 304. 확인 시각만 갱신하고 수신 시각·ETag·정상본을 유지한다(Q19).
export function stateAfterChecked(
  state: CatalogState,
  atMs: number,
): CatalogState {
  return {
    auto_update: state.auto_update,
    etag: state.etag,
    last_checked_at: formatAt(atMs),
    last_received_at: state.last_received_at,
    last_failure: null,
    snapshot_hash: state.snapshot_hash,
  };
}

// 잘못된 200·timeout·network 실패. 마지막 정상본·성공 시각·ETag를 유지하고
// 실패 표시만 남긴다(Q19).
export function stateAfterFailure(
  state: CatalogState,
  failure: "invalid_input" | "unavailable" | "not_found",
): CatalogState {
  return { ...state, last_failure: failure };
}

// 갱신 시점 판정. 마지막 확인 뒤 24시간이 지나면 갱신한다(R4).
export function refreshDue(state: CatalogState, nowMs: number): boolean {
  if (!state.auto_update) return false;
  if (state.last_checked_at === null) return true;
  const checked = Date.parse(state.last_checked_at);
  return nowMs - checked >= CATALOG_REFRESH_INTERVAL_MS;
}

export async function hashEntries(
  entries: readonly CatalogEntry[],
): Promise<string> {
  const ordered = mergeEntries([entries as readonly CatalogEntry[]]);
  return await sha256Hex(JSON.stringify(ordered));
}

export function parseState(text: string): CatalogState | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    const checked = catalogStateSchema.safeParse(parsed);
    return checked.success ? checked.data : undefined;
  } catch {
    return undefined;
  }
}

export function parseEntries(text: string): CatalogEntry[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;
  const entries: CatalogEntry[] = [];
  for (const item of parsed) {
    const checked = catalogEntrySchema.safeParse(item);
    if (!checked.success) return undefined;
    entries.push(checked.data);
  }
  return entries;
}

// catalog 밖 model을 호출 gate로 넘기는 조건(R13). 확인된 항목이 하나라도 없으면
// 사용할 수 없다. 임의 한계(false negatives도 0도 128000도 아니다)를 추측하지 않는다.
export type ResolvedSupport = Readonly<{
  context_limit: number;
  input_limit: number;
  output_limit: number;
  supports_tools: boolean;
}>;

export function confirmedSupport(
  entry: CatalogEntry | undefined,
): ResolvedSupport | undefined {
  if (!entry) return undefined;
  if (
    entry.context_limit === null || entry.input_limit === null ||
    entry.output_limit === null || entry.supports_tools === null
  ) {
    return undefined;
  }
  return {
    context_limit: entry.context_limit,
    input_limit: entry.input_limit,
    output_limit: entry.output_limit,
    supports_tools: entry.supports_tools,
  };
}
