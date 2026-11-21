// 앱 view의 컴퓨터 명단 읽기 main service. 이 화면의 backend가 도는 컴퓨터(`view.machine`)의 core가 답하므로 `current`는 그 컴퓨터다.
// 사람 자격(다른 기계의 view는 그 기계가 보는 이 컴퓨터의 기기 자격)으로 core의 `machine.computers`를 읽는다. 사람 허락은 없다.
import type { AppMachine } from "../../../protocol/shell/app-bridge-types.ts";
import type { CallOutcome } from "./app-call.ts";
import type { MachineCaller } from "./app-connection.ts";
import type { BoundView } from "./registry.ts";

interface AppMachinesDeps {
  call: MachineCaller;
}

export function createAppMachines(deps: AppMachinesDeps) {
  return {
    async list(
      view: BoundView,
    ): Promise<CallOutcome<{ machines: AppMachine[] }>> {
      const reply = await deps.call(view.machine)(
        "memory",
        "machine",
        "computers",
        {},
      );
      if (!reply.ok) {
        return {
          ok: false,
          error: { code: "unavailable", message: "core is not available" },
        };
      }
      const computers = (reply.value as { computers?: unknown }).computers;
      return {
        ok: true,
        value: { machines: Array.isArray(computers) ? computers : [] },
      };
    },
  };
}
