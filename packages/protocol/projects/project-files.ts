import { z } from "zod";
import { atSchema, sha256Schema } from "../base/values.ts";
import { defineMemory, defineRead } from "../base/route.ts";
import {
  absolutePathSchema,
  projectIdSchema,
  relativePathSchema,
} from "./values.ts";

/** project_files 읽고 쓰기 한 파일 상한(1 MiB). */
export const PROJECT_FILE_MAX_BYTES = 1024 * 1024;

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
  output: z.object({
    text: z.string(),
    truncated: z.boolean(),
    hash: sha256Schema.optional(),
    modified_at: atSchema.optional(),
  }),
  actors: ["user"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "unavailable",
  ],
});

// 등록 폴더 안 UTF-8 글 file을 원자 교체로 쓴다. 1 MiB까지이고 base_hash를 실으면 디스크와 다를 때 conflict다.
export const projectFilesWrite = defineMemory({
  resource: "project_files",
  method: "write",
  name: "project_files.write",
  input: z.strictObject({
    project: projectIdSchema,
    folder: absolutePathSchema.optional(),
    path: relativePathSchema,
    text: z.string(),
    base_hash: sha256Schema.nullable().optional(),
  }),
  output: z.strictObject({ hash: sha256Schema }),
  actors: ["user"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "conflict",
    "unavailable",
  ],
});

// 등록 폴더 안에 빈 새 file이나 폴더를 만든다. 이미 있으면 conflict다.
export const projectFilesCreate = defineMemory({
  resource: "project_files",
  method: "create",
  name: "project_files.create",
  input: z.strictObject({
    project: projectIdSchema,
    folder: absolutePathSchema.optional(),
    path: relativePathSchema,
    kind: z.enum(["file", "folder"]),
  }),
  output: z.strictObject({}),
  actors: ["user"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "conflict",
    "unavailable",
  ],
});

// 같은 등록 폴더 안에서 이름 바꾸기·옮기기. 대상이 이미 있으면 conflict, 폴더를 자기 안으로 옮기면 invalid_input이다.
export const projectFilesRename = defineMemory({
  resource: "project_files",
  method: "rename",
  name: "project_files.rename",
  input: z.strictObject({
    project: projectIdSchema,
    folder: absolutePathSchema.optional(),
    from: relativePathSchema,
    to: relativePathSchema,
  }),
  output: z.strictObject({}),
  actors: ["user"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "conflict",
    "unavailable",
  ],
});

// 등록 폴더 안의 file이나 폴더를 지운다.
export const projectFilesRemove = defineMemory({
  resource: "project_files",
  method: "remove",
  name: "project_files.remove",
  input: z.strictObject({
    project: projectIdSchema,
    folder: absolutePathSchema.optional(),
    path: relativePathSchema,
  }),
  output: z.strictObject({}),
  actors: ["user"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "unavailable",
  ],
});

export const projectFilesWriteBytes = defineMemory({
  body_max_bytes: 32 * 1024 * 1024,
  resource: "project_files",
  method: "write_bytes",
  name: "project_files.write_bytes",
  input: z.strictObject({
    project: projectIdSchema,
    folder: absolutePathSchema.optional(),
    path: relativePathSchema,
    data_base64: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/),
    overwrite: z.boolean().optional(),
  }),
  output: z.strictObject({
    hash: sha256Schema,
    size: z.number().int().nonnegative(),
  }),
  actors: ["user"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "conflict",
    "unavailable",
  ],
});

export const projectFilesCopy = defineMemory({
  resource: "project_files",
  method: "copy",
  name: "project_files.copy",
  input: z.strictObject({
    project: projectIdSchema,
    folder: absolutePathSchema.optional(),
    from: relativePathSchema,
    to: relativePathSchema,
    overwrite: z.boolean().optional(),
  }),
  output: z.strictObject({
    copied: z.boolean(),
  }),
  actors: ["user"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "conflict",
    "unavailable",
  ],
});

export const PROJECT_FILES_MUTATION_ROUTES = [
  projectFilesWrite,
  projectFilesWriteBytes,
  projectFilesCreate,
  projectFilesRename,
  projectFilesCopy,
  projectFilesRemove,
] as const;

export const PROJECT_FILES_ROUTES = [
  projectFilesList,
  projectFilesRead,
  ...PROJECT_FILES_MUTATION_ROUTES,
] as const;
