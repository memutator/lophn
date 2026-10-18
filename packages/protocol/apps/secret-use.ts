import { z } from "zod";
import { defineMemory } from "../base/route.ts";
import { secretNameSchema } from "../secrets/secrets.ts";
import {
  appIdSchema,
  processNonceSchema,
  releaseIdSchema,
} from "./channel-values.ts";

// supervisor가 앱의 외부 요청에 인증 값을 붙이려고 값을 한 번 받는 통로다. 앱 process는 이 route를 부르지
// 못한다(machine만). 값은 응답 본문에만 있고 ledger·event·log·오류에는 없다. http 목적지는 loopback host만이고
// 그 판정은 core가 한다.
export const appsSecretValue = defineMemory({
  resource: "apps",
  method: "secret_value",
  name: "apps.secret_value",
  input: z.strictObject({
    app: appIdSchema,
    release: releaseIdSchema,
    process_nonce: processNonceSchema,
    name: secretNameSchema,
    destination: z.strictObject({
      scheme: z.enum(["http", "https"]),
      host: z.string().min(1),
      port: z.number().int().min(1).max(65535),
    }),
  }),
  output: z.strictObject({ value: z.string() }),
  actors: ["machine"],
  errors: ["invalid_input", "forbidden", "not_found", "unavailable"],
});
