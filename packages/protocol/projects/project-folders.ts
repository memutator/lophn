import { z } from "zod";
import { absolutePathSchema } from "./values.ts";

const folderFields = {
  path: absolutePathSchema,
  description: z.string(),
};
const projectFolderSchema = z.strictObject(folderFields);
export const projectFolderOutputSchema = z.object(folderFields);
export type ProjectFolder = z.infer<typeof projectFolderSchema>;

export const projectFoldersSchema = z
  .array(projectFolderSchema)
  .refine(
    (folders) =>
      new Set(folders.map((folder) => folder.path)).size === folders.length,
    { message: "duplicate folder path" },
  );

// found: 디스크에 있는지. false면 화면이 "찾을 수 없음"을 보인다.
export const projectFolderReadSchema = z.object({
  ...folderFields,
  found: z.boolean(),
});
