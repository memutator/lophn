export { contentUnchanged, filesHash, nextVersionNumber } from "./model.ts";
export { versionsSchemaSteps } from "./schema.ts";
export {
  createVersionCommands,
  type SeriesJoin,
  versionFileField,
  versionFilesField,
} from "./commands.ts";
export {
  createVersionReads,
  exportDocument,
  type ExportRedactor,
  storedFile,
} from "./reads.ts";
export { createExportAssembly } from "./work.ts";
export { authorizeDocument } from "./authorization.ts";
export {
  type LinkedDocument,
  loadDocument,
  loadLatestVersion,
  loadLinkedDocuments,
  loadVersionByNumber,
  replaceDocument,
} from "./store.ts";
export {
  createGuideCatalog,
  findInstalledGuide,
  GUIDE_MANIFEST_PATH,
  type GuideCatalog,
  type GuideFileBytes,
  type GuideFiles,
  type InstalledGuides,
} from "./guides.ts";
