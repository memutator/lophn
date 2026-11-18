// project 더하기와 그 기계의 폴더 고르기. 더하기는 core가 id와 slug를 만들어 project.create를 부른 사람의 자격으로 보낸다.
// 폴더 목록은 다른 기기가 그 기계의 폴더를 고를 때 쓰고, 사람의 home 아래만 읽는다.
import { z } from "zod";
import { defineMemory } from "../base/route.ts";
import { projectFoldersSchema } from "./project-folders.ts";
import { projectRecordSchema } from "./project-api.ts";
import { absolutePathSchema } from "./values.ts";

export const projectAdd = defineMemory({
  resource: "projects",
  method: "add",
  name: "project.add",
  changes: [{ name: "projects", id: (_input, output) => output.id }],
  input: z.strictObject({
    title: z.string().min(1),
    purpose: z.string(),
    folders: projectFoldersSchema,
  }),
  output: projectRecordSchema,
  actors: ["user"],
  errors: ["invalid_input", "conflict", "forbidden", "unavailable"],
});

// entries는 폴더만, 이름순, 500개까지. path는 모두 realpath다. home에서는 parent가 null이다.
export const projectBrowse = defineMemory({
  resource: "projects",
  method: "browse",
  name: "project.browse",
  input: z.strictObject({ path: absolutePathSchema.optional() }),
  output: z.object({
    home: absolutePathSchema,
    path: absolutePathSchema,
    parent: absolutePathSchema.nullable(),
    entries: z.array(z.object({ name: z.string(), path: absolutePathSchema })),
    truncated: z.boolean(),
  }),
  actors: ["user"],
  errors: ["invalid_input", "not_found", "forbidden", "unavailable"],
});

export const PROJECT_ADD_ROUTES = [projectAdd, projectBrowse] as const;
