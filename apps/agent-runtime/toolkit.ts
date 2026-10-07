import {
  err,
  type IdSource,
  ok,
  type Result,
} from "../../packages/base/mod.ts";
import {
  assignmentRead,
  runRead,
} from "../../packages/contracts/lophn-agent/mod.ts";
import { routePath } from "../../packages/contracts/platform/mod.ts";
import {
  createBuiltinToolHandlers,
  type ToolHandler,
} from "../../packages/lophn-agent/harness/tools/mod.ts";
import { type CoreCall, readOf } from "./core-call.ts";
import { builtinBinding } from "./builtin-binding.ts";
import type { Toolkit } from "./prepare.ts";
import type { RunSeat } from "./core-ports.ts";

// 내장 tool의 handler 묶음을 run의 agent 자격에 붙인다(lophn-agent/harness/tools). handler는 소유
// contract를 이름 하나로 부르고, 여기서 그 이름을 route로 바꿔 agent credential의 loopback으로 보낸다.
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
              run.seat.run,
            ),
          reach: run.reach,
          run: run.seat.run,
          assignment: run.seat.assignment,
        })),
    handlers(seat: RunSeat, agent: CoreCall): ReadonlyMap<string, ToolHandler> {
      return createBuiltinToolHandlers({
        ...createContractCall(options.routes, agent),
        newId: (prefix) => options.ids.newId(prefix),
        async runFacts(run) {
          const read = await readOf(options.machine, runRead, { run });
          if (!read.ok) return read;
          const assigned = await readOf(options.machine, assignmentRead, {
            assignment: read.value.run.assignment,
          });
          if (!assigned.ok) return assigned;
          const source = read.value.run.source;
          return ok({
            session: seat.session,
            role: assigned.value.assignment.role as never,
            original_message: source.kind === "message"
              ? source.message
              : source.kind === "handoff"
              ? source.original_message
              : null,
            assignment: read.value.run.assignment,
          });
        },
      });
    },
  };
}
