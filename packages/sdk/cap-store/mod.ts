export { DEFAULT_DATABASE_FILE, openStore, SCHEMA_TABLE } from "./store.ts";
export type { Migration, OpenStoreOptions, Store } from "./store.ts";
// 템플릿이 단계 파일(`-- loss:` 머리)에서 Migration을 만들 때 쓴다.
export { migrationOfSql } from "../../protocol/apps/activation/migration.ts";
export { CapabilityError } from "./errors.ts";
export type { CapabilityErrorCode } from "./errors.ts";
export { CAP_HOST, STORE_HOOKS } from "./host.ts";
export type { ApplyOutcome, RuntimeMode, StoreHooks, StoreHost } from "./host.ts";
