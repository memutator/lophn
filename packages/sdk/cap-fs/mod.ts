export {
  readFile,
  readTextFile,
  watch,
  writeFile,
  writeTextFile,
} from "./fs.ts";
export type { FsEvent, FsWatcher, WatchOptions, WriteOptions } from "./fs.ts";
export { CapabilityError } from "./errors.ts";
export type { CapabilityErrorCode } from "./errors.ts";
export { checkDeclaration, REQUIRED_PERMISSIONS } from "./declaration.ts";
export type { DeclarationCheck, DeclarationLike } from "./declaration.ts";
