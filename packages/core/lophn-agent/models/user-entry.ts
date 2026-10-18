import type {
  CatalogEntry,
  UserModelRecord,
} from "../../../protocol/lophn-agent/mod.ts";
import { effortAxisOf } from "../../../protocol/lophn-agent/mod.ts";
import type { Sql } from "../../../protocol/server/mod.ts";
import { loadUserModel } from "./store.ts";
import { snapshotCatalogEntry } from "./snapshot-catalog.ts";

// 사람이 적은 model 정보를 catalog의 user 층 항목으로 옮긴다. catalog를 읽는 곳 셋(ReadModelCatalog,
// turn resolver, 저장할 때 검사)이 모두 이 함수를 거치므로 같은 입력에 같은 항목이 나온다.
export function userEntryOf(record: UserModelRecord): CatalogEntry {
  const { info } = record;
  const revision = `user@${record.saved_at.slice(0, 10)}`;
  const price = info.price;
  const priced = price !== null &&
    Object.values(price).some((value) => value !== null);
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
    price_basis: !priced ? null : {
      currency: "USD",
      rates: [{
        context_from: null,
        context_through: null,
        cache_ttl_ms: null,
        ...price,
        reasoning: null,
      }],
      source: "user",
      revision,
      checked_at: record.saved_at,
    },
  };
}

// 저장할 때 검사가 보는 항목이다. 사람이 적은 정보가 같은 열쇠의 동봉 snapshot 항목을 덮는다.
export function checkEntryOf(
  sql: Pick<Sql, "get">,
  definition: string,
  modelName: string,
): CatalogEntry | undefined {
  const record = loadUserModel(sql, definition, modelName);
  return record === undefined
    ? snapshotCatalogEntry(definition, modelName)
    : userEntryOf(record);
}
