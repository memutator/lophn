import { z } from "zod";
import { atSchema } from "../base/values.ts";
import { defineRead } from "../base/route.ts";
import {
  absolutePathSchema,
  projectIdSchema,
  relativePathSchema,
} from "./values.ts";

// folder는 등록 폴더 중 하나다. 없으면 project의 첫 폴더다. path는 그 폴더 기준 상대 path다.
const projectFilesListInputSchema = z.strictObject({
  project: projectIdSchema,
  folder: absolutePathSchema.optional(),
  path: relativePathSchema.optional(),
});

const projectFileEntrySchema = z.object({
  name: z.string().min(1),
  kind: z.enum(["file", "folder"]),
  size: z.number().int().min(0),
  modified_at: atSchema,
});
export type ProjectFileEntry = z.infer<typeof projectFileEntrySchema>;

// 폴더가 먼저, 이름 순. .git과 node_modules는 내지 않는다.
export const projectFilesList = defineRead({
  resource: "project_files",
  method: "list",
  name: "project_files.list",
  input: projectFilesListInputSchema,
  output: z.object({ entries: z.array(projectFileEntrySchema) }),
  actors: ["user"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "unavailable",
  ],
});

const projectFilesReadInputSchema = z.strictObject({
  project: projectIdSchema,
  folder: absolutePathSchema.optional(),
  path: relativePathSchema,
});

// UTF-8 글 file만 읽는다. 1 MiB를 넘으면 앞 1 MiB(글자 경계까지)만 주고 truncated가 참이다.
export const projectFilesRead = defineRead({
  resource: "project_files",
  method: "read",
  name: "project_files.read",
  input: projectFilesReadInputSchema,
  output: z.object({ text: z.string(), truncated: z.boolean() }),
  actors: ["user"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "unavailable",
  ],
});

export const PROJECT_FILES_ROUTES = [
  projectFilesList,
  projectFilesRead,
] as const;
