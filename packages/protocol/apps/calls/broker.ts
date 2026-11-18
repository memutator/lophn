import { z } from "zod";
import {
  invocationIdSchema,
  jsonValueSchema,
  processNonceSchema,
  runtimeModeSchema,
  toolKeySchema,
} from "../channel-values.ts";
import { appIdSchema } from "../../projects/values.ts";
import { machineRefSchema } from "../../remote/requester.ts";
import { toolCallOutputSchema } from "./call.ts";

// 앱 process가 broker socket으로 부르는 경로.
export const APP_BROKER_PATHS = {
  call: "/_lophn/broker/apps/call",
} as const;

// 자식 credential·현재 mode·nonce에 묶인다. 신원은 요청 본문이 정하지 않는다.
const childFields = {
  process_nonce: processNonceSchema,
  mode: runtimeModeSchema,
};

export const brokerAppCallInputSchema = z.strictObject({
  ...childFields,
  target_app: appIdSchema,
  // 다른 컴퓨터의 앱이면 그 컴퓨터(이름, `mch_`, `dev_`). 없으면 이 컴퓨터다.
  machine: machineRefSchema.optional(),
  // 다른 앱은 command만 부른다.
  command: toolKeySchema,
  input: jsonValueSchema.optional(),
  parent_invocation: invocationIdSchema.nullable(),
});
export const brokerAppCallOutputSchema = toolCallOutputSchema;
