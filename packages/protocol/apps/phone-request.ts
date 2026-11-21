import { z } from "zod";
import { defineMemory } from "../base/route.ts";
import { processNonceSchema, runtimeModeSchema } from "./channel-values.ts";
import { PHONE_CAPABILITIES } from "./declaration/types.ts";

// 앱 backend가 폰에 묻는 route. 앱은 입력에 없다(앱 자식 credential이 고정한 앱이다). 권한(`phone.use` grant, 범위 `{capability}`)은
// broker가 요청마다 판정하고, 이 route는 그 뒤에서 폰에 묻는다. 대상은 그 사람의 기준 폰(`devices.is_primary`)이다.
// capability는 `PHONE_CAPABILITIES`의 이름이고 이 route가 폰에 묻는 것은 그 가운데 backend가 부를 수 있는 것
// (`phone/capabilities.ts`의 `from`)뿐이다: 화면만 쓰는 기능은 폰에 묻기 전에 `invalid_input`이다. 실패는 `unavailable`의 `details.reason`(phoneUnavailableReasonSchema)이다.

export const phoneCapabilitySchema = z.enum(PHONE_CAPABILITIES);
export type PhoneCapability = z.infer<typeof phoneCapabilitySchema>;

const phoneRequestInputSchema = z.strictObject({
  capability: phoneCapabilitySchema,
  input: z.unknown(),
});

// broker가 받는 앱 process의 요청. 자식 연결이 정한 nonce·mode를 함께 싣는다(brokerTrayInputSchema와 같다).
export const brokerPhoneInputSchema = phoneRequestInputSchema.extend({
  process_nonce: processNonceSchema,
  mode: runtimeModeSchema,
});

export const PHONE_REQUEST_BROKER_PATH = "/_lophn/broker/phone/request";

export const appPhoneRequest = defineMemory({
  resource: "app_phone",
  method: "request",
  name: "app_phone.request",
  input: phoneRequestInputSchema,
  output: z.object({ value: z.unknown() }),
  actors: ["app"],
  errors: [
    "invalid_input",
    "forbidden",
    "not_found",
    "conflict",
    "unavailable",
  ],
});
