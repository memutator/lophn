import { z } from "zod";
import {
  defineCommand,
  defineRead,
  idSchema,
  seqSchema,
} from "../platform/mod.ts";
import { publicPage, publicRead, readCursorSchema } from "./read-values.ts";
import { contextIdSchema } from "./contexts.ts";
import {
  termCompareSchema,
  termDefineInputSchema,
  termInputSchema,
  termProposeInputSchema,
  termSchema,
  termUpdateInputSchema,
} from "./terms.ts";

export const GLOSSARY_PAGE_LIMIT = 30;

const listFields = {
  context: contextIdSchema,
  cursor: readCursorSchema.optional(),
  limit: z.number().int().min(1).max(GLOSSARY_PAGE_LIMIT).optional(),
};
export const termListInputSchema = z.strictObject(listFields);
export const termListOutputSchema = publicPage(z.object({
  definitions: z.array(termSchema).max(GLOSSARY_PAGE_LIMIT),
  candidates: z.array(termSchema),
}));

export const termGetOutputSchema = publicRead(z.object({ term: termSchema }));

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

export const termPropose = defineCommand({
  resource: "terms",
  method: "propose",
  name: "term.propose",
  input: termProposeInputSchema,
  output: termSchema,
  compare: z.strictObject({}),
  actors: editorActors,
  errors: commandErrors,
});
// QuestionActionEvidence라는 값은 lophn-agent에 없다. 검증된 option action 적용은
// 사람 결정 actor(user)와 그 question·option·answered seq를 함께 제출한다.
export const questionActionEvidenceSchema = z.strictObject({
  question: idSchema("qst"),
  option_key: z.string().min(1),
  answered_seq: seqSchema,
});
export const termDefineRequestFields = {
  input: termDefineInputSchema,
  compare: termCompareSchema,
  question_action: questionActionEvidenceSchema.optional(),
};
export const termDefine = defineCommand({
  resource: "terms",
  method: "define",
  name: "term.define",
  input: termDefineInputSchema,
  output: termSchema,
  compare: termCompareSchema,
  actors: ["user"],
  errors: commandErrors,
});
export const termUpdate = defineCommand({
  resource: "terms",
  method: "update",
  name: "term.update",
  input: termUpdateInputSchema,
  output: termSchema,
  compare: termCompareSchema,
  actors: editorActors,
  errors: commandErrors,
});
export const termArchive = defineCommand({
  resource: "terms",
  method: "archive",
  name: "term.archive",
  input: termInputSchema,
  output: termSchema,
  compare: termCompareSchema,
  actors: editorActors,
  errors: ["not_found", "conflict", "forbidden"],
});
export const termUnarchive = defineCommand({
  resource: "terms",
  method: "unarchive",
  name: "term.unarchive",
  input: termInputSchema,
  output: termSchema,
  compare: termCompareSchema,
  actors: editorActors,
  errors: ["not_found", "conflict", "forbidden"],
});
export const termList = defineRead({
  resource: "terms",
  method: "list",
  name: "term.list",
  input: termListInputSchema,
  output: termListOutputSchema,
  actors: readActors,
  errors: readErrors,
});
export const termGet = defineRead({
  resource: "terms",
  method: "get",
  name: "term.get",
  input: termInputSchema,
  output: termGetOutputSchema,
  actors: readActors,
  errors: readErrors,
});

export const TERM_ROUTES = [
  termPropose,
  termDefine,
  termUpdate,
  termArchive,
  termUnarchive,
  termList,
  termGet,
] as const;
