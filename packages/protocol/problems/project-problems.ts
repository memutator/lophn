import { z } from "zod";
import { atSchema, seqSchema } from "../base/values.ts";
import { defineCommand, defineRead } from "../base/route.ts";
import { idSchema } from "../base/ids.ts";
import { withReadCommon } from "../base/envelope.ts";
import { violationSchema } from "../projects/kinds-api.ts";
import { KINDS_VIOLATION_CAP } from "../projects/kinds-work.ts";

// kind 위반을 담는 project 범위의 problem이다. 앱 problem과 id 접두(`prb`)만 같고 표가 다르다.
// 위반의 정체성 key는 (source, kind, path, field, rule)이다. 같은 key는 같은 problem이다.
// `opened_at`은 지금 열린 구간이 시작된 시각이다. `seq`는 만들 때 1이고 상태가 바뀔 때마다 1씩 오른다.
// 위반이 사라지면 program이 닫으므로 `ignored`는 없다.
const projectProblemStateSchema = z.enum(["open", "resolved"]);
export const projectProblemSchema = z.strictObject({
  id: idSchema("prb"),
  project: idSchema("prj"),
  violation: violationSchema,
  state: projectProblemStateSchema,
  opened_at: atSchema,
  state_changed_at: atSchema,
  last_seen_at: atSchema,
  seq: seqSchema,
});
export type ProjectProblem = z.infer<typeof projectProblemSchema>;

// 이 project의 지금 위반 전체를 알린다. `truncated`이면 목록이 일부라 안 보이는 열린 것을 닫지 않는다.
// `id`는 그 위반이 처음 보이는 것일 때만 쓰는 새 id다(core가 id를 만들지 않는다).
export const problemSyncProject = defineCommand({
  resource: "problems",
  method: "sync_project",
  name: "problem.sync_project",
  input: z.strictObject({
    project: idSchema("prj"),
    violations: z.array(z.strictObject({
      id: idSchema("prb"),
      violation: violationSchema,
    })).max(KINDS_VIOLATION_CAP),
    truncated: z.boolean(),
  }),
  output: z.strictObject({
    opened: z.number().int().nonnegative(),
    reopened: z.number().int().nonnegative(),
    resolved: z.number().int().nonnegative(),
    unchanged: z.number().int().nonnegative(),
  }),
  compare: z.strictObject({}),
  actors: ["machine"],
  errors: ["invalid_input", "forbidden"],
});

const PROJECT_PROBLEM_LIST_LIMIT = 100;
// 최근에 바뀐 것부터(`state_changed_at` 내림차순, id로 tie-break) 보인다.
export const problemListProject = defineRead({
  resource: "problems",
  method: "list_project",
  name: "problem.list_project",
  input: z.strictObject({
    project: idSchema("prj"),
    state: projectProblemStateSchema.optional(),
    cursor: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(PROJECT_PROBLEM_LIST_LIMIT).optional(),
  }),
  output: withReadCommon(z.object({
    problems: z.array(projectProblemSchema),
  })),
  actors: ["user", "agent", "machine"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "unavailable",
  ],
});

export const PROJECT_PROBLEM_ROUTES = [
  problemSyncProject,
  problemListProject,
] as const;
