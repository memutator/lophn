import { z } from "zod";
import { withReadCommon } from "../base/envelope.ts";
import { defineRead } from "../base/route.ts";
import {
  appIdSchema,
  releaseIdSchema,
  sha256Schema,
} from "./channel-values.ts";
import type { InputSchema } from "./declaration/mod.ts";
import { phoneManifestSchema } from "./phone-screen.ts";

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

// 폰이 받을 화면의 목록이다. 보관한 앱과 활성 release가 없는 앱은 싣지 않는다. 화면 file은 `apps/screen_file`
// (target live, screen, path `phone.js`)로 받고, 쓸 수 있는지는 폰이 `phoneCanRun`으로 manifest를 보고 정한다.
export const appPhoneScreens = defineRead({
  resource: "apps",
  method: "phone_screens",
  name: "app.phone_screens",
  input: z.strictObject({}),
  output: withReadCommon(
    z.object({
      screens: z.array(
        z.object({
          app: appIdSchema,
          app_name: z.string(),
          // 선언의 icon 값 그대로("lucide:<이름>")나 null
          icon: z.string().nullable(),
          screen: z.string(),
          label: z.string(),
          params: z
            .custom<InputSchema>(
              (value) =>
                typeof value === "object" &&
                value !== null &&
                !Array.isArray(value),
            )
            .optional(),
          release: releaseIdSchema,
          bundle_hash: sha256Schema,
          manifest: phoneManifestSchema,
          // 그 release의 앱 process가 지금 live로 도는가
          running: z.boolean(),
        }),
      ),
    }),
  ),
  reads: ["releases", "app_runtime"],
  actors: ["user"],
  errors: ["invalid_input", "forbidden", "unavailable"],
});
