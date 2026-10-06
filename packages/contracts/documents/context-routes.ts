import { z } from "zod";
import { defineCommand, defineRead } from "../platform/mod.ts";
import {
  contextCompareSchema,
  contextCreateInputSchema,
  contextInputSchema,
  contextRemoveItemInputSchema,
  contextSchema,
  contextSetItemInputSchema,
  contextUpdateInputSchema,
  watchedItemComparisonSchema,
} from "./contexts.ts";
import {
  contextExportOutputSchema,
  contextGetOutputSchema,
  contextListInputSchema,
  contextListOutputSchema,
  contextRelatedInputSchema,
  contextRelatedOutputSchema,
} from "./context-reads.ts";

const editorActors = ["user", "agent"] as const;
const commandErrors = [
  "invalid_input",
  "not_found",
  "conflict",
  "forbidden",
] as const;
const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "unavailable",
] as const;
const readActors = ["user", "coding_agent", "agent", "app"] as const;

export const contextCreate = defineCommand({
  resource: "contexts",
  method: "create",
  name: "context.create",
  input: contextCreateInputSchema,
  output: contextSchema,
  compare: z.strictObject({}),
  actors: editorActors,
  errors: ["invalid_input", "conflict", "forbidden"],
});
export const contextUpdate = defineCommand({
  resource: "contexts",
  method: "update",
  name: "context.update",
  input: contextUpdateInputSchema,
  output: contextSchema,
  compare: contextCompareSchema,
  actors: editorActors,
  errors: commandErrors,
});
export const contextSetItem = defineCommand({
  resource: "contexts",
  method: "set_item",
  name: "context.set_item",
  input: contextSetItemInputSchema,
  output: contextSchema,
  compare: contextCompareSchema,
  actors: editorActors,
  errors: commandErrors,
});
export const contextRemoveItem = defineCommand({
  resource: "contexts",
  method: "remove_item",
  name: "context.remove_item",
  input: contextRemoveItemInputSchema,
  output: contextSchema,
  compare: contextCompareSchema,
  actors: editorActors,
  errors: ["not_found", "conflict", "forbidden"],
});
export const contextArchive = defineCommand({
  resource: "contexts",
  method: "archive",
  name: "context.archive",
  input: contextInputSchema,
  output: contextSchema,
  compare: contextCompareSchema,
  actors: editorActors,
  errors: ["not_found", "conflict", "forbidden"],
});
export const contextUnarchive = defineCommand({
  resource: "contexts",
  method: "unarchive",
  name: "context.unarchive",
  input: contextInputSchema,
  output: contextSchema,
  compare: contextCompareSchema,
  actors: editorActors,
  errors: ["not_found", "conflict", "forbidden"],
});
export const contextRecordWatchChange = defineCommand({
  resource: "contexts",
  method: "record_watch_change",
  name: "context.record_watch_change",
  input: watchedItemComparisonSchema,
  output: contextSchema.pick({ id: true, revision: true, status: true }),
  compare: contextCompareSchema,
  actors: ["machine"],
  errors: commandErrors,
});
export const contextList = defineRead({
  resource: "contexts",
  method: "list",
  name: "context.list",
  input: contextListInputSchema,
  output: contextListOutputSchema,
  actors: readActors,
  errors: readErrors,
});
export const contextGet = defineRead({
  resource: "contexts",
  method: "get",
  name: "context.get",
  input: contextInputSchema,
  output: contextGetOutputSchema,
  actors: readActors,
  errors: readErrors,
});
export const contextRelated = defineRead({
  resource: "contexts",
  method: "related",
  name: "context.related",
  input: contextRelatedInputSchema,
  output: contextRelatedOutputSchema,
  actors: readActors,
  errors: readErrors,
});
export const contextExport = defineRead({
  resource: "contexts",
  method: "export",
  name: "context.export",
  input: contextInputSchema,
  output: contextExportOutputSchema,
  actors: ["user"],
  errors: readErrors,
});

// 다른 owner가 같은 transaction에서 `tx.call`로 부를 수 있는 command다. run revert
// (lophn-agent/revert)가 Context Engineer run의 변경을 보상하는 데 쓴다: 목적·제목 되돌림,
// 항목 되돌림(추가한 항목 제거·제거한 항목 복원·관점 되돌림), 보관과 해제. 만들기는 보상하지 않고
// 보관한다. 새 transaction·actor·commit을 만들지 않고 호출한 자격과 command 자신의 CAS·범위
// 검사를 받는다.
export const CONTEXT_DISPATCHABLE_COMMANDS = [
  { route: contextUpdate, dispatchable: true },
  { route: contextSetItem, dispatchable: true },
  { route: contextRemoveItem, dispatchable: true },
  { route: contextArchive, dispatchable: true },
  { route: contextUnarchive, dispatchable: true },
] as const;

export const CONTEXT_ROUTES = [
  contextCreate,
  contextUpdate,
  contextSetItem,
  contextRemoveItem,
  contextArchive,
  contextUnarchive,
  contextRecordWatchChange,
  contextList,
  contextGet,
  contextRelated,
  contextExport,
] as const;
