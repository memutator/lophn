import { z } from "zod";
import { withReadCommon } from "../base/envelope.ts";
import { defineRead } from "../base/route.ts";

// remote 최상위를 import하면 protocol 순환이라 칸을 여기 따로 둔다(범위는 `remoteDeviceSchema`가 정한다).
const phoneDeviceSchema = z.object({
  name: z.string(),
  os: z.enum(["ios", "android"]),
  width: z.number(),
  height: z.number(),
  dpr: z.number(),
});

// 사람의 기준 폰(`primary`)이다. agent가 폰 화면을 이 크기에 맞춰 그린다. 기기 id와 공개 key는 싣지 않는다.
// width·height·dpr은 CSS px 기준이고 폰 화면 전체라서 lophn의 top bar 아래 쓸 수 있는 높이는 더 작다.
export const appPhoneTarget = defineRead({
  resource: "apps",
  method: "phone_target",
  name: "app.phone_target",
  input: z.strictObject({}),
  output: withReadCommon(z.object({ device: phoneDeviceSchema.nullable() })),
  reads: ["remote_devices"],
  actors: ["user", "agent"],
  errors: ["invalid_input", "forbidden", "unavailable"],
});
