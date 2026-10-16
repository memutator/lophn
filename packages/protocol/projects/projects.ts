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
const folderOutputSchema = z.object(folderFields);
const foldersOutputSchema = z.array(folderOutputSchema);

const trackingGlobSchema = z.string().min(1).refine(
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
const trackingPatternOutputSchema = z.object(patternFields);
const trackingFields = {
  enabled: z.boolean(),
  use_gitignore: z.boolean(),
};
const trackingRuleSetOutputSchema = z.object({
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
const projectSchema = z.object({
  ...projectMetadataFields,
  folders: foldersOutputSchema,
  tracking: trackingRuleSetOutputSchema,
});
const agentProjectSchema = z.object(projectMetadataFields);
const userProjectSchema = projectSchema.extend({
  initial_tracking_proposal: trackingRuleSetOutputSchema,
});
export const projectReadSchema = z.union([
  userProjectSchema,
  agentProjectSchema,
]);
export const projectInputSchema = z.strictObject({ project: projectIdSchema });
