export { createRedactionEngine, type RedactionEngine } from "./engine.ts";
export { selectSafeFields } from "./fields.ts";
export { matchCredential, patternRevision } from "./patterns.ts";
export {
  createProductRedactor,
  type TextRedactor,
} from "./product-redactor.ts";
export {
  createKnownSecretRegistry,
  type KnownSecretRegistry,
} from "./registry.ts";
export { createRedactionStream } from "./stream.ts";
export {
  isFieldPath,
  OMISSION_REASONS,
  type RedactedItem,
  REDACTION_MAX_DEPTH,
  REDACTION_MAX_ITEMS,
  REDACTION_REPLACEMENT,
  REDACTION_STATUSES,
  REDACTION_TIMEOUT_MS,
  REDACTION_UNIT_MAX_BYTES,
  type RedactionContent,
  type RedactionInput,
  type RedactionOmission,
  type RedactionResult,
} from "./model.ts";
