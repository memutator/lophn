// 다른 기계를 부르는 `machines/call`·`machines/watch` handler. 받는 기계는 이 컴퓨터를 사람으로 보므로(허락받은 컴퓨터면 사람
// route와 자동 확인까지) 그 기계에 닿는 요청한 쪽을 여기서 자격으로 정한다: 살아 있는 shell capability를 실은 call은 이 기계의 화면(`screen`),
// capability가 없는 사람의 CLI token은 사람의 터미널(`terminal`)이고, 입력의 어떤 칸도 요청한 쪽을 정하지 못한다. capability는 이 컴퓨터
// core의 것이라 다른 기계로 넘기지 않는다. watch는 화면의 것이라 늘 capability가 필요하다. watch의 구독자는 (capability,
// watcher)라 그 shell이 끝나면 그 shell의 구독이 모두 빠진다(새 shell의 watcher 이름이 옛 것과 겹쳐도 옛 구독이 남지 않는다).

import type { z } from "zod";
import { err, ok, type Result } from "../../base/mod.ts";
import type { AssignmentEntry } from "../../protocol/approvals/mod.ts";
import { appTools } from "../../protocol/apps/declaration/read.ts";
import type { EventCondition } from "../../protocol/events/mod.ts";
import {
  type CallPolicy,
  isPrivate,
} from "../../protocol/lophn-agent/call-policy.ts";
import {
  type AgentId,
  isLophn,
  type Workspace,
  workspaceOfLophn,
} from "../../protocol/lophn-agent/workspaces.ts";
import {
  type MachineCandidate,
  type Requester,
  requesterName,
  resolveMachine,
} from "../../protocol/machine/requester.ts";
import type { machinesAppTools } from "../../protocol/remote/routes.ts";
import type { Links } from "./links.ts";

export function createMachineRoutes(deps: {
  links: Pick<Links, "callDevice" | "watch" | "forget">;
  // 컴퓨터 이름, `mch_`, `dev_`로 명단의 컴퓨터를 고른다.
  resolve(ref: string): Result<MachineCandidate>;
  // control `connect {client: shell}`이 준 살아 있는 capability인가.
  capability(value: string): boolean;
  // capability가 끝날 때 부른다(그 shell의 Gateway가 닫혔다).
  onEnd(listener: (capability: string) => void): void;
}) {
  deps.onEnd((capability) => deps.links.forget(capability));
  const forbidden = (): Result<never> =>
    err({
      code: "forbidden",
      message: "this shell capability is not live",
    });
  return {
    call(
      _who: unknown,
      input: {
        machine: string;
        resource: string;
        method: string;
        body: unknown;
        shell_capability?: string;
      },
    ): Promise<Result<unknown>> {
      let by: Requester;
      if (input.shell_capability === undefined) by = { kind: "terminal" };
      else if (deps.capability(input.shell_capability)) by = { kind: "screen" };
      else return Promise.resolve(forbidden());
      const found = deps.resolve(input.machine);
      if (!found.ok) return Promise.resolve(found);
      if (found.value.self) {
        return Promise.resolve(
          err({
            code: "invalid_input",
            message: "that is this computer; call its routes directly",
          }),
        );
      }
      const { resource, method, body } = input;
      return deps.links.callDevice(found.value.device, {
        resource,
        method,
        body,
        by,
      });
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

// `machines/app_tools`: agent runtime이 그 agent에 할당된 다른 기계 앱의 command 목록을 읽는다.
export function createMachineAppTools(deps: {
  links: Pick<Links, "callDevice">;
  // 명단의 컴퓨터(이 컴퓨터 포함).
  computers(): MachineCandidate[];
  // 이 기계의 call 정책(private workspace).
  policy(): CallPolicy;
  // 그 agent의 지금 할당 줄과 사람이 보는 이름.
  assignment(agent: AgentId): Promise<Result<readonly AssignmentEntry[]>>;
  agentName(agent: AgentId): Promise<string | null>;
}) {
  // agent runtime이 그 agent에 할당된 다른 기계 앱의 command 목록을 읽는다. 그 기계마다 session 없는 그 agent로 묻고, 닿지 않거나
  // 거절하거나 읽을 수 없는 앱은 `view: null`이다. private workspace의 agent에게는 앱을 비운다: workspace는 입력이 말하는 것과
  // agent id가 가리키는 것(lophn은 id가 workspace를 정한다) 둘 다 본다.
  return async function appToolsOf(input: {
    agent: AgentId;
    workspace: Workspace | null;
  }): Promise<Result<z.infer<typeof machinesAppTools.output>>> {
    const machines = deps.computers();
    const policy = deps.policy();
    if (
      isPrivate(policy, input.workspace) ||
      (isLophn(input.agent) && isPrivate(policy, workspaceOfLophn(input.agent)))
    ) {
      return ok({ machines, apps: [] });
    }
    const assigned = await deps.assignment(input.agent);
    if (!assigned.ok) return assigned;
    const lines = assigned.value.filter((entry) => entry.machine !== undefined);
    if (lines.length === 0) return ok({ machines, apps: [] });
    const by = {
      kind: "agent",
      agent: input.agent,
      session: null,
      name: requesterName((await deps.agentName(input.agent)) ?? input.agent),
    } as const;
    const apps = await Promise.all(
      lines.map(async (line) => {
        const found = resolveMachine(line.machine!, machines);
        let view: z.infer<typeof appTools.output> | null = null;
        if (found.ok && !found.value.self) {
          const read = await deps.links.callDevice(found.value.device, {
            resource: appTools.resource,
            method: appTools.method,
            body: { app: line.app },
            by,
          });
          const parsed = read.ok
            ? appTools.output.safeParse(read.value)
            : undefined;
          if (parsed?.success) view = parsed.data;
        }
        return {
          machine: line.machine!,
          app: line.app,
          name: line.name!,
          view,
        };
      }),
    );
    return ok({ machines, apps });
  };
}
