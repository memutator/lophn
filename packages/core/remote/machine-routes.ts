// 다른 기계를 부르는 `machines/call`·`machines/watch` handler. 받는 기계는 이 컴퓨터를 사람으로 보므로(허락받은 컴퓨터면 사람
// route와 자동 확인까지) 이 컴퓨터에서는 그 기계의 화면, 곧 shell main만 부른다. 사람의 CLI token은 actor user라도 shell
// capability가 없어 막힌다. capability는 이 컴퓨터 core의 것이라 다른 기계로 넘기지 않는다. watch의 구독자는 (capability,
// watcher)라 그 shell이 끝나면 그 shell의 구독이 모두 빠진다(새 shell의 watcher 이름이 옛 것과 겹쳐도 옛 구독이 남지 않는다).
import { err, type Result } from "../../base/mod.ts";
import type { EventCondition } from "../../protocol/events/mod.ts";
import type { Links } from "./links.ts";

export function createMachineRoutes(deps: {
  links: Pick<Links, "call" | "watch" | "forget">;
  // control `connect {client: shell}`이 준 살아 있는 capability인가.
  capability(value: string): boolean;
  // capability가 끝날 때 부른다(그 shell의 Gateway가 닫혔다).
  onEnd(listener: (capability: string) => void): void;
}) {
  deps.onEnd((capability) => deps.links.forget(capability));
  const forbidden = (): Result<never> =>
    err({
      code: "forbidden",
      message: "only this computer's desktop calls another machine",
    });
  return {
    call(
      _who: unknown,
      input: {
        machine: string;
        resource: string;
        method: string;
        body: unknown;
        shell_capability: string;
      },
    ): Promise<Result<unknown>> {
      if (!deps.capability(input.shell_capability)) {
        return Promise.resolve(forbidden());
      }
      const { machine, resource, method, body } = input;
      return deps.links.call({ machine, resource, method, body });
    },
    watch(
      _who: unknown,
      input: {
        machine: string;
        watcher: string;
        conditions: EventCondition[];
        shell_capability: string;
      },
    ): Result<object> {
      if (!deps.capability(input.shell_capability)) return forbidden();
      return deps.links.watch(
        { capability: input.shell_capability, watcher: input.watcher },
        input.machine,
        input.conditions,
      );
    },
  };
}
