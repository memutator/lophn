import { z } from "zod";

export const problemCodeSchema = z.string().regex(/^[a-z][a-z0-9_]{1,47}$/);
export const problemMessageKeySchema = z.string().regex(
  /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9_-]*){2,}$/,
);
export const problemMessageSchema = z.string().regex(/\S/).refine(
  (value) => !/[\r\n{}]/.test(value),
  { message: "problem message must be a fixed single line" },
);
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

export const RESERVED_PROBLEM_CODES = [
  {
    code: "_exception",
    message_key: "app-detail.issue.unexpected_error",
    message: "Something went wrong in this app.",
    fixer: "coding_agent",
  },
  {
    code: "_feedback",
    message_key: "app-detail.issue.reported",
    message: "You reported an issue.",
    fixer: "coding_agent",
  },
  {
    code: "_invalid_report",
    message_key: "app-detail.issue.report_incomplete",
    message: "This app could not report an issue correctly.",
    fixer: "coding_agent",
  },
] as const;
export type ReservedProblemCode = (typeof RESERVED_PROBLEM_CODES)[number];
export const reservedProblemCodeSchema = z.enum([
  "_exception",
  "_feedback",
  "_invalid_report",
]);
