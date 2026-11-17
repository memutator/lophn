// 폴더로 맞추는 앱 하나의 기계 사이 판 차이(machine-update). 기계마다 돌리는 release와 lophn 판, 이 기계가 새 release를
// 따라가는 상태, 다른 release라 기다리는 변경(held)과 그 이유를 낸다. 메모리 값과 ledger를 읽기만 한다.
// 같은 값을 같은 이름으로 `machine/environment`의 앱·기계 칸이 싣는다(machine-update README "다른 계획이 기대는 계약").
import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { defineMemory } from "../base/route.ts";
import { sha256Schema } from "../base/values.ts";
import { appIdSchema } from "./channel-values.ts";

const count = z.number().int().nonnegative();

export const followStateSchema = z.object({
  state: z.enum([
    "current",
    "installing",
    "activating",
    "waiting_consent",
    "declined",
    "lophn_update",
    "install_failed",
    "activation_failed",
    "diverged",
  ]),
  // 따라가려는(또는 막힌) release의 bundle hash. current면 null.
  release: sha256Schema.nullable(),
  reason: z.string().nullable(),
});

export const updateStateSchema = z.object({
  app: appIdSchema,
  follow: followStateSchema,
  // 다른 release라 이 기계가 적용하지 않고 둔 변경. 출처와 release마다 한 줄.
  held: z.array(
    z.object({
      machine: idSchema("mch"),
      bundle_hash: sha256Schema,
      data_schema: count,
      changes: count,
      bytes: count,
      // 한도에 닿아 더 복사하지 않고 폴더에 둔다.
      full: z.boolean(),
      // 이 기계의 따라가기가 갈라졌고 그 release의 held면 diverged(앱 agent가 두 release를 합친 release가 나와야 온다).
      // 아니면 이 기계가 지금 release보다 먼저 들인 release이거나 data schema가 지금 것보다 낮으면 older_release(그 기계가
      // 올라오면 온다), 그 밖은 newer_release(이 기계가 그 release가 되면 적용된다. 사람이 돌아가 내려놓은 release도 여기다).
      why: z.enum(["newer_release", "older_release", "diverged"]),
    }),
  ),
  // 이 기계와 그 앱을 주고받는 기계, 그리고 꼴 판이 범위 밖이라 앱 기록을 읽지 못한 기계(범위 밖이 되기 전에 읽은 앱
  // 기록이 있으면 그 앱을 쓰던 기계만).
  machines: z.array(
    z.object({
      machine: idSchema("mch"),
      name: z.string(),
      this_machine: z.boolean(),
      lophn_version: z.string().nullable(),
      exchange: z.enum(["ok", "update_this", "update_peer"]),
      release: z
        .object({
          bundle_hash: sha256Schema,
          // 이 기계에 그 release가 있을 때의 r<n> 번호.
          number: z.number().int().positive().nullable(),
          code_commit: z.string(),
          data_schema: count,
        })
        .nullable(),
    }),
  ),
});
export type UpdateState = z.infer<typeof updateStateSchema>;

export const appUpdateState = defineMemory({
  resource: "apps",
  method: "update_state",
  name: "app.update_state",
  input: z.strictObject({ app: appIdSchema }),
  output: updateStateSchema,
  actors: ["user", "agent"],
  errors: ["invalid_input", "forbidden", "not_found"],
  // 따라가기·held·기계 기록이 바뀌면 folder wiring이 app_runtime을, 활성 release가 바뀌면 releases를 낸다.
  reads: [
    { name: "app_runtime", id: (input) => input.app },
    { name: "releases", id: (input) => input.app },
  ],
});
