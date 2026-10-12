import { z } from "zod";
import { defineEvent } from "../platform/mod.ts";
import { placeRefOutputSchema } from "./address.ts";
import {
  documentIdSchema,
  revisionSchema,
  slugSchema,
  versionIdSchema,
} from "./values.ts";
import {
  fileSourceOutputSchema,
  formatRefOutputSchema,
  preparedVersionOutputSchema,
  versionSourceOutputSchema,
} from "./versions.ts";

export const documentCreated = defineEvent("DocumentCreated", {
  subject: documentIdSchema,
  payload: z.object({
    place: placeRefOutputSchema.nullable(),
    name: slugSchema.nullable(),
    title: z.string().min(1),
    file_source: fileSourceOutputSchema.nullable(),
    version: versionIdSchema,
  }).refine((value) => value.place === null || value.name !== null),
});

export const documentSaved = defineEvent("DocumentSaved", {
  subject: documentIdSchema,
  payload: z.object({
    version: versionIdSchema,
    previous_version: versionIdSchema.nullable(),
    content_hash: preparedVersionOutputSchema.shape.content_hash,
    format: formatRefOutputSchema,
    source: versionSourceOutputSchema.nullable(),
  }),
});

export const documentUpdated = defineEvent("DocumentUpdated", {
  subject: documentIdSchema,
  payload: z.object({
    before_title: z.string().min(1),
    title: z.string().min(1),
    before_revision: revisionSchema,
  }),
});

export const documentSourceChanged = defineEvent("DocumentSourceChanged", {
  subject: documentIdSchema,
  payload: z.object({
    before_source: fileSourceOutputSchema.nullable(),
    source: fileSourceOutputSchema.nullable(),
    before_revision: revisionSchema,
  }),
});

export const documentArchived = defineEvent("DocumentArchived", {
  subject: documentIdSchema,
  payload: z.object({ before_revision: revisionSchema }),
});

export const documentUnarchived = defineEvent("DocumentUnarchived", {
  subject: documentIdSchema,
  payload: z.object({ before_revision: revisionSchema }),
});

export const documentRestored = defineEvent("DocumentRestored", {
  subject: documentIdSchema,
  payload: z.object({
    restore_version: versionIdSchema,
    previous_version: versionIdSchema,
    version: versionIdSchema,
  }),
});

export const documentMoved = defineEvent("DocumentMoved", {
  subject: documentIdSchema,
  payload: z.object({
    before_place: placeRefOutputSchema.nullable(),
    before_name: slugSchema.nullable(),
    place: placeRefOutputSchema.nullable(),
    name: slugSchema.nullable(),
    before_revision: revisionSchema,
  }).refine((value) =>
    (value.before_place === null || value.before_name !== null) &&
    (value.place === null || value.name !== null)
  ),
});

export const documentRenamed = defineEvent("DocumentRenamed", {
  subject: documentIdSchema,
  payload: z.object({
    place: placeRefOutputSchema.nullable(),
    before_name: slugSchema.nullable(),
    name: slugSchema,
    before_revision: revisionSchema,
  }),
});
