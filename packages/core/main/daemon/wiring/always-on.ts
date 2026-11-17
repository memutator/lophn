import { ok } from "../../../../base/mod.ts";
import {
  type AlwaysOnSetInput,
  alwaysOnSet,
  alwaysOnStatus,
} from "../../../../protocol/always-on/mod.ts";
import {
  type AlwaysOnService,
  createAlwaysOn,
} from "../../../always-on/mod.ts";
import type { WiringFactory } from "./context.ts";

const key = (route: { resource: string; method: string }) =>
  `${route.resource}/${route.method}`;

// OS port는 core 입구가 설치 layout일 때만 준다(`CoreOptions.alwaysOn`). 없으면 표시를 켤 수 없고 OS를 부르지 않는다.
export const alwaysOnWiring: WiringFactory = () => {
  let service: AlwaysOnService | undefined;
  return {
    name: "always-on",
    async build(ctx) {
      const built = await createAlwaysOn({
        root: ctx.root.path,
        machine: ctx.machine.id,
        os: ctx.options.alwaysOn?.({
          dataRoot: ctx.root.path,
          logger: ctx.telemetry.logger,
        }),
        clock: ctx.clock,
        logger: ctx.telemetry.logger,
      });
      service = built;
      ctx.provide("alwaysOn", built);
      return ok({
        memory: [
          [key(alwaysOnStatus), async () => ok(await built.refresh())],
          [
            key(alwaysOnSet),
            (_auth: unknown, input: unknown) =>
              built.set(input as AlwaysOnSetInput),
          ],
        ],
      });
    },
    // OS를 부르는 맞추기가 control의 ready를 늦추지 않게 기다리지 않는다. set과는 service 안에서 줄을 선다.
    async afterReady() {
      void service!.reconcile();
    },
    async closeWork() {
      await service?.close();
    },
  };
};
