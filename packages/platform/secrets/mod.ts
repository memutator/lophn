export {
  type KeychainAdapter,
  type KeychainItem,
  type KeychainStatus,
  unavailableAdapter,
} from "./adapters/keychain.ts";
export {
  createFakeKeychain,
  type FakeKeychain,
} from "./adapters/fake-keychain.ts";
export {
  createLinuxSecretServiceAdapter,
  randomSealedRef,
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
  cleanupResult,
  compareMatches,
  nextRevision,
  type SecretCompare,
  type SecretRecord,
  toStatus,
} from "./model.ts";
export { readSecretStatuses, type SecretView } from "./reads.ts";
export { SECRET_SCHEMA_STEPS } from "./schema.ts";
export {
  createSecretWork,
  type PreparationStore,
  type ProcessWatch,
  type SecretWork,
} from "./work.ts";
