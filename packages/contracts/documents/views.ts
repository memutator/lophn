import { z } from "zod";
import {
  defineCommand,
  defineEvent,
  defineRead,
  defineWorker,
  idSchema,
  seqSchema,
} from "../platform/mod.ts";
import { placeRefOutputSchema, placeRefSchema } from "./address.ts";
import { placeOutlineEntrySchema } from "./outline-entries.ts";
import { indexCoverageSchema } from "./search.ts";
import {
  countSchema,
  cursorInputFields,
  nonblankSchema,
  publicPage,
  publicRead,
  readActors,
  readErrors,
} from "./read-values.ts";
import { revisionSchema } from "./values.ts";

export const VIEW_SORTS = [
  "updated_desc",
  "updated_asc",
  "title_asc",
  "address_asc",
] as const;
export const DOCUMENT_STATUSES = ["active", "archived", "all"] as const;
export const viewSortSchema = z.enum(VIEW_SORTS);
export const documentStatusSchema = z.enum(DOCUMENT_STATUSES);
export const viewIdSchema = idSchema("viw");
export const viewNameSchema = nonblankSchema;

const filterFields = {
  title_contains: nonblankSchema.optional(),
  text: nonblankSchema.optional(),
  formats: z.array(nonblankSchema).min(1).optional(),
  changed_within_ms: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
    .optional(),
  context: idSchema("ctx").optional(),
  document_status: documentStatusSchema.default("active"),
};
export const viewFilterSchema = z.strictObject(filterFields);
export const viewFilterOutputSchema = z.object(filterFields);
export type ViewFilter = z.infer<typeof viewFilterSchema>;

const viewFields = {
  id: viewIdSchema,
  name: viewNameSchema,
  place: placeRefSchema.nullable(),
  filter: viewFilterSchema,
  sort: viewSortSchema,
  revision: revisionSchema,
};
export const savedViewSchema = z.object({
  ...viewFields,
  place: placeRefOutputSchema.nullable(),
  filter: viewFilterOutputSchema,
});
export type SavedView = z.infer<typeof savedViewSchema>;

const userActors = ["user"] as const;
const compareSchema = z.strictObject({ base_revision: revisionSchema });
export const viewSaveInputSchema = z.strictObject({
  id: viewIdSchema,
  name: viewNameSchema,
  place: placeRefSchema.optional(),
  filter: viewFilterSchema,
  sort: viewSortSchema.optional(),
});
export const viewUpdateInputSchema = z.strictObject({
  view: viewIdSchema,
  name: viewNameSchema.optional(),
  place: placeRefSchema.nullable().optional(),
  filter: viewFilterSchema.optional(),
  sort: viewSortSchema.optional(),
}).refine((value) =>
  ["name", "place", "filter", "sort"].some((field) =>
    value[field as "name"] !== undefined
  )
);
export const viewInputSchema = z.strictObject({ view: viewIdSchema });

export const viewSave = defineCommand({
  resource: "views",
  method: "save",
  name: "view.save",
  input: viewSaveInputSchema,
  output: savedViewSchema,
  compare: z.strictObject({}),
  actors: userActors,
  errors: ["invalid_input", "conflict", "forbidden"],
});
export const viewUpdate = defineCommand({
  resource: "views",
  method: "update",
  name: "view.update",
  input: viewUpdateInputSchema,
  output: savedViewSchema,
  compare: compareSchema,
  actors: userActors,
  errors: ["invalid_input", "not_found", "conflict", "forbidden"],
});
export const viewDelete = defineCommand({
  resource: "views",
  method: "delete",
  name: "view.delete",
  input: viewInputSchema,
  output: z.object({ view: viewIdSchema, revision: revisionSchema }),
  compare: compareSchema,
  actors: userActors,
  errors: ["not_found", "conflict", "forbidden"],
});
export const viewList = defineRead({
  resource: "views",
  method: "list",
  name: "view.list",
  input: z.strictObject({ ...cursorInputFields }),
  output: publicPage(z.object({ views: z.array(savedViewSchema) })),
  actors: readActors,
  errors: readErrors,
});
export const viewGet = defineRead({
  resource: "views",
  method: "get",
  name: "view.get",
  input: viewInputSchema,
  output: publicRead(z.object({ view: savedViewSchema })),
  actors: readActors,
  errors: readErrors,
});
export const viewOpen = defineWorker({
  resource: "views",
  method: "open",
  name: "view.open",
  input: z.strictObject({
    view: viewIdSchema,
    estimated_token_budget: countSchema.min(1).optional(),
    ...cursorInputFields,
  }),
  output: publicPage(z.object({
    kind: z.literal("view"),
    basis_seq: seqSchema,
    view: viewIdSchema,
    revision: revisionSchema,
    filter: viewFilterOutputSchema,
    opened_at_ms: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    entries: z.array(placeOutlineEntrySchema),
    coverage: indexCoverageSchema.nullable(),
  })).refine((value) =>
    (value.filter.text !== undefined) === (value.coverage !== null)
  ),
  actors: readActors,
  errors: readErrors,
});

const changed = {
  name: viewNameSchema.optional(),
  place: placeRefOutputSchema.nullable().optional(),
  filter: viewFilterOutputSchema.optional(),
  sort: viewSortSchema.optional(),
};
export const savedViewCreated = defineEvent("SavedViewCreated", {
  subject: viewIdSchema,
  payload: z.object({
    name: viewNameSchema,
    place: placeRefOutputSchema.nullable(),
    filter: viewFilterOutputSchema,
    sort: viewSortSchema,
  }),
});
export const savedViewUpdated = defineEvent("SavedViewUpdated", {
  subject: viewIdSchema,
  payload: z.object({
    before: z.object(changed),
    after: z.object(changed),
    before_revision: revisionSchema,
  }).refine((value) =>
    Object.values(value.after).some((field) => field !== undefined)
  ),
});
export const savedViewDeleted = defineEvent("SavedViewDeleted", {
  subject: viewIdSchema,
  payload: z.object({
    before_view: savedViewSchema,
    before_revision: revisionSchema,
  }),
});

export const VIEW_ROUTES = [
  viewList,
  viewGet,
  viewOpen,
  viewSave,
  viewUpdate,
  viewDelete,
] as const;
export const VIEW_EVENTS = [
  savedViewCreated,
  savedViewUpdated,
  savedViewDeleted,
] as const;
