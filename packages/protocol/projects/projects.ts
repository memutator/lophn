import { z } from "zod";
import { archiveStateSchema } from "../base/values.ts";
import {
  absolutePathSchema,
  projectIdSchema,
  revisionSchema,
  slugSchema,
} from "./values.ts";

const folderFields = {
  path: absolutePathSchema,
  description: z.string(),
};
export const folderOutputSchema = z.object(folderFields);
export const foldersOutputSchema = z.array(folderOutputSchema);

export const trackingGlobSchema = z.string().min(1).refine(
  (value) =>
    !value.startsWith("/") && !/^[A-Za-z]:/.test(value) &&
    !/[\\p{Cc}]/u.test(value) &&
    !value.split("/").includes(".."),
  { message: "glob must be root-relative without parent components" },
);
const patternFields = {
  effect: z.enum(["include", "exclude"]),
  glob: trackingGlobSchema,
};
export const trackingPatternOutputSchema = z.object(patternFields);
const trackingFields = {
  enabled: z.boolean(),
  use_gitignore: z.boolean(),
};
export const trackingRuleSetOutputSchema = z.object({
  ...trackingFields,
  patterns: z.array(trackingPatternOutputSchema),
});

const projectMetadataFields = {
  id: projectIdSchema,
  name: slugSchema,
  title: z.string().min(1),
  purpose: z.string(),
  revision: revisionSchema,
  status: archiveStateSchema,
};
export const projectSchema = z.object({
  ...projectMetadataFields,
  folders: foldersOutputSchema,
  tracking: trackingRuleSetOutputSchema,
});
export type Project = z.infer<typeof projectSchema>;
export const agentProjectSchema = z.object(projectMetadataFields);
export type AgentProject = z.infer<typeof agentProjectSchema>;
export const userProjectSchema = projectSchema.extend({
  initial_tracking_proposal: trackingRuleSetOutputSchema,
});
export const projectReadSchema = z.union([
  userProjectSchema,
  agentProjectSchema,
]);
export const projectInputSchema = z.strictObject({ project: projectIdSchema });
