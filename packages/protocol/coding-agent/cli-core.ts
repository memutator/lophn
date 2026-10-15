import { z } from "zod";
import { projectGet, projectList } from "../projects/mod.ts";
import { idempotencyKeySchema } from "../base/envelope.ts";
import { versionIdSchema } from "../projects/values.ts";
import { connectionIdSchema } from "./connections.ts";

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

const withCommon = <T extends z.ZodRawShape>(
  command: string,
  input: z.ZodObject<T>,
) => input.extend({ command: z.literal(command), ...common });

export const CLI_CORE_NAMES = [
  "project list",
  "project show",
  "project current",
] as const;

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

export const CLI_CORE_COMMANDS = [
  cliProjectListSchema,
  cliProjectShowSchema,
  cliProjectCurrentSchema,
] as const;
