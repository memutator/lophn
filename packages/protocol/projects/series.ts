import { z } from "zod";
import { defineCommand, defineRead } from "../base/route.ts";
import { defineEvent } from "../events/events.ts";
import { placeRefSchema } from "./address.ts";
import {
  cursorInputFields,
  publicPage,
  publicRead,
  readActors,
  readErrors,
} from "./read-values.ts";
import { seriesOutlineEntrySchema } from "./outline-entries.ts";
import { documentIdSchema, revisionSchema, versionIdSchema } from "./values.ts";
import {
  compareSeriesKeys,
  documentNameForKey,
  nextRuleSchema,
  nextSuggestionSchema,
  seriesDraftOutputSchema,
  seriesDraftSchema,
  seriesIdSchema,
  seriesInstanceOutputSchema,
  seriesKeySchema,
  seriesNameSchema,
  seriesOrderSchema,
  seriesOutputSchema,
  seriesTitleSchema,
  suggestNextKey,
} from "./series-values.ts";
export * from "./series-values.ts";

const memberActors = ["user", "coding_agent", "app"] as const;
const userActors = ["user"] as const;
const memberErrors = [
  "invalid_input",
  "not_found",
  "conflict",
  "forbidden",
] as const;
const seriesCompareSchema = z.strictObject({ base_revision: revisionSchema });
const orderValueSchema = z.union([z.string().min(1), z.number().finite()]);

export const seriesCreateInputSchema = z.strictObject({
  id: seriesIdSchema,
  place: placeRefSchema,
  name: seriesNameSchema,
  title: seriesTitleSchema,
  format: z.string().min(1),
  order: seriesOrderSchema,
  next_rule: nextRuleSchema,
});
export const seriesUpdateInputSchema = z.strictObject({
  series: seriesIdSchema,
  title: seriesTitleSchema.optional(),
  format: z.string().min(1).optional(),
  order: seriesOrderSchema.optional(),
  next_rule: nextRuleSchema.optional(),
  instances: z.array(z.strictObject({
    document: documentIdSchema,
    order_value: orderValueSchema,
    order_version: versionIdSchema,
  })).optional(),
}).refine((value) =>
  ["title", "format", "order", "next_rule"].some((field) =>
    value[field as "title"] !== undefined
  )
).refine((value) =>
  value.order?.kind !== "format_field" ||
  (value.instances !== undefined && value.instances.length > 0)
);
export const seriesDraftInputSchema = z.strictObject({
  series: seriesIdSchema,
  draft: seriesDraftSchema,
});
export const seriesInputSchema = z.strictObject({ series: seriesIdSchema });
export const seriesInstanceInputSchema = z.strictObject({
  series: seriesIdSchema,
  document: documentIdSchema,
  key: seriesKeySchema,
  order_value: orderValueSchema.nullable().default(null),
  order_version: versionIdSchema.nullable().default(null),
}).refine((value) =>
  (value.order_value === null) === (value.order_version === null)
);
export const seriesInstanceUpdateInputSchema = z.strictObject({
  series: seriesIdSchema,
  document: documentIdSchema,
  key: seriesKeySchema.optional(),
  order_value: orderValueSchema.optional(),
  order_version: versionIdSchema.optional(),
}).refine((value) => value.key !== undefined || value.order_value !== undefined)
  .refine((value) =>
    (value.order_value === undefined) === (value.order_version === undefined)
  );
export const seriesRemoveInputSchema = z.strictObject({
  series: seriesIdSchema,
  document: documentIdSchema,
});

