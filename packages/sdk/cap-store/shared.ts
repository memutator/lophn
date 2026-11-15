// Node entry(mod.ts)와 폰 entry(mod.phone.ts)가 같이 내보내는 것이다. openStore만 entry가 다르다.
export { DEFAULT_DATABASE_FILE, SCHEMA_TABLE } from "./store.ts";
export type { Migration, OpenStoreOptions, Store } from "./store.ts";
export type { StoreDb, StoreStatement, StoreValue } from "./db.ts";
export { newId } from "./id.ts";
// 템플릿이 단계 파일(`-- loss:` 머리)에서 Migration을 만들 때 쓴다.
export { migrationOfSql } from "../../protocol/apps/activation/migration-sql.ts";
export { CapabilityError } from "./errors.ts";
export type { CapabilityErrorCode } from "./errors.ts";
export { CAP_HOST, STORE_HOOKS } from "./host.ts";
export type {
  ApplyOutcome,
  RuntimeMode,
  StoreHooks,
  StoreHost,
} from "./host.ts";
