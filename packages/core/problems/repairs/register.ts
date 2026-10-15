import type { ProblemsPart } from "../register.ts";
import {
  problemFixRecorded,
  problemsUploadFixSummary,
} from "../../../protocol/problems/mod.ts";
import {
  FIX_BLOB_FIELDS,
  FIX_BLOB_PURPOSES,
  listProblemFixesRead,
  recordProblemFixCommand,
} from "./mod.ts";

export const repairsPart = {
  blobFields: FIX_BLOB_FIELDS,
  blobPurposes: FIX_BLOB_PURPOSES,
  commands: [recordProblemFixCommand],
  reads: [listProblemFixesRead],
  readerReads: [listProblemFixesRead],
  events: [problemFixRecorded],
  // 고친 기록 summary의 blob 준비 route. 바이트는 core 핸들러가 준비 중계로 흘린다.
  uploadRoutes: [problemsUploadFixSummary],
} satisfies ProblemsPart;
