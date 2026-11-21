// 읽기 `machine.computers`: 사람의 컴퓨터 명단에 이 컴퓨터를 더해 앱에 준다. 새로 저장하는 상태는 없다. 이 컴퓨터는 machine 신원과
// always-on 표시에서, 다른 컴퓨터는 명단·link 상태와 폴더로 받은 기계 기록의 `always_on`에서 합친다.
import type { Id } from "../../protocol/base/ids.ts";
import type { Computer } from "../../protocol/machine/mod.ts";

export type ComputersDeps = {
  machine(): { id: Id<"mch">; name: string };
  /** 이 컴퓨터가 "늘 켜 둠"으로 표시됐나. */
  keepsRunning(): boolean;
  /** 명단의 다른 컴퓨터와 link 상태(`machines/list`와 같다). */
  others(): readonly {
    machine: Id<"mch">;
    name: string;
    status: "connecting" | "connected" | "offline" | "update";
  }[];
  /** 그 컴퓨터가 보낸 기록의 "늘 켜 둠" 표시. 기록이 아직 없으면 null. */
  recordedKeepsRunning(machine: Id<"mch">): boolean | null;
};

export function readComputers(deps: ComputersDeps): Computer[] {
  const me = deps.machine();
  return [
    {
      id: me.id,
      name: me.name,
      status: "online",
      current: true,
      always_on: deps.keepsRunning(),
    },
    ...deps
      .others()
      .filter((other) => other.machine !== me.id)
      .map((other) => ({
        id: other.machine,
        name: other.name,
        status:
          other.status === "connected" ? ("online" as const) : other.status,
        current: false,
        always_on: deps.recordedKeepsRunning(other.machine),
      })),
  ];
}
