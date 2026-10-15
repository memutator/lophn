import type { OperationPolicy } from "../../../server/identity/mod.ts";
import { eventOperations } from "../../../events/operations.ts";
import type { WiringFactory } from "./context.ts";

export const eventsWiring: WiringFactory = () => ({
  name: "events",
  async operations(ctx) {
    const names = await eventOperations(ctx.options.teamModules);
    // 부모 pipe hello가 사람 token의 operation을 정할 때도 쓴다.
    ctx.provide("eventNames", names);
    // 팀이 공개 정책을 내놓은 event 이름. 사람 token의 operation에 들어가 owner 정책이 판단한다.
    return names.map((name): OperationPolicy => ({
      name,
      actors: ["user"],
      kind: "read",
    }));
  },
});
