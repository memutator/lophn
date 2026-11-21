// 이 기계에 없는 project를 core가 git clone하고 등록하는 memory route. 실패의 `details.reason`은 호출한 쪽(agent)이 갈라 읽는다:
// projects_folder_unset, git_auth(details.command), git_not_found, timeout, git_failed, target_exists(details.path),
// identity_in_use(이 기계의 다른 project가 그 id를 옛 identity로 가졌다).
import { z } from "zod";
import { defineMemory } from "../base/route.ts";
import { projectRecordSchema } from "./project-api.ts";
import { absolutePathSchema, projectIdentitySchema } from "./values.ts";

export const projectClone = defineMemory({
  resource: "projects",
  method: "clone",
  name: "project.clone",
  changes: ["projects"],
  input: z.strictObject({
    url: z.string().min(1).max(2048),
    parent: absolutePathSchema.optional(),
    name: z.string().min(1).max(255).optional(),
    title: z.string().min(1).optional(),
    identity: projectIdentitySchema.optional(),
  }),
  output: z.object({
    project: projectRecordSchema,
    path: absolutePathSchema,
    cloned: z.boolean(),
  }),
  actors: ["user", "agent"],
  errors: ["invalid_input", "conflict", "forbidden", "unavailable"],
});

export const PROJECT_CLONE_ROUTES = [projectClone] as const;
