export {
  type KeychainAdapter,
  type KeychainItem,
  type KeychainStatus,
  unavailableAdapter,
} from "./adapters/keychain.ts";
export {
  createLinuxSecretServiceAdapter,
  randomSealedRef,
  secretToolRunner,
} from "./adapters/linux-secret-service.ts";
export { SECRET_COMMANDS } from "./commands.ts";
export { applyRemove, applySet, type SecretRecord, toStatus } from "./model.ts";
export { secretsListRead } from "./reads.ts";
export { readSecretRefs } from "./refs.ts";
export type { SecretRefSource } from "../../protocol/secrets/mod.ts";
export { recordSecretPreparation } from "./preparations.ts";
export { productKeychain } from "./adapters/product.ts";
export { SECRET_SCHEMA_STEPS } from "./schema.ts";
export { createSecretAttach, SECRET_SEND } from "./attach.ts";
export { attachAllowed, sameDestination } from "./model.ts";

// 새 저장소(`<data root>/secrets.json`). 위의 옛 export는 소유 밖에 쓰는 곳이 있어 남아 있다.
export {
  createSecretFileStore,
  type SecretFileStore,
  type SecretFs,
} from "./file-store.ts";
export { openSecretStore, type SecretStore } from "./secret-store.ts";
export { createFileSecretAttach } from "./file-attach.ts";
export {
  secretDeleteHandler,
  secretPutHandler,
  secretStatusHandler,
} from "./routes.ts";
