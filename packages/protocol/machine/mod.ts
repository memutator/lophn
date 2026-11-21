import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { defineMemory } from "../base/route.ts";
import { atSchema } from "../base/values.ts";

export const machineIdSchema = idSchema("mch");

export const machineNameSchema = z.string().trim().min(1).max(64);

// 이 기계의 신분과 이름. name은 사람이 지은 이름이 없으면 hostname에서 온다.
export const machineStatusSchema = z.strictObject({
  id: machineIdSchema,
  name: machineNameSchema,
  name_source: z.enum(["hostname", "person"]),
  hostname: z.string(),
  // 복제로 알아채 새 기계가 되었으면 옛 id와 그때.
  cloned_from: machineIdSchema.nullable(),
  cloned_at: atSchema.nullable(),
});

export type MachineStatus = z.infer<typeof machineStatusSchema>;

export const machineStatus = defineMemory({
  resource: "machine",
  method: "status",
  name: "machine.status",
  input: z.strictObject({}),
  output: machineStatusSchema,
  actors: ["user"],
  errors: ["invalid_input", "forbidden"],
});

// null이면 사람이 지은 이름을 지우고 hostname을 다시 따른다.
export const machineRename = defineMemory({
  resource: "machine",
  method: "rename",
  name: "machine.rename",
  input: z.strictObject({ name: machineNameSchema.nullable() }),
  output: machineStatusSchema,
  actors: ["user"],
  errors: ["invalid_input", "forbidden", "unavailable"],
});

// 사람의 컴퓨터 명단(폰 제외)에 이 컴퓨터를 더한 것. 앱이 "내가 어느 컴퓨터에서 도나, 다른 컴퓨터는 무엇이 있나"를 알려고 읽는다.
// `current`는 이 요청에 답하는 core의 컴퓨터다(앱 화면이 다른 컴퓨터에서 그려지면 그 화면의 backend가 도는 컴퓨터의 core가 답한다).
// `id`는 `connectCommands`의 `on`에 그대로 쓴다. `status`의 이름은 화면 component의 MachineOption과 같다(`connected`는 `online`).
// `always_on`은 그 컴퓨터의 "늘 켜 둠" 표시다. 그 컴퓨터의 기록이 아직 오지 않았으면 null이다. 사람 허락 없이 읽는다.
// agent는 `--on <컴퓨터>`로 부를 컴퓨터를 이것으로 읽는다.
export const computerSchema = z.strictObject({
  id: machineIdSchema,
  name: machineNameSchema,
  status: z.enum(["online", "offline", "connecting", "update"]),
  current: z.boolean(),
  always_on: z.boolean().nullable(),
});
export type Computer = z.infer<typeof computerSchema>;

export const machineComputers = defineMemory({
  resource: "machine",
  method: "computers",
  name: "machine.computers",
  input: z.strictObject({}),
  output: z.strictObject({ computers: z.array(computerSchema) }),
  actors: ["user", "app", "agent"],
  errors: ["invalid_input", "forbidden"],
});

export const MACHINE_ROUTES = [
  machineStatus,
  machineRename,
  machineComputers,
] as const;