export const seriesCreate = defineCommand({
  resource: "series",
  method: "create",
  name: "series.create",
  input: seriesCreateInputSchema,
  output: seriesOutputSchema,
  compare: z.strictObject({}),
  actors: memberActors,
  errors: ["invalid_input", "conflict", "forbidden"],
});
export const seriesUpdate = defineCommand({
  resource: "series",
  method: "update",
  name: "series.update",
  input: seriesUpdateInputSchema,
  output: seriesOutputSchema,
  compare: seriesCompareSchema,
  actors: memberActors,
  errors: memberErrors,
});
export const seriesSetDraft = defineCommand({
  resource: "series",
  method: "set_draft",
  name: "series.set_draft",
  input: seriesDraftInputSchema,
  output: seriesOutputSchema,
  compare: seriesCompareSchema,
  actors: userActors,
  errors: memberErrors,
});
export const seriesClearDraft = defineCommand({
  resource: "series",
  method: "clear_draft",
  name: "series.clear_draft",
  input: seriesInputSchema,
  output: seriesOutputSchema,
  compare: seriesCompareSchema,
  actors: userActors,
  errors: ["not_found", "conflict", "forbidden"],
});
export const seriesAddInstance = defineCommand({
  resource: "series",
  method: "add_instance",
  name: "series.add_instance",
  input: seriesInstanceInputSchema,
  output: seriesOutputSchema,
  compare: seriesCompareSchema,
  actors: memberActors,
  errors: memberErrors,
});
export const seriesUpdateInstance = defineCommand({
  resource: "series",
  method: "update_instance",
  name: "series.update_instance",
  input: seriesInstanceUpdateInputSchema,
  output: seriesOutputSchema,
  compare: seriesCompareSchema,
  actors: memberActors,
  errors: memberErrors,
});
export const seriesRemoveInstance = defineCommand({
  resource: "series",
  method: "remove_instance",
  name: "series.remove_instance",
  input: seriesRemoveInputSchema,
  output: seriesOutputSchema,
  compare: seriesCompareSchema,
  actors: userActors,
  errors: ["not_found", "conflict", "forbidden"],
});
export const seriesArchive = defineCommand({
  resource: "series",
  method: "archive",
  name: "series.archive",
  input: seriesInputSchema,
  output: seriesOutputSchema,
  compare: seriesCompareSchema,
  actors: userActors,
  errors: ["not_found", "conflict", "forbidden"],
});
export const seriesUnarchive = defineCommand({
  resource: "series",
  method: "unarchive",
  name: "series.unarchive",
  input: seriesInputSchema,
  output: seriesOutputSchema,
  compare: seriesCompareSchema,
  actors: userActors,
  errors: ["not_found", "conflict", "forbidden"],
});

const selectorSchema = z.union([
  z.strictObject({ series: seriesIdSchema }),
  z.strictObject({ place: placeRefSchema, name: seriesNameSchema }),
]);
export const seriesList = defineRead({
  resource: "series",
  method: "list",
  name: "series.list",
  input: z.strictObject({
    place: placeRefSchema.optional(),
    status: z.enum(["active", "archived", "all"]).default("active"),
    ...cursorInputFields,
  }),
  output: publicPage(z.object({
    series: z.array(seriesOutputSchema.extend({
      member_count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    })),
  })),
  actors: readActors,
  errors: readErrors,
});
export const seriesGet = defineRead({
  resource: "series",
  method: "get",
  name: "series.get",
  input: z.strictObject({
    selector: selectorSchema,
    ...cursorInputFields,
  }),
  output: publicPage(z.object({
    series: seriesOutputSchema,
    entries: z.array(seriesOutlineEntrySchema),
  })),
  actors: readActors,
  errors: readErrors,
});
export const seriesNextInputSchema = z.strictObject({
  selector: selectorSchema,
});
export const seriesNext = defineRead({
  resource: "series",
  method: "next",
  name: "series.next",
  input: seriesNextInputSchema,
  output: publicRead(z.object({ suggestion: nextSuggestionSchema })),
  actors: readActors,
  errors: readErrors,
});

