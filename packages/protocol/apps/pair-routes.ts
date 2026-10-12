import { z } from "zod";
import { defineMemory } from "../base/route.ts";
import {
  appIdSchema,
  processNonceSchema,
  releaseIdSchema,
  runtimeModeSchema,
} from "./channel-values.ts";
import { appConnectOutputSchema } from "./channel.ts";
import {
  brokerAppsConfirmPollInputSchema,
  brokerAppsConfirmPollOutputSchema,
  brokerAppsConfirmRequestInputSchema,
  brokerAppsConfirmRequestOutputSchema,
  brokerAppsConnectInputSchema,
} from "./broker.ts";

// 앱 쌍 연결 준비·confirm의 core 쪽 입구다. 앱 자식은 broker socket으로만 요청하고
// supervisor가 그 자식 연결의 신원을 붙여 이 route로 core의 준비 서비스를 부른다. 서명 key는 core만
// 쥐므로 서명과 proof 발급은 core에서 한다. machine(supervisor) credential만 받고 신원 주장은 서비스가
// 현재 supervisor 관측과 맞춰 본다: 옛 프로세스·다른 release의 요청은 거절이다.
const sourceSchema = z.strictObject({
  app: appIdSchema,
  release: releaseIdSchema.nullable(),
  mode: runtimeModeSchema,
  process_nonce: processNonceSchema,
});

// 본문에서 자식 연결이 정하는 신원 필드(process_nonce·mode)는 source가 대신한다.
const { process_nonce: _n, mode: _m, ...connectFields } =
  brokerAppsConnectInputSchema.shape;
const { process_nonce: _n2, mode: _m2, ...requestFields } =
  brokerAppsConfirmRequestInputSchema.shape;
const { process_nonce: _n3, mode: _m3, ...pollFields } =
  brokerAppsConfirmPollInputSchema.shape;

const errors = [
  "unauthorized",
  "forbidden",
  "invalid_input",
  "conflict",
  "unavailable",
  "not_found",
] as const;

export const appPairPrepare = defineMemory({
  resource: "apps",
  method: "pair_prepare",
  name: "app.pair_prepare",
  input: z.strictObject({ source: sourceSchema, ...connectFields }),
  output: appConnectOutputSchema,
  actors: ["machine"],
  errors,
});

export const appPairConfirmRequest = defineMemory({
  resource: "apps",
  method: "pair_confirm_request",
  name: "app.pair_confirm_request",
  input: z.strictObject({ source: sourceSchema, ...requestFields }),
  output: brokerAppsConfirmRequestOutputSchema,
  actors: ["machine"],
  errors,
});

export const appPairConfirmPoll = defineMemory({
  resource: "apps",
  method: "pair_confirm_poll",
  name: "app.pair_confirm_poll",
  input: z.strictObject({ source: sourceSchema, ...pollFields }),
  output: brokerAppsConfirmPollOutputSchema,
  actors: ["machine"],
  errors,
});

// 경로 장부는 core의 준비 서비스가 쥐고, 호출의 start 사실은 supervisor의 broker가 처음 본다. supervisor가
// 그 사실을 core에 알린다. 알리지 못한 호출은 부모로 알려지지 않아 부모 없음으로
// 시작한다(알려진 한계). 자식 종료는 그 자식의 기억을 비운다.
export const appPairObserve = defineMemory({
  resource: "apps",
  method: "pair_observe",
  name: "app.pair_observe",
  input: z.discriminatedUnion("event", [
    z.strictObject({
      event: z.literal("start"),
      process_nonce: processNonceSchema,
      invocation: z.string().min(1),
      caller: z.looseObject({ kind: z.string() }),
    }),
    z.strictObject({
      event: z.literal("exit"),
      process_nonce: processNonceSchema,
    }),
  ]),
  output: z.object({ accepted: z.literal(true) }),
  actors: ["machine"],
  errors,
});

export const PAIR_ROUTES = [
  appPairObserve,
  appPairPrepare,
  appPairConfirmRequest,
  appPairConfirmPoll,
] as const;
