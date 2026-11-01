import { z } from "zod";
import { archiveStateSchema } from "../base/values.ts";
import { withReadCommon } from "../base/envelope.ts";
import { defineCommand, defineRead } from "../base/route.ts";
import { defineEvent } from "../base/event.ts";
import { revisionSchema } from "../projects/values.ts";
import {
  domainIdSchema,
  domainNameSchema,
  domainOwnerSchema,
} from "./values.ts";

export const domainRecordSchema = z.object({
  id: domainIdSchema,
  name: domainNameSchema,
  title: z.string().min(1),
  purpose: z.string(),
  owner: domainOwnerSchema,
  revision: revisionSchema,
  status: archiveStateSchema,
});
export type DomainRecord = z.infer<typeof domainRecordSchema>;

const domainRefInputSchema = z.strictObject({ domain: domainIdSchema });
const baseRevisionSchema = z.strictObject({ base_revision: revisionSchema });

// id를 미리 배정하는 것은 user만이다.
export const domainCreate = defineCommand({
  resource: "domains",
  method: "create",
  name: "domain.create",
  input: z.strictObject({
    id: domainIdSchema.optional(),
    name: domainNameSchema,
    title: z.string().min(1),
    purpose: z.string(),
    // agent는 생략하면 자격 조건의 project나 app이 그릇이다. user는 꼭 준다.
    owner: domainOwnerSchema.optional(),
  }),
  output: domainRecordSchema,
  compare: z.strictObject({}),
  actors: ["user", "agent"],
  errors: ["invalid_input", "forbidden", "not_found", "conflict"],
});
export const domainArchive = defineCommand({
  resource: "domains",
  method: "archive",
  name: "domain.archive",
  input: domainRefInputSchema,
  output: domainRecordSchema,
  compare: baseRevisionSchema,
  actors: ["user"],
  errors: ["not_found", "conflict"],
});
export const domainUnarchive = defineCommand({
  resource: "domains",
  method: "unarchive",
  name: "domain.unarchive",
  input: domainRefInputSchema,
  output: domainRecordSchema,
  compare: baseRevisionSchema,
  actors: ["user"],
  errors: ["not_found", "conflict"],
});

const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;
const readActors = ["user", "agent", "machine"] as const;
export const domainList = defineRead({
  resource: "domains",
  method: "list",
  name: "domain.list",
  input: z.strictObject({
    owner: domainOwnerSchema.optional(),
    status: archiveStateSchema.optional(),
    cursor: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
  }),
  output: withReadCommon(z.object({ domains: z.array(domainRecordSchema) })),
  actors: readActors,
  errors: readErrors,
});
export const domainGet = defineRead({
  resource: "domains",
  method: "get",
  name: "domain.get",
  input: domainRefInputSchema,
  output: withReadCommon(z.object({ domain: domainRecordSchema })),
  actors: readActors,
  errors: readErrors,
});

export const domainCreated = defineEvent("DomainCreated", {
  subject: domainIdSchema,
  payload: z.object({
    name: domainNameSchema,
    title: z.string().min(1),
    purpose: z.string(),
    owner: domainOwnerSchema,
  }),
});
export const domainArchived = defineEvent("DomainArchived", {
  subject: domainIdSchema,
  payload: z.object({}),
});
export const domainUnarchived = defineEvent("DomainUnarchived", {
  subject: domainIdSchema,
  payload: z.object({}),
});

export const DOMAIN_ROUTES = [
  domainCreate,
  domainArchive,
  domainUnarchive,
  domainList,
  domainGet,
] as const;
