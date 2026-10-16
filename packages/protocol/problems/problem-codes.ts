import { z } from "zod";

export const problemCodeSchema = z.string().regex(/^[a-z][a-z0-9_]{1,47}$/);
export const problemMessageKeySchema = z.string().regex(
  /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9_-]*){2,}$/,
);
export const problemMessageSchema = z.string().regex(/\S/).refine(
  (value) => !/[\r\n{}]/.test(value),
  { message: "problem message must be a fixed single line" },
).refine((value) => value.isWellFormed(), {
  message: "problem message must contain Unicode scalar values",
});
export const PROBLEM_FIXERS = ["coding_agent", "user"] as const;
export const problemFixerSchema = z.enum(PROBLEM_FIXERS);
export type ProblemFixer = z.infer<typeof problemFixerSchema>;

export const problemCodeDeclarationSchema = z.strictObject({
  code: problemCodeSchema,
  message_key: problemMessageKeySchema,
  message: problemMessageSchema,
  fixer: problemFixerSchema,
});
export type ProblemCodeDeclaration = z.infer<
  typeof problemCodeDeclarationSchema
>;
export const problemCodeDeclarationsSchema = z.array(
  problemCodeDeclarationSchema,
).refine(
  (values) => new Set(values.map((value) => value.code)).size === values.length,
  {
    message: "duplicate problem code",
  },
);

export const reservedProblemCodeSchema = z.enum([
  "_exception",
  "_feedback",
  "_invalid_report",
]);
