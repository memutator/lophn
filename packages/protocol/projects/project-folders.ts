import { z } from "zod";
import { absolutePathSchema, relativePathSchema } from "./values.ts";

// 연결한 폴더 안의 하위 폴더다. 하위 폴더를 지정해도 project에 든 파일의 범위는 바뀌지 않는다.
// 연결 폴더 밖으로 나가는 symlink는 core가 거절한다.
const subfolderFields = {
  path: relativePathSchema,
  description: z.string(),
};
const subfolderSchema = z.strictObject(subfolderFields);
const subfolderOutputSchema = z.object(subfolderFields);

function distinct(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

const folderFields = {
  path: absolutePathSchema,
  description: z.string(),
};
const projectFolderSchema = z.strictObject({
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

export const projectFoldersSchema = z.array(projectFolderSchema).refine(
  (folders) => distinct(folders.map((folder) => folder.path)),
  { message: "duplicate folder path" },
);

// found: 디스크에 있는지. false면 화면이 "찾을 수 없음"을 보인다.
export const projectFolderReadSchema = z.object({
  ...folderFields,
  subfolders: z.array(subfolderOutputSchema),
  found: z.boolean(),
});
