import { z } from "zod";
import { defineRead } from "../base/route.ts";
import { idSchema } from "../base/ids.ts";
import { withReadCommon } from "../base/envelope.ts";
import { atSchema } from "../base/values.ts";
import { COST_KINDS, tokenUsageSchema } from "./model-call-values.ts";
import { modelChoiceOutputSchema } from "./models.ts";
import { CREDENTIAL_STATES, UNAVAILABLE_REASONS } from "./provider-values.ts";
import { sessionTitleSchema } from "./sessions.ts";

// `/status` panel이 읽는 session 하나의 지금 값이다. 저장하는 표가 아니라 sessions·model_calls·turns에서
// 그때그때 합치는 derived 값이다. 한 번에 읽어 panel이 여러 route를 돌지 않는다.

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const nonblank = z.string().refine((value) => value.trim().length > 0, {
  message: "expected nonblank text",
});
const decimal = z.string().regex(/^(0|[1-9][0-9]{0,17})(\.[0-9]{1,6})?$/);
const currency = z.string().regex(/^[A-Z]{3}$/);

// 마지막으로 끝난 판단 call이 provider에 보낸 prompt 크기와 그 call이 쓴 창의 한도다. 그 call의
// usage를 모르면 없다.
const contextSchema = z.object({
  tokens: count,
  limit: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});

const costTotalSchema = z.object({
  kind: z.enum(COST_KINDS),
  currency: currency.nullable(),
  // 같은 kind·통화 안의 합. 하나라도 모르면 null이다(0으로 채우지 않는다).
  amount: decimal.nullable(),
  calls: count,
});

// session이 고른 model(없으면 마지막 판단 call의 model)을 붙인 provider의 credential 상태.
const providerStatusSchema = z.object({
  name: nonblank,
  definition: nonblank,
  account: nonblank.nullable(),
  state: z.enum(CREDENTIAL_STATES),
  reason: z.enum(UNAVAILABLE_REASONS).nullable(),
  until: atSchema.nullable(),
});

export const sessionStatusRead = defineRead({
  resource: "sessions",
  method: "status",
  name: "ReadSessionStatus",
  input: z.strictObject({ session: idSchema("ses") }),
  output: withReadCommon(
    z.object({
      session: idSchema("ses"),
      title: sessionTitleSchema.nullable(),
      // session이 고른 model. 고르지 않았으면 마지막 판단 call이 실제로 쓴 model이고, 그것도 없으면 null이다.
      model: modelChoiceOutputSchema.nullable(),
      context: contextSchema.nullable(),
      // 이 session에서 일어난 model 호출 시도 전부(재시도 포함)와 turn 수다.
      calls: count,
      turns: count,
      tokens: tokenUsageSchema,
      costs: z.array(costTotalSchema),
      provider: providerStatusSchema.nullable(),
    }),
  ),
  actors: ["user", "agent", "machine"],
  errors: ["invalid_input", "unauthorized", "forbidden", "not_found"],
});

export const SESSION_STATUS_ROUTES = [sessionStatusRead] as const;
