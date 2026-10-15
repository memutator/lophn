export {
  type KeychainAdapter,
  type KeychainItem,
  type KeychainStatus,
  unavailableAdapter,
} from "./adapters/keychain.ts";
export {
  createLinuxSecretServiceAdapter,
  randomSealedRef,
  SECRET_TOOL_PATHS,
  type SecretToolRunner,
  secretToolRunner,
} from "./adapters/linux-secret-service.ts";
export {
  removeSecretCommand,
  SECRET_COMMANDS,
  setSecretCommand,
} from "./commands.ts";
export {
  applyRemove,
  applySet,
  compareMatches,
  nextRevision,
  type SecretCompare,
  type SecretRecord,
  toStatus,
} from "./model.ts";
export {
  readSecretStatuses,
  secretsListRead,
  type SecretView,
} from "./reads.ts";
export { readSecretRefs, type SecretReference } from "./refs.ts";
export type { SecretRefSource } from "../../protocol/secrets/mod.ts";
export { recordSecretPreparation } from "./preparations.ts";
export { productKeychain } from "./adapters/product.ts";
export { SECRET_SCHEMA_STEPS } from "./schema.ts";
export {
  createSecretAttach,
  SECRET_SEND,
  type SecretAttach,
  type SecretReferenceLookup,
} from "./attach.ts";
export { attachAllowed, destinationHost, sameDestination } from "./model.ts";
export {
  CODING_CREDENTIAL_PURPOSE,
  type CodingCredentialKeychain,
  codingCredentialRef,
  createCodingCredentialKeychain,
} from "./coding-credential.ts";

// 새 저장소(`<data root>/secrets.json`). 위의 옛 export는 소유 밖에 쓰는 곳이 있어 남아 있다.
export {
  createSecretFileStore,
  denoSecretFs,
  SECRET_FILE_MODE,
  type SecretFileStore,
  type SecretFs,
} from "./file-store.ts";
export { openSecretStore, type SecretStore } from "./secret-store.ts";
export {
  createFileSecretAttach,
  type SecretDestinations,
} from "./file-attach.ts";
export {
  secretDeleteHandler,
  secretPutHandler,
  secretStatusHandler,
} from "./routes.ts";
