import { z } from "zod";
import { withReadCommon } from "../base/envelope.ts";
import { defineFile, defineRead } from "../base/route.ts";
import {
  appIdSchema,
  processNonceSchema,
  releaseIdSchema,
  sha256Schema,
} from "./channel-values.ts";
import type { InputSchema } from "./declaration/mod.ts";
import { phoneBackendManifestSchema } from "./phone-backend.ts";
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

const phoneScreenParamsSchema = z
  .custom<InputSchema>(
    (value) =>
      typeof value === "object" && value !== null && !Array.isArray(value),
  )
  .optional();

// 폰이 받을 화면의 목록이다. 보관한 앱과 활성 release가 없는 앱은 싣지 않는다. 화면 file은 `apps/screen_file`
// (target live, screen, path `phone.js`)로 받고, 쓸 수 있는지는 폰이 `phoneCanRun`으로 manifest를 보고 정한다.
// `runs_on`은 선언의 값이다(없으면 ["computer"]). `backend`는 `phone`에서 도는 앱의 `phone/backend.json`이고 그 file과
// migration file은 `apps/phone_file`로 받는다. 앱의 `backend.json`을 읽지 못하면 그 앱의 화면은 싣지 않는다.
// `previews`는 컴퓨터에서 지금 도는(ready) preview의 phone 화면이다. 화면 file은 `apps/screen_file`의 target
// `{mode: "preview", app, process_nonce}`, view는 `app_views/open`의 `mode: "preview"`로 연다.
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
          params: phoneScreenParamsSchema,
          release: releaseIdSchema,
          code_commit: z.string().regex(/^[0-9a-f]{40}$/),
          bundle_hash: sha256Schema,
          manifest: phoneManifestSchema,
          runs_on: z.array(z.enum(["computer", "phone"])),
          backend: phoneBackendManifestSchema.nullable(),
          // 그 release의 앱 process가 지금 live로 도는가
          running: z.boolean(),
        }),
      ),
      previews: z.array(
        z.object({
          app: appIdSchema,
          app_name: z.string(),
          icon: z.string().nullable(),
          // preview는 release 없이 띄울 수도 있다
          release: releaseIdSchema.nullable(),
          bundle_hash: sha256Schema,
          process_nonce: processNonceSchema,
          screens: z.array(
            z.object({
              screen: z.string(),
              label: z.string(),
              params: phoneScreenParamsSchema,
              manifest: phoneManifestSchema,
            }),
          ),
        }),
      ),
    }),
  ),
  reads: ["releases", "app_runtime"],
  actors: ["user"],
  errors: ["invalid_input", "forbidden", "unavailable"],
});

// 폰이 앱 backend와 migration file을 받는다. path는 그 release의 `phone/backend.json`이 적은 것(`phone/backend.js`,
// `phone/backend.json`, `migrations/<from>-<to>.sql`)뿐이고, 그 앱의 활성 release가 아니거나 목록 밖이면 not_found다.
// 받은 byte는 폰이 manifest의 size·sha256으로 확인한다.
export const appPhoneFile = defineFile({
  resource: "apps",
  method: "phone_file",
  name: "app.phone_file",
  input: z.strictObject({
    app: appIdSchema,
    release: releaseIdSchema,
    path: z.string().min(1),
  }),
  contentType: "application/octet-stream",
  actors: ["user"],
  errors: ["invalid_input", "not_found", "unavailable"],
});
