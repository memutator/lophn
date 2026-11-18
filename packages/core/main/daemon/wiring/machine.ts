import { ok } from "../../../../base/mod.ts";
import { publishStateChanged } from "../../../../protocol/events/changes.ts";
import {
  machineRename,
  machineStatus,
} from "../../../../protocol/machine/mod.ts";
import type { WiringFactory } from "./context.ts";

const key = (route: { resource: string; method: string }) =>
  `${route.resource}/${route.method}`;

// ctx.machine은 기동(core.ts)이 data step 전에 채운다. 이 wiring은 route만 낸다.
export const machineWiring: WiringFactory = () => ({
  name: "machine",
  build(ctx) {
    return ok({
      memory: [
        [key(machineStatus), () => ok(ctx.machine.status())],
        [
          key(machineRename),
          async (_auth: unknown, input: unknown) => {
            const renamed = await ctx.machine.rename(
              (input as { name: string | null }).name,
            );
            // 이 컴퓨터의 이름은 명단의 자기 항목이기도 하다. remote wiring이 이것을 듣고 새 rev로 다시 서명해 다른 기계에
            // 퍼뜨리고, 열린 화면은 다시 읽는다.
            if (renamed.ok) {
              publishStateChanged(ctx.bus, ctx.clock.now(), [
                { name: "remote_devices", id: null },
              ]);
            }
            return renamed;
          },
        ],
      ],
    });
  },
});
