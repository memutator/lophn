// context 새 판의 초안 폴더 흐름. Project Manager가 초안 폴더에 file tool로 계약과 검색 script를 쓰고,
// test로 돌려 보고, submit한다. JSON을 tool 인자로 통째로 저장하는 옛 `bundle.save_draft`는 이 흐름에 없다.
import { z } from "zod";
import { defineCommand, defineRead } from "../base/route.ts";
import {
  bundleDiscardDraftRoute,
  bundleIdSchema,
  bundleSubmitRoute,
  checkReportSchema,
  contextCreateRequestSchema,
  ctxIdSchema,
  noCompareSchema,
} from "./context-api.ts";
import { publicRead } from "./read-values.ts";
import { absolutePathSchema } from "./values.ts";

// 새 context면 첫 판과 함께 context를 만든다.
export const contextDraftOpenInputSchema = z.union([
  z.strictObject({ context: ctxIdSchema }),
  z.strictObject({ new: contextCreateRequestSchema }),
]);
// folder는 lophn data 안 그 project context 아래에 있고 판이 제출되거나 버려질 때까지만 있다.
export const contextDraftOpenOutputSchema = z.object({
  context: ctxIdSchema,
  bundle: bundleIdSchema,
  folder: absolutePathSchema,
});

// 이미 열린 초안이 있으면 그 폴더를 돌려준다.
export const bundleOpenDraftRoute = defineCommand({
  resource: "contexts",
  method: "open_draft",
  name: "bundle.open_draft",
  input: contextDraftOpenInputSchema,
  output: contextDraftOpenOutputSchema,
  compare: noCompareSchema,
  actors: ["agent"],
  errors: ["invalid_input", "not_found", "conflict", "forbidden"],
});

// 초안 폴더를 격리 test로 돌린다.
export const bundleTestDraftRoute = defineRead({
  resource: "contexts",
  method: "test_draft",
  name: "bundle.test_draft",
  input: z.strictObject({ bundle: bundleIdSchema }),
  output: publicRead(z.object({ report: checkReportSchema })),
  actors: ["agent"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "conflict",
    "unavailable",
  ],
});

// 옛 route를 다시 내보낸다. 등록할 때 CONTEXT_API_ROUTES와 겹치지 않게 한다.
export const CONTEXT_DRAFT_ROUTES = [
  bundleOpenDraftRoute,
  bundleTestDraftRoute,
  bundleSubmitRoute,
  bundleDiscardDraftRoute,
] as const;
