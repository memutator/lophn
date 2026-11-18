import { z } from "zod";
import { withReadCommon } from "../base/envelope.ts";
import { defineCommand, defineRead } from "../base/route.ts";
import { keyTextSchema } from "./frames.ts";

// 이 컴퓨터가 터미널 입력을 허락한 기기의 표(`remote_grants`). key는 명단 항목의 key(host key 글)다. 이 컴퓨터의 ledger에만 있고
// 명단으로 퍼지지 않는다. core 안 machine 자격만 낸다(사람은 `roster/set_terminal_input`, 초대와 합류는 wiring이 부른다).
// `seeded`는 옛 명단 칸에서 옮기기를 했다는 표지다.
export const rosterGrants = defineRead({
  resource: "roster",
  method: "grants",
  name: "roster.grants",
  reads: ["remote_devices"],
  input: z.strictObject({}),
  output: withReadCommon(
    z.object({ keys: z.array(keyTextSchema), seeded: z.boolean() }),
  ),
  actors: ["machine"],
  errors: ["invalid_input", "forbidden", "unavailable"],
});

// 한 기기의 허락을 켜거나 끈다(꺼진 것을 끄는 것은 아무것도 하지 않는다).
export const rosterGrantSet = defineCommand({
  resource: "roster",
  method: "grant_set",
  name: "roster.grant_set",
  changes: ["remote_devices"],
  input: z.strictObject({ key: keyTextSchema, on: z.boolean() }),
  output: z.object({ key: keyTextSchema }),
  actors: ["machine"],
  errors: ["invalid_input", "forbidden", "unavailable"],
});

// 옛 명단 칸에서 켜져 있던 허락을 옮긴다. 표지가 없을 때만 행과 표지를 한 transaction에 쓴다. 표지가 있으면 `written: false`다.
export const rosterGrantsSeed = defineCommand({
  resource: "roster",
  method: "grants_seed",
  name: "roster.grants_seed",
  changes: ["remote_devices"],
  input: z.strictObject({ keys: z.array(keyTextSchema).max(4096) }),
  output: z.object({ written: z.boolean() }),
  actors: ["machine"],
  errors: ["invalid_input", "forbidden", "unavailable"],
});
