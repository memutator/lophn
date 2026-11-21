// 기계를 넘는 project id의 route. id는 등록할 때 ledger에서 나고 lophn은 사람의 저장소에 아무것도 쓰지 않는다.
// record_identity는 core가 폴더에서 읽은 git 여부와 remote를 적는 machine command, match_identity는 core가 내 다른 컴퓨터의
// 같은 저장소와 id를 맞추는 machine command, link_identity는 사람이 git이 아닌 project를 다른 기계의 project와 잇는 command,
// renew_identity는 사람의 [Separate project]이고, identity·match는 폴더를 읽는 memory route다.
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

export const projectIdentityStatusSchema = z.object({
  project: projectIdSchema,
  identity: projectIdentitySchema,
  repo: repoSchema,
  folder: absolutePathSchema.nullable(),
  found: z.boolean(),
  remote: remoteSchema,
  separated: z.boolean(),
  // 같은 remote key를 가진 이 기계의 다른 active project(나누지 않은 것). 있으면 둘 다 다른 컴퓨터와 자동으로 맞춰지지 않는다.
  same_repository: projectIdSchema.nullable(),
});
export type ProjectIdentityStatus = z.infer<typeof projectIdentityStatusSchema>;

// 등록 전 폴더를 읽은 값. same_repository는 같은 remote key를 가진 이 기계의 project다(폴더를 잃은 project의 relink 제안 포함).
export const projectMatchSchema = z.object({
  found: z.boolean(),
  repo: repoSchema,
  remote: remoteSchema,
  same_repository: z.array(projectRecordSchema),
});
export type ProjectMatch = z.infer<typeof projectMatchSchema>;

const projectInputSchema = z.strictObject({ project: projectIdSchema });

export const projectIdentityApi = {
  // found가 false면 아무것도 바꾸지 않는다. identity는 바꾸지 않는다. revision은 올리지 않는다.
  recordIdentity: defineCommand({
    resource: "projects",
    method: "record_identity",
    name: "project.record_identity",
    changes: [{ name: "projects", id: (input) => input.project }],
    input: z.strictObject({
      project: projectIdSchema,
      found: z.boolean(),
      repo: repoSchema,
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
  // 내 다른 컴퓨터의 같은 저장소의 project에 맞춘다: 더 작은 id로 바꾸거나(identity), 다른 컴퓨터가 나눈 project의 id를 가졌으면
  // 나눈 것으로 적는다(separated). 지금 identity가 from이 아니거나 규칙에 맞지 않으면 conflict이고 아무것도 바꾸지 않는다(늦게 돈
  // 계산이 덮지 않게). core 안 machine 자격만 부른다. revision은 올리지 않는다.
  matchIdentity: defineCommand({
    resource: "projects",
    method: "match_identity",
    name: "project.match_identity",
    changes: [{ name: "projects", id: (input) => input.project }],
    input: z.union([
      z.strictObject({
        project: projectIdSchema,
        from: projectIdentitySchema,
        identity: projectIdentitySchema,
      }),
      z.strictObject({
        project: projectIdSchema,
        from: projectIdentitySchema,
        separated: z.literal(true),
      }),
    ]),
    output: projectRecordSchema,
    actors: ["machine"],
    errors: ["invalid_input", "not_found", "conflict", "forbidden"],
  }),
  // git이 아닌 project에 다른 기계의 같은 project의 identity를 적는다. git project는 저장소로 자동으로 맞춰져 거절한다
  // (`details.reason: "git_project"`). 이 기계의 다른 project(보관 포함)가 지금이나 옛 identity로 가진 id도 거절한다
  // (`identity_in_use`). 다른 기계에서 무엇이 같은 project인지를 바꾸므로 사람만 한다. revision은 올리지 않는다.
  linkIdentity: defineCommand({
    resource: "projects",
    method: "link_identity",
    name: "project.link_identity",
    changes: ["projects"],
    input: z.strictObject({
      project: projectIdSchema,
      identity: projectIdentitySchema,
    }),
    output: projectRecordSchema,
    actors: ["user"],
    errors: ["invalid_input", "not_found", "conflict", "forbidden"],
  }),
  // [Separate project]: 새 id를 주고 나눈 것으로 적는다. 나눈 project는 어느 컴퓨터에서도 같은 저장소와 자동으로 맞춰지지
  // 않는다. 다른 기계에서 무엇이 같은 project인지를 바꾸므로 사람만 한다. revision은 올리지 않는다.
  renewIdentity: defineCommand({
    resource: "projects",
    method: "renew_identity",
    name: "project.renew_identity",
    changes: [{ name: "projects", id: (input) => input.project }],
    input: projectInputSchema,
    output: projectRecordSchema,
    actors: ["user"],
    errors: ["invalid_input", "not_found", "forbidden"],
  }),
  // 첫 폴더를 다시 읽어 적고 id와 같은 저장소를 돌려준다.
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
  projectIdentityApi.match,
] as const;
