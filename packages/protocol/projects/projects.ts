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
});
const agentProjectSchema = z.object(projectMetadataFields);
export const projectReadSchema = z.union([
  projectSchema,
  agentProjectSchema,
]);
export const projectInputSchema = z.strictObject({ project: projectIdSchema });
