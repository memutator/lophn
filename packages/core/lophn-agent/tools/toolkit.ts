import { err, type IdSource, type Result } from "../../../base/mod.ts";
import { routePath } from "../../../protocol/base/mod.ts";
import type { ToolHandler } from "./mod.ts";
import type { CoreCall } from "../run-loop/core-call.ts";
import { builtinBinding } from "../tool-judgment/builtin-binding.ts";
import { contextBundleReader, createContextToolkit } from "./context-search.ts";
import type { Toolkit } from "../run-loop/prepare.ts";
import type { TurnSeat } from "../run-loop/core-ports.ts";

// 옛 run-loop가 쓰는 toolkit이다. 소유 contract 이름을 route로 바꿔 agent credential의 loopback으로 보낸다.
// 어느 concern의 route가 있는지는 조립(`routes`)이 안다: 이 모듈은 목록에 있는 route만 연다.

type NamedRoute = {
  name: string;
  kind: string;
  resource: string;
  method: string;
};

export function createContractCall(
  routes: readonly NamedRoute[],
  agent: CoreCall,
) {
  const byName = new Map(routes.map((route) => [route.name, route]));
  return {
    async call(
      contract: string,
      input: unknown,
      run: string,
      options?: { compare?: unknown; idempotency_key?: string },
    ): Promise<Result<unknown>> {
      const route = byName.get(contract);
      if (route === undefined) {
        return err({ code: "not_found", message: "contract is not open" });
      }
      const body = route.kind === "command"
        ? {
          input,
          idempotency_key: options?.idempotency_key ?? `${run}:${contract}`,
          compare: options?.compare ?? {},
          prepared: [],
        }
        : input;
      return await agent(routePath(route), body);
    },
  };
}

// 내장 tool 묶음 하나. 읽기 tool은 기본 연결을 쓰고 쓰기 tool은 입력에서 정확한 대상을 읽는 제품
// 연결(`builtinBinding`)을 쓴다. handler는 run마다 새로 만든다(한 run 동안 읽은 판 기록을 handler
// 묶음이 쥔다).
export function createBuiltinToolkit(options: {
  routes: readonly NamedRoute[];
  machine: CoreCall;
  ids: IdSource;
  binding?: Toolkit["binding"];
}): Toolkit {
  return {
    binding: options.binding ??
      ((definition, run) =>
        run === undefined ? undefined : builtinBinding(definition, {
          call: (contract, input) =>
            createContractCall(options.routes, run.agent).call(
              contract,
              input,
              run.seat.turn,
            ),
          reach: run.reach,
          run: run.seat.turn,
          assignment: run.seat.session,
        })),
    // 선택한 context의 선언 검색 tool·개체 읽기 tool. 정의 재료는 machine 자격으로 읽고
    // 호출은 run의 agent 자격으로 부른다.
    contexts: createContextToolkit({
      machine: options.machine,
      contract: (agent) => createContractCall(options.routes, agent),
      bundle: contextBundleReader(options.machine),
    }),
    // 내장 tool은 정의가 handler를 들고 있다(ToolContext로 실행). 옛 run-loop에 넘길 handler는 없다.
    handlers(
      _seat: TurnSeat,
      _agent: CoreCall,
    ): ReadonlyMap<string, ToolHandler> {
      return new Map();
    },
  };
}
