// 기계를 넘는 project id의 route. record_identity는 core가 폴더에서 읽은 값을 ledger에 적는 machine command이고,
// 나머지는 폴더를 읽고 쓰는 memory route다.
import { z } from "zod";
import { defineCommand, defineMemory } from "../base/route.ts";
import { projectRecordSchema } from "./project-api.ts";
import {
  absolutePathSchema,
  projectIdentitySchema,
  projectIdSchema,
} from "./values.ts";

const repoSchema = z.enum(["git", "none"]).nullable();
const remoteSchema = z.object({ key: z.string(), url: z.string() }).nullable();

// missing은 ledger에 id가 있는데 file이 없다는 뜻, ignored는 `.gitignore`가 file을 빼 다른 기계로 가지 않는다는 뜻이다.
const identityFileStateSchema = z.enum([
  "none",
  "committed",
  "uncommitted",
  "ignored",
  "conflict",
  "missing",
  "unreadable",
]);

export const projectIdentityStatusSchema = z.object({
  project: projectIdSchema,
  identity: projectIdentitySchema.nullable(),
  file: identityFileStateSchema,
  repo: repoSchema,
  folder: absolutePathSchema.nullable(),
  found: z.boolean(),
  remote: remoteSchema,
  // 같은 id를 먼저 가진 이 기계의 다른 project(같은 저장소의 두 번째 copy).
  duplicate_of: projectIdSchema.nullable(),
});
export type ProjectIdentityStatus = z.infer<typeof projectIdentityStatusSchema>;

// 등록 전 폴더를 읽은 값과 이 기계의 힌트. same은 같은 id를 가진 project, suggestions는 remote key가 같은 project다.
export const projectMatchSchema = z.object({
  found: z.boolean(),
  repo: repoSchema,
  file: identityFileStateSchema,
  identity: projectIdentitySchema.nullable(),
  remote: remoteSchema,
  same: projectRecordSchema.nullable(),
  suggestions: z.array(projectRecordSchema),
});
export type ProjectMatch = z.infer<typeof projectMatchSchema>;

const projectInputSchema = z.strictObject({ project: projectIdSchema });

export const projectIdentityApi = {
  // found가 false면 아무것도 바꾸지 않는다. file_identity가 null이면 ledger의 id를 잊지 않는다. revision은 올리지 않는다.
  recordIdentity: defineCommand({
    resource: "projects",
    method: "record_identity",
    name: "project.record_identity",
    // 같은 id를 가진 다른 project의 값도 바뀔 수 있어 표 전체를 알린다.
    changes: ["projects"],
    input: z.strictObject({
      project: projectIdSchema,
      found: z.boolean(),
      repo: repoSchema,
      file_identity: projectIdentitySchema.nullable(),
      remote: z
        .strictObject({
          key: z.string().min(1).max(1024),
          url: z.string().min(1).max(2048),
        })
        .nullable(),
    }),
    output: projectRecordSchema,
    actors: ["machine"],
    errors: ["invalid_input", "not_found", "forbidden"],
  }),
  identity: defineMemory({
    resource: "projects",
    method: "identity",
    name: "project.identity",
    changes: [{ name: "projects", id: (input) => input.project }],
    input: projectInputSchema,
    output: projectIdentityStatusSchema,
    actors: ["user", "agent"],
    errors: ["invalid_input", "not_found", "forbidden", "unavailable"],
  }),
  // file이 없을 때만 만든다. 읽을 수 있는 file은 덮지 않는다.
  createIdentity: defineMemory({
    resource: "projects",
    method: "create_identity",
    name: "project.create_identity",
    changes: [{ name: "projects", id: (input) => input.project }],
    input: projectInputSchema,
    output: projectIdentityStatusSchema,
    actors: ["user", "agent"],
    errors: [
      "invalid_input",
      "not_found",
      "conflict",
      "forbidden",
      "unavailable",
    ],
  }),
  // 새 id로 덮어 다른 기계에서 무엇이 같은 project인지를 바꾸므로 사람만 한다.
  renewIdentity: defineMemory({
    resource: "projects",
    method: "renew_identity",
    name: "project.renew_identity",
    changes: [{ name: "projects", id: (input) => input.project }],
    input: projectInputSchema,
    output: projectIdentityStatusSchema,
    actors: ["user"],
    errors: [
      "invalid_input",
      "not_found",
      "conflict",
      "forbidden",
      "unavailable",
    ],
  }),
  match: defineMemory({
    resource: "projects",
    method: "match",
    name: "project.match",
    changes: ["projects"],
    input: z.strictObject({ path: absolutePathSchema }),
    output: projectMatchSchema,
    actors: ["user"],
    errors: ["invalid_input", "forbidden", "unavailable"],
  }),
} as const;

// ROUTES에는 handler를 짓는 쪽이 펼친다: core 기동은 handler 없는 memory route를 거절한다.
export const PROJECT_IDENTITY_MEMORY_ROUTES = [
  projectIdentityApi.identity,
  projectIdentityApi.createIdentity,
  projectIdentityApi.renewIdentity,
  projectIdentityApi.match,
] as const;
