import { z } from "zod";
import {
  invocationIdSchema,
  jsonValueSchema,
  processNonceSchema,
  runtimeModeSchema,
  toolKeySchema,
} from "../channel-values.ts";
import { appIdSchema } from "../../projects/values.ts";
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
  tool: toolKeySchema,
  input: jsonValueSchema.optional(),
  parent_invocation: invocationIdSchema.nullable(),
});
export const brokerAppCallOutputSchema = toolCallOutputSchema;
