import { ok } from "../../../../base/mod.ts";
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
          (_auth: unknown, input: unknown) =>
            ctx.machine.rename((input as { name: string | null }).name),
        ],
      ],
    });
  },
});
