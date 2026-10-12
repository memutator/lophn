import { z } from "zod";
import { defineRead, defineWorker } from "../platform/mod.ts";
import {
  documentIdSchema,
  sectionKeySchema,
  versionIdSchema,
} from "./values.ts";
import {
  formatRefOutputSchema,
  versionSchema,
  versionSourceOutputSchema,
  versionSummarySchema,
} from "./versions.ts";
import { lineRangeOutputSchema } from "./sections.ts";
import {
  cursorInputFields,
  publicPage,
  readActors,
  readErrors,
} from "./read-values.ts";
import { sha256Schema } from "../platform/mod.ts";

export const historyInputSchema = z.strictObject({
  document: documentIdSchema,
  from: versionIdSchema.optional(),
  to: versionIdSchema.optional(),
  ...cursorInputFields,
});
// authenticated agent/coding_agent/app에는 owner handler가 file/instruction source.path를
// source:null로 실제 projection한다. user의 full Version output은 유지한다.
// 이 schema는 현재 auth 또는 projection을 실행하지 않는다.
export const agentHistoryVersionSchema = z.object({
  ...versionSummarySchema.shape,
  source: versionSourceOutputSchema.options[2].nullable(),
}).refine((value) => versionSchema.safeParse(value).success);
export type AgentHistoryVersion = z.infer<typeof agentHistoryVersionSchema>;
// T15의 additive output을 그대로 쓴다. strict prepared/input schema로 output을 좁히지 않는다.
export const historyPageSchema = publicPage(z.object({
  document: documentIdSchema,
  versions: z.array(versionSchema),
})).refine((value) =>
  value.versions.every((version) => version.document === value.document)
);
export const documentHistory = defineRead({
  resource: "documents",
  method: "history",
  name: "document.history",
  input: historyInputSchema,
  output: historyPageSchema,
  actors: readActors,
  errors: readErrors,
});
export const comparisonOmissionSchema = z.object({
  version: versionIdSchema,
  section: sectionKeySchema.nullable(),
  ranges: z.array(lineRangeOutputSchema),
  reason: z.string().min(1),
});
const comparisonSideSchema = z.object({
  version: versionIdSchema,
  format: formatRefOutputSchema,
  module_hash: sha256Schema,
  body_hash: sha256Schema.nullable(),
}).refine((value) => value.module_hash === value.format.module_hash);
export const sectionHistoryEntrySchema = z.object({
  section: sectionKeySchema,
  version: versionIdSchema,
  before: comparisonSideSchema.nullable(),
  after: comparisonSideSchema,
  status: z.enum(["unchanged", "modified", "added", "missing"]),
  title: z.string().nullable(),
}).refine((value) => value.version === value.after.version).refine((value) => {
  const before = value.before?.body_hash ?? null;
  const after = value.after.body_hash;
  switch (value.status) {
    case "added":
      return before === null && after !== null;
    case "missing":
      return before !== null && after === null;
    case "unchanged":
      return before !== null && before === after &&
        value.before?.module_hash === value.after.module_hash;
    case "modified":
      return before !== null && after !== null && before !== after &&
        value.before?.version !== value.after.version &&
        value.before?.module_hash === value.after.module_hash;
  }
}).refine((value) =>
  value.before === null || value.before.module_hash === value.after.module_hash
);
export type SectionHistoryEntry = z.infer<typeof sectionHistoryEntrySchema>;
export const sectionHistoryPageSchema = publicPage(z.object({
  document: documentIdSchema,
  section: sectionKeySchema,
  entries: z.array(sectionHistoryEntrySchema),
  omissions: z.array(comparisonOmissionSchema),
})).refine((value) =>
  value.entries.every((row) => row.section === value.section) &&
  value.omissions.every((row) => row.section === value.section)
);
export const documentSectionHistory = defineWorker({
  resource: "documents",
  method: "section_history",
  name: "document.section_history",
  input: z.strictObject({
    ...historyInputSchema.shape,
    section: sectionKeySchema,
  }),
  output: sectionHistoryPageSchema,
  actors: readActors,
  errors: readErrors,
});

const diffSideSchema = z.object({
  version: versionIdSchema,
  format: formatRefOutputSchema,
  module_hash: sha256Schema,
}).refine((value) => value.module_hash === value.format.module_hash);
export const diffLineChangeSchema = z.object({
  range: lineRangeOutputSchema,
  text: z.string(),
});
export const diffPageSchema = publicPage(z.object({
  document: documentIdSchema,
  before: diffSideSchema,
  after: diffSideSchema,
  section: sectionKeySchema.nullable(),
  additions: z.array(diffLineChangeSchema),
  deletions: z.array(diffLineChangeSchema),
  omissions: z.array(comparisonOmissionSchema),
})).refine((value) =>
  value.omissions.every((item) =>
    (item.version === value.before.version ||
      item.version === value.after.version) &&
    item.section === value.section
  )
);
export type DocumentDiff = z.infer<typeof diffPageSchema>;
export const documentDiff = defineWorker({
  resource: "documents",
  method: "diff",
  name: "document.diff",
  input: z.strictObject({
    document: documentIdSchema,
    before: versionIdSchema,
    after: versionIdSchema,
    section: sectionKeySchema.nullable().default(null),
    ...cursorInputFields,
  }),
  output: diffPageSchema,
  actors: readActors,
  errors: readErrors,
});
// history는 ledger metadata read, 같은 exact key comparison/ bounded Myers diff는 core 밖 worker다.
// cropped 첫 row의 before는 조회 from보다 앞선 판도 허용한다. rename inference는 없다.
// 복원 실패는 omissions로 남긴다. 실제 blob/module 복원 여부는 schema가 알 수 없다.
export const HISTORY_ROUTES = [
  documentHistory,
  documentSectionHistory,
  documentDiff,
] as const;