const changedFields = {
  title: seriesTitleSchema.optional(),
  format: z.string().min(1).optional(),
  order: seriesOrderSchema.optional(),
  next_rule: nextRuleSchema.optional(),
};
export const seriesCreated = defineEvent("SeriesCreated", {
  subject: seriesIdSchema,
  payload: z.object({
    place: placeRefSchema,
    name: seriesNameSchema,
    title: seriesTitleSchema,
    format: z.string().min(1),
    order: seriesOrderSchema,
    next_rule: nextRuleSchema,
  }),
});
export const seriesUpdated = defineEvent("SeriesUpdated", {
  subject: seriesIdSchema,
  payload: z.object({
    before: z.object(changedFields),
    after: z.object(changedFields),
    before_revision: revisionSchema,
    order_basis: z.array(z.object({
      document: documentIdSchema,
      order_value: orderValueSchema,
      order_version: versionIdSchema,
    })).nullable(),
  }).refine((value) =>
    Object.keys(changedFields).some((field) =>
      value.after[field as "title"] !== undefined
    )
  ),
});
export const seriesDraftSet = defineEvent("SeriesDraftSet", {
  subject: seriesIdSchema,
  payload: z.object({
    before_draft: seriesDraftOutputSchema.nullable(),
    draft: seriesDraftOutputSchema,
    before_revision: revisionSchema,
  }),
});
export const seriesDraftCleared = defineEvent("SeriesDraftCleared", {
  subject: seriesIdSchema,
  payload: z.object({
    before_draft: seriesDraftOutputSchema,
    before_revision: revisionSchema,
  }),
});
export const seriesInstanceAdded = defineEvent("SeriesInstanceAdded", {
  subject: seriesIdSchema,
  payload: z.object({
    document: documentIdSchema,
    key: seriesKeySchema,
    order_value: orderValueSchema.nullable(),
    order_version: versionIdSchema.nullable(),
    before_revision: revisionSchema,
  }),
});
export const seriesInstanceUpdated = defineEvent("SeriesInstanceUpdated", {
  subject: seriesIdSchema,
  payload: z.object({
    document: documentIdSchema,
    before_instance: seriesInstanceOutputSchema,
    instance: seriesInstanceOutputSchema,
    before_revision: revisionSchema,
  }),
});
export const seriesInstanceRemoved = defineEvent("SeriesInstanceRemoved", {
  subject: seriesIdSchema,
  payload: z.object({
    before_instance: seriesInstanceOutputSchema,
    before_revision: revisionSchema,
  }),
});
export const seriesArchived = defineEvent("SeriesArchived", {
  subject: seriesIdSchema,
  payload: z.object({ before_revision: revisionSchema }),
});
export const seriesUnarchived = defineEvent("SeriesUnarchived", {
  subject: seriesIdSchema,
  payload: z.object({ before_revision: revisionSchema }),
});

export const SERIES_ROUTES = [
  seriesList,
  seriesGet,
  seriesNext,
  seriesCreate,
  seriesUpdate,
  seriesSetDraft,
  seriesClearDraft,
  seriesAddInstance,
  seriesUpdateInstance,
  seriesRemoveInstance,
  seriesArchive,
  seriesUnarchive,
] as const;
export const SERIES_EVENTS = [
  seriesCreated,
  seriesUpdated,
  seriesDraftSet,
  seriesDraftCleared,
  seriesInstanceAdded,
  seriesInstanceUpdated,
  seriesInstanceRemoved,
  seriesArchived,
  seriesUnarchived,
] as const;

// host가 같은 snapshot의 가족 revision·멤버·예약 key를 넘긴다. 이 함수는 저장하지 않는다.
export function nextSuggestion(input: {
  rule: string;
  revision: string;
  members: readonly { key: string; document_name: string | null }[];
  reserved_keys: readonly string[];
  draft_key: string | null;
}): z.infer<typeof nextSuggestionSchema> {
  const from = [...input.members].sort((left, right) =>
    compareSeriesKeys(left.key, right.key)
  ).at(-1);
  const key = suggestNextKey(input.rule, from?.key ?? null);
  const reserved = new Set([
    ...input.members.map((member) => member.key),
    ...input.reserved_keys,
    ...(input.draft_key === null ? [] : [input.draft_key]),
  ]);
  const name = key === "" ? null : documentNameForKey(key);
  const taken = key !== "" &&
    (reserved.has(key) ||
      input.members.some((member) => member.document_name === name));
  return {
    series_revision: input.revision,
    key,
    title: key,
    from: from?.key ?? null,
    taken,
    document_name: taken ? null : name,
  };
}
