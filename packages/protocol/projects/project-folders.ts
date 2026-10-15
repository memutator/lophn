import { z } from "zod";
import { absolutePathSchema, relativePathSchema } from "./values.ts";

// 연결한 폴더 안의 하위 폴더다. 하위 폴더를 지정해도 project에 든 파일의 범위는 바뀌지 않는다.
// 연결 폴더 밖으로 나가는 symlink는 core가 거절한다.
const subfolderFields = {
  path: relativePathSchema,
  description: z.string(),
};
export const subfolderSchema = z.strictObject(subfolderFields);
export const subfolderOutputSchema = z.object(subfolderFields);
export type Subfolder = z.infer<typeof subfolderSchema>;

function distinct(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

const folderFields = {
  path: absolutePathSchema,
  description: z.string(),
};
export const projectFolderSchema = z.strictObject({
  ...folderFields,
  subfolders: z.array(subfolderSchema),
}).refine((value) => distinct(value.subfolders.map((sub) => sub.path)), {
  message: "duplicate subfolder path",
});
export const projectFolderOutputSchema = z.object({
  ...folderFields,
  subfolders: z.array(subfolderOutputSchema),
});
export type ProjectFolder = z.infer<typeof projectFolderSchema>;

// 폴더 없이 등록할 수 없다.
export const projectFoldersSchema = z.array(projectFolderSchema).min(1).refine(
  (folders) => distinct(folders.map((folder) => folder.path)),
  { message: "duplicate folder path" },
);

// found: 디스크에 있는지. false면 화면이 "찾을 수 없음"을 보인다.
export const projectFolderReadSchema = z.object({
  ...folderFields,
  subfolders: z.array(subfolderOutputSchema),
  found: z.boolean(),
});
export type ProjectFolderRead = z.infer<typeof projectFolderReadSchema>;
