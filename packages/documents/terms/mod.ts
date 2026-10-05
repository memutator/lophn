export { termsSchemaSteps } from "./schema.ts";
export { createTermCommands } from "./commands.ts";
export { createTermReads } from "./reads.ts";
export {
  createTermGlossarySource,
  type GlossaryEvidenceRecord,
  type GlossaryTermRecord,
  type TermGlossaryRecord,
  type TermGlossarySource,
} from "./glossary.ts";
export {
  checkTermOccurrence,
  createDerivedEvidenceSource,
  type EvidenceSource,
} from "./occurrence.ts";
