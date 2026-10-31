import type {
  CatalogEntry,
  UserModelRecord,
} from "../../../protocol/lophn-agent/mod.ts";
import { effortAxisOf } from "../../../protocol/lophn-agent/mod.ts";
import type { Sql } from "../../../protocol/server/mod.ts";
import { loadUserModel } from "./store.ts";

// 사람이 적은 model 정보를 catalog의 user 층 항목으로 옮긴다. catalog를 읽는 곳 셋(ReadModelCatalog,
// turn resolver, 저장할 때 검사)이 모두 이 함수를 거치므로 같은 입력에 같은 항목이 나온다.
export function userEntryOf(record: UserModelRecord): CatalogEntry {
  const { info } = record;
  const revision = `user@${record.saved_at.slice(0, 10)}`;
  const price = info.price;
  const priced =
    price !== null && Object.values(price).some((value) => value !== null);
  return {
    provider_definition: record.provider_definition,
    model_name: record.model_name,
    context_limit: info.context_limit,
    input_limit: info.input_limit,
    output_limit: info.output_limit,
    supports_tools: info.supports_tools,
    input_media: info.input_media,
    output_media: info.output_media,
    options: info.effort === null ? [] : [effortAxisOf(info.effort)],
    preview: null,
    deprecated: null,
    source: "user",
    source_revision: revision,
    checked_at: null,
    received_at: null,
    price_basis: !priced
      ? null
      : {
          currency: "USD",
          rates: [
            {
              context_from: null,
              context_through: null,
              cache_ttl_ms: null,
              ...price,
              reasoning: null,
            },
          ],
          source: "user",
          revision,
          checked_at: record.saved_at,
        },
  };
}

// catalog에 없는 model, 그리고 사람이 안 적은 칸에 쓰는 기본 한계다. agent의 기본 prompt와 tool 정의만 수십 KB라
// 이보다 작으면 turn이 시작하지 못한다. output은 모르는 server에 큰 max_tokens를 보내 거절당하지 않게 작게 둔다.
export const UNLISTED_LIMITS = {
  context_limit: 131072,
  input_limit: 131072,
  output_limit: 4096,
  supports_tools: true,
};

// 사람이 적은 항목의 안 적은 한도(null)를 칸마다 기본값으로 채운다. input은 정해진 context를 따른다.
export function withDefaultLimits(entry: CatalogEntry): CatalogEntry {
  if (entry.source !== "user") return entry;
  const context = entry.context_limit ?? UNLISTED_LIMITS.context_limit;
  return {
    ...entry,
    context_limit: context,
    input_limit: entry.input_limit ?? context,
    output_limit: entry.output_limit ?? UNLISTED_LIMITS.output_limit,
    supports_tools: entry.supports_tools ?? UNLISTED_LIMITS.supports_tools,
  };
}

// 저장할 때 검사가 보는 항목이다. 사람이 적은 정보가 같은 열쇠의 catalog 항목을 덮는다. base는 catalog 읽기와 같은
// 바탕(derived catalog, 없으면 동봉 snapshot)이다.
export function checkEntryOf(
  sql: Pick<Sql, "get">,
  base: readonly CatalogEntry[],
  definition: string,
  modelName: string,
): CatalogEntry | undefined {
  const record = loadUserModel(sql, definition, modelName);
  if (record !== undefined) return userEntryOf(record);
  return base.find(
    (entry) =>
      entry.provider_definition === definition &&
      entry.model_name === modelName,
  );
}
