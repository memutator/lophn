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

export const MACHINE_ROUTES = [machineStatus, machineRename] as const;
