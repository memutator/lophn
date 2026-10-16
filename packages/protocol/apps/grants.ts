import { z } from "zod";
import { atSchema } from "../base/values.ts";
import { defineCommand, defineRead } from "../base/route.ts";
import { withReadCommon } from "../base/envelope.ts";
import { appIdSchema, grantIdSchema } from "./channel-values.ts";
import { appGrantScopeSchema } from "./permissions.ts";

export const GRANT_STATES = ["active", "revoked"] as const;
const grantStateSchema = z.enum(GRANT_STATES);

// 같은 (app,kind,정규 scope)의 active grant는 하나다. 중복은 handler가
// grants 집합의 partial unique로 거절한다.
// scope·요구의 교집합 판정은 runtime이고 Grant 자체는 사람이 허락한 범위만 담는다.

// 새 앱 grant. activation 한 번에 만들고 approval·created_by 칸이 없다.
export const appGrantSchema = z.object({
  id: grantIdSchema,
  app: appIdSchema,
  scope: appGrantScopeSchema,
  status: grantStateSchema,
  created_at: atSchema,
  revoked_at: atSchema.nullable(),
}).refine(
  (value) => value.scope.kind !== "app.call" || value.scope.app !== value.app,
  { message: "app.call grant cannot target its own app" },
).refine(
  (value) => (value.status === "revoked") === (value.revoked_at !== null),
  { message: "revoked_at belongs to a revoked grant" },
);
export type AppGrant = z.infer<typeof appGrantSchema>;

// grant.create 입력. 검증된 approval만 받는다.

// 앱에 activation이 진행 중이면 handler가 conflict로 거절한다.

// grant.revoke 입력. 종료 확인 근거는 suppression 관측의 사실이며
// handler가 현재 프로세스 종료·이미 멈춤을 검사한다.

// grant.revoke는 사람의 결정이다.

const readActors = ["user", "coding_agent", "agent", "app", "machine"] as const;
const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;

export const GRANT_LIST_MAX_COUNT = 200;

// 현재 app의 grant. 선언 교집합 계산은 read를 부르는 쪽이다.
const grantsListInputSchema = z.strictObject({
  app: appIdSchema.optional(),
  status: grantStateSchema.optional(),
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(GRANT_LIST_MAX_COUNT).optional(),
});

// grant 결정 confirmation이 보여 주는 자료의 경고 key.
// 문구 본문은 design wording catalog의 몫이다.

// 현재 release가 선언한 요구 하나와 같은 정규 scope의 active grant가 있는지.
// outside_links는 파일 검사(부여 준비)가 채운다. read는 파일 I/O를 하지 않아 빈 목록이다.

// grant 결정의 표시 자료. 요구·reason·정규 scope·조합 경고·
// Deno 한계 문구 key만 담고 grant를 자동으로 만들지 않는다.

// display는 app을 지정했고 그 앱의 현재 release 선언을 알 때만 있다. 그 밖에는 null이다.
// 필드를 모르는 옛 소비자는 무시하므로 additive다.

// 새 앱 grant route. 출력은 appGrantSchema다.
export const appGrantsList = defineRead({
  resource: "app_grants",
  method: "list",
  name: "app_grants.list",
  input: grantsListInputSchema,
  output: withReadCommon(z.object({ grants: z.array(appGrantSchema) })),
  actors: readActors,
  errors: readErrors,
});

// 사람의 결정이다. 앱 상세 Access 탭 안에서 받으므로 확인 handle은 없다. reason은 거두는 이유 한 줄이다.
export const appGrantRevoke = defineCommand({
  resource: "app_grants",
  method: "revoke",
  name: "app_grants.revoke",
  input: z.strictObject({
    grant: grantIdSchema,
    reason: z.string().min(1).optional(),
  }),
  output: z.object({ grant: appGrantSchema }),
  actors: ["user"],
  errors: ["conflict", "unavailable"],
});

export const APP_GRANT_ROUTES = [appGrantsList, appGrantRevoke] as const;

// payload의 scope 종류는 Grant kind와 같아야 한다.

