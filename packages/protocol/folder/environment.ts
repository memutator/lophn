// 사람과 agent가 읽는 이 기계의 폴더 교환 환경: 기계, destination, 앱마다 내보내기·읽기 상태, 들일 수 있는 앱.
// 실시간이 아니다: 마지막으로 읽고 쓴 때의 상태다. 읽지 못한 부분은 그 칸의 `error`이고 route 자체는 오류를 내지 않는다.
import { z } from "zod";
import { defineRead } from "../base/route.ts";
import { machineEnvironmentSchema } from "./status.ts";

export const machineEnvironment = defineRead({
  resource: "machine",
  method: "environment",
  name: "machine.environment",
  input: z.strictObject({}),
  output: machineEnvironmentSchema,
  actors: ["user", "agent"],
  errors: ["invalid_input", "forbidden"],
});
