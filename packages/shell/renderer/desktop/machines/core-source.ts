// 다른 기계 하나의 CoreSource. 이 컴퓨터의 것(`windowCoreSource`)과 같은 preload 통로를 쓰고, 부르기와 구독에 그 기계를 싣는다.
// 연결 상태는 IPC로 묻지 않고 기계 목록의 그 줄에서 읽는다.
import type { Id } from "../../../../protocol/base/ids.ts";
import type { CoreApi } from "../../../ipc/core-api.ts";
import { machineConnectionState } from "../../../ipc/machines.ts";
import type { ConnectionState, CoreSource } from "../connection/connection.ts";
import type { MachinesSource } from "./source.ts";

const STARTING: ConnectionState = { state: "starting", confirmedAt: null };

function stateOf(machine: string, machines: MachinesSource): ConnectionState {
  const view = machines.get();
  // 목록을 아직 모르면 명단에서 빠진 것이 아니라 붙는 중이다.
  if (view.state === "starting") return STARTING;
  const item = view.machines.find((one) => one.id === machine);
  return machineConnectionState(
    item === undefined || item.status === "removed"
      ? undefined
      : {
          id: item.id as Id<"mch">,
          name: item.name,
          status: item.status,
          update: item.update,
          path: item.path,
          last_seen_at: item.lastSeenAt,
        },
  );
}

export function machineCoreSource(
  machine: string,
  bridge: CoreApi,
  machines: MachinesSource,
): CoreSource {
  let last = stateOf(machine, machines);
  // 목록이 바뀌어도 이 기계의 상태가 그대로면 같은 값을 둔다(화면이 다시 그리지 않게).
  const current = (): ConnectionState => {
    const next = stateOf(machine, machines);
    if (next.state !== last.state || next.confirmedAt !== last.confirmedAt) {
      last = next;
    }
    return last;
  };
  return {
    subscribe(listener) {
      let seen = current();
      return machines.subscribe(() => {
        const next = current();
        if (next === seen) return;
        seen = next;
        listener(next);
      });
    },
    current,
    call: (input) => bridge.call({ ...input, machine }),
    watch: (conditions) => bridge.watch(conditions, machine),
    onEvent: (listener) =>
      bridge.onEvent((message) => {
        if (message.machine === machine) listener(message);
      }),
  };
}
