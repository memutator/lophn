import { z } from "zod";
import {
  documentList,
  formatGet,
  formatValidate,
  historyInputSchema,
  outlineContext,
  outlineDocument,
  outlinePlace,
  placeRefSchema,
  projectGet,
  projectList,
  searchQuery,
  seriesGet,
  seriesList,
  seriesNext,
} from "../documents/mod.ts";
import { documentDiff } from "../documents/history.ts";
import { documentReadInputSchema } from "../documents/read.ts";
import { absolutePathSchema, versionIdSchema } from "../documents/values.ts";
import { idempotencyKeySchema } from "../platform/envelope.ts";
import { connectionIdSchema } from "./connections.ts";
import { cliSaveFields } from "./mcp-core.ts";

export const cliCommonSchema = z.strictObject({
  json: z.boolean().optional(),
  connection: connectionIdSchema.optional(),
  daemon_url: z.string().min(1).optional(),
  app: z.string().min(1).optional(),
  base_revision: versionIdSchema.nullable().optional(),
  idempotency_key: idempotencyKeySchema.optional(),
  input: z.string().optional(),
  input_file: z.string().min(1).optional(),
}).refine(
  (value) => value.input === undefined || value.input_file === undefined,
  {
    message: "input and input_file are exclusive",
  },
);

export type CliCommon = z.infer<typeof cliCommonSchema>;

const common = cliCommonSchema.shape;
const paths = z.array(absolutePathSchema).min(1);

const withCommon = <T extends z.ZodRawShape>(
  command: string,
  input: z.ZodObject<T>,
) => input.extend({ command: z.literal(command), ...common });

export const cliIndexSchema = z.discriminatedUnion("op", [
  withCommon("index", z.strictObject({ op: z.literal("root") })),
  withCommon("index", outlinePlace.input.extend({ op: z.literal("place") })),
  withCommon(
    "index",
    outlineContext.input.extend({ op: z.literal("context") }),
  ),
  withCommon(
    "index",
    outlineDocument.input.extend({ op: z.literal("document") }),
  ),
  withCommon(
    "index",
    outlineDocument.input.extend({ op: z.literal("section") }),
  ),
  withCommon(
    "index",
    z.strictObject({
      op: z.literal("status"),
      place: placeRefSchema.optional(),
      context: outlineContext.input.shape.context.optional(),
    }),
  ),
]);

export const cliSearchSchema = withCommon(
  "search",
  searchQuery.input.pick({
    query: true,
    place: true,
    context: true,
    cursor: true,
  }),
);

export const cliReadSchema = withCommon("read", documentReadInputSchema);

export const cliDocumentListSchema = withCommon(
  "document list",
  documentList.input.omit({ limit: true, place: true }).extend({
    place: placeRefSchema.optional(),
    unplaced: z.literal(true).optional(),
    limit: z.number().int().min(1).max(500).optional(),
  }),
).refine((value) => !(value.place !== undefined && value.unplaced), {
  message: "place and unplaced are exclusive",
});

export const CLI_CORE_NAMES = [
  "index",
  "search",
  "read",
  "document list",
  "document history",
  "document diff",
  "save",
  "format list",
  "format show",
  "format validate",
  "project list",
  "project show",
  "project current",
  "series list",
  "series show",
  "series next",
] as const;

export const cliDocumentHistorySchema = withCommon(
  "document history",
  historyInputSchema,
);
export const cliDocumentDiffSchema = withCommon(
  "document diff",
  documentDiff.input,
);
export const cliSaveSchema = withCommon(
  "save",
  z.strictObject({
    paths,
    ...cliSaveFields,
  }),
).refine((value) => value.series === undefined || value.key !== undefined, {
  message: "series requires key",
});
export const cliFormatListSchema = withCommon(
  "format list",
  z.strictObject({
    media_type: z.string().min(1).optional(),
  }),
);
export const cliFormatShowSchema = withCommon("format show", formatGet.input);
export const cliFormatValidateSchema = withCommon(
  "format validate",
  formatValidate.input.pick({ name: true, module_hash: true, files: true })
    .extend({
      paths,
    }),
);
export const cliProjectListSchema = withCommon(
  "project list",
  projectList.input,
);
export const cliProjectShowSchema = withCommon(
  "project show",
  projectGet.input,
);
export const cliProjectCurrentSchema = withCommon(
  "project current",
  z.strictObject({}),
);
export const cliSeriesListSchema = withCommon("series list", seriesList.input);
export const cliSeriesShowSchema = withCommon("series show", seriesGet.input);
export const cliSeriesNextSchema = withCommon("series next", seriesNext.input);

export const CLI_CORE_COMMANDS = [
  cliIndexSchema,
  cliDocumentListSchema,
  cliSearchSchema,
  cliReadSchema,
  cliDocumentHistorySchema,
  cliDocumentDiffSchema,
  cliSaveSchema,
  cliFormatListSchema,
  cliFormatShowSchema,
  cliFormatValidateSchema,
  cliProjectListSchema,
  cliProjectShowSchema,
  cliProjectCurrentSchema,
  cliSeriesListSchema,
  cliSeriesShowSchema,
  cliSeriesNextSchema,
] as const;
