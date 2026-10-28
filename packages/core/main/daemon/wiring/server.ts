import { CREDENTIAL_SCHEMA } from "../../../server/credentials.ts";
import {
  CredentialRegistry,
  type OperationPolicy,
} from "../../../server/identity/mod.ts";
import type { WiringFactory } from "./context.ts";

// 마지막 wiring이다. 쓰기 앞 처리기 가운데 가장 바깥이고, 앞 wiring의 operation을 모두 본 뒤에 registry를 연다.
export const serverWiring: WiringFactory = () => ({
  name: "server",
  schemaSteps: [CREDENTIAL_SCHEMA],
  operations(ctx) {
    return [
      {
        name: "platform/status",
        actors: ["user", "machine", "app", "agent"],
        kind: "read",
      },
      {
        name: "platform/health",
        actors: ["user", "machine", "app", "agent"],
        kind: "read",
      },
      // 파일 작업 결과 기록. 사람 요청에 결합해 받은 worker만 쓴다.
      { name: "file.record_result", actors: ["machine"], kind: "command" },
      // 사람 token 상한. user를 허용하는 route만 올라가고 다른 actor의 상한은 그대로다.
      ...ctx.allRoutes
        .filter((route) => route.actors.includes("user"))
        .map(
          (route): OperationPolicy => ({
            name: route.name,
            actors: ["user"],
            kind: route.kind === "command" ? "command" : "read",
          }),
        ),
    ];
  },
  prepare(ctx) {
    ctx.provide(
      "registry",
      new CredentialRegistry({
        epoch: ctx.epoch,
        clock: ctx.clock,
        random: ctx.random,
        operations: ctx.operations,
      }),
    );
  },
});
