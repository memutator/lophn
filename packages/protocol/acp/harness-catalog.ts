import { z } from "zod";
import { defineMemory, defineRead } from "../base/route.ts";
import { agentWorkspaceSchema } from "../lophn-agent/agent-values.ts";
import { GUI_HARNESSES } from "../coding-agent/gui-harness.ts";
import { acpModelGroupSchema } from "./session.ts";

// harness CLI가 알려 주는 model 목록(catalog)이다. 값에 workspace(lophn-agent)와 model 묶음(acp)이 모두 걸려 coding-agent에 둘 수 없고 acp에 둔다.
// Agent Profile 편집기가 `harness_config`의 model·option을 고를 때 읽는다.
// core의 HarnessCatalogManager가 cache를 두고, `read`는 cache를 주며 `probe`가 true이고 비었거나 오래됐을 때만 CLI를 한 번 띄운다.
// `refresh`는 늘 CLI를 다시 띄운다. `workspace`는 CLI를 띄울 cwd를 고른다(없으면 Home).
// 조회 실패는 오류가 아니라 값(`status: "error"`)이다: 편집기가 이미 저장한 선택을 지키고 경고만 보인다.

const harnessSchema = z.enum(GUI_HARNESSES);
const workspaceField = agentWorkspaceSchema.nullable().optional();

const catalogSchema = z.strictObject({
  models: z.array(acpModelGroupSchema),
  defaults: z.strictObject({
    model: z.string().nullable(),
    options: z.record(z.string(), z.string()),
  }),
});

// empty는 CLI가 model을 하나도 알리지 않은 것이고 catalog는 null이다. stale은 마지막 성공 결과를 다시 받지 못해 오래된 값을 주는 것이다.
export const harnessCatalogViewSchema = z.strictObject({
  harness: harnessSchema,
  status: z.enum(["ready", "empty", "error"]),
  catalog: catalogSchema.nullable(),
  fetched_at: z.string().nullable(),
  stale: z.boolean(),
  error: z.string().nullable(),
});
export type HarnessCatalogView = z.infer<typeof harnessCatalogViewSchema>;

const errors = [
  "invalid_input",
  "not_found",
  "unauthorized",
  "forbidden",
] as const;

export const harnessCatalogRead = defineRead({
  resource: "harness_catalog",
  method: "read",
  name: "HarnessCatalogRead",
  input: z.strictObject({
    harness: harnessSchema,
    workspace: workspaceField,
    probe: z.boolean().optional(),
  }),
  output: harnessCatalogViewSchema,
  actors: ["user"],
  errors,
});

export const harnessCatalogRefresh = defineMemory({
  resource: "harness_catalog",
  method: "refresh",
  name: "HarnessCatalogRefresh",
  changes: [],
  input: z.strictObject({
    harness: harnessSchema,
    workspace: workspaceField,
  }),
  output: harnessCatalogViewSchema,
  actors: ["user"],
  errors,
});

export const HARNESS_CATALOG_ROUTES = [
  harnessCatalogRead,
  harnessCatalogRefresh,
] as const;
