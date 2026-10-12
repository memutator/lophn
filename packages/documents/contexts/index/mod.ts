export { indexSchemaSteps } from "./schema.ts";
export { scanContext } from "./scan.ts";
export {
  type IndexStore,
  openIndexStore,
  readEntities,
  readEntitiesOfType,
  readEntityWithLinks,
  readIndexedFiles,
  readIndexState,
  readViolations,
} from "./store.ts";
export type {
  FileStat,
  IndexedEntity,
  IndexedFile,
  IndexFiles,
  IndexState,
  ScanInput,
  ScanResult,
} from "./types.ts";
