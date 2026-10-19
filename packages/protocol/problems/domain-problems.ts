import { z } from "zod";
import { atSchema, seqSchema } from "../base/values.ts";
import { defineCommand, defineRead } from "../base/route.ts";
import { idSchema } from "../base/ids.ts";
import { withReadCommon } from "../base/envelope.ts";
import { violationSchema } from "../projects/kinds-api.ts";
import { KINDS_VIOLATION_CAP } from "../projects/kinds-work.ts";

// kind 위반을 담는 domain 범위의 problem이다. 앱 problem과 id 접두(`prb`)만 같고 표가 다르다.
// 위반의 정체성 key는 (source, kind, path, field, rule)이다. 같은 key는 같은 problem이다.
// `opened_at`은 지금 열린 구간이 시작된 시각이다. `seq`는 만들 때 1이고 상태가 바뀔 때마다 1씩 오른다.
// 위반이 사라지면 program이 닫으므로 `ignored`는 없다.
const domainProblemStateSchema = z.enum(["open", "resolved"]);
export const domainProblemSchema = z.strictObject({
  id: idSchema("prb"),
  domain: idSchema("dom"),
  violation: violationSchema,
  state: domainProblemStateSchema,
  opened_at: atSchema,
  state_changed_at: atSchema,
  last_seen_at: atSchema,
  seq: seqSchema,
});
export type DomainProblem = z.infer<typeof domainProblemSchema>;

// 이 domain의 지금 위반 전체를 알린다. `truncated`이면 목록이 일부라 안 보이는 열린 것을 닫지 않는다.
// `id`는 그 위반이 처음 보이는 것일 때만 쓰는 새 id다(core가 id를 만들지 않는다).
export const problemSyncDomain = defineCommand({
  resource: "problems",
  method: "sync_domain",
  name: "problem.sync_domain",
  input: z.strictObject({
    domain: idSchema("dom"),
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

const DOMAIN_PROBLEM_LIST_LIMIT = 100;
// 최근에 바뀐 것부터(`state_changed_at` 내림차순, id로 tie-break) 보인다.
export const problemListDomain = defineRead({
  resource: "problems",
  method: "list_domain",
  name: "problem.list_domain",
  input: z.strictObject({
    domain: idSchema("dom"),
    state: domainProblemStateSchema.optional(),
    cursor: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(DOMAIN_PROBLEM_LIST_LIMIT).optional(),
  }),
  output: withReadCommon(z.object({
    problems: z.array(domainProblemSchema),
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

export const DOMAIN_PROBLEM_ROUTES = [
  problemSyncDomain,
  problemListDomain,
] as const;
