// 사람이 기계 하나를 이 기계의 목록에서 지운다. 지운 기계는 흔적 정리를 붙잡지 않고 그 기계의 data를 더 읽지 않는다.
// 그 기계가 더 큰 revision의 기록을 쓰면 목록에 돌아온다. 사람만 한다(agent workspace에 내지 않는다).
import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { defineMemory } from "../base/route.ts";

export const machineForget = defineMemory({
  resource: "machine",
  method: "forget",
  name: "machine.forget",
  input: z.strictObject({ machine: idSchema("mch") }),
  output: z.object({ machine: idSchema("mch") }),
  actors: ["user"],
  // invalid_input: 이 기계 자신. not_found: 기록이 없는 기계.
  errors: ["invalid_input", "forbidden", "not_found", "unavailable"],
});
