import type { z } from "zod";
import { err, ok, type Result } from "../../../base/mod.ts";
import type { Assignment } from "../../../protocol/approvals/mod.ts";
import {
  appRemoteCall,
  type ToolCallOutput,
  toolCallOutputSchema,
} from "../../../protocol/apps/calls/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type { JsonValue } from "../../../protocol/base/json-values.ts";
import {
  type CallPolicy,
  isPrivate,
} from "../../../protocol/lophn-agent/call-policy.ts";
import type { AgentId } from "../../../protocol/lophn-agent/workspaces.ts";
import {
  type MachineCandidate,
  type Requester,
  requesterName,
  resolveMachine,
} from "../../../protocol/machine/requester.ts";
import { judge } from "../../approvals/gate/mod.ts";
import type { VerifiedCaller } from "./caller.ts";
import { type CallGateDeps, callAllowed } from "./gate.ts";

// 다른 기계의 앱 command를 부르는 길. 부른 쪽 확인(verifyCaller)과 target 검사만 끝난 호출이 온다(agent와 앱만 온다).
// 받는 기계의 Gate는 지나지 않았으므로 이 컴퓨터의 Gate가 볼 것을 넘기기 전에 여기서 본다: private, 받은 call의 hop, 할당, `app.call` grant.
// 받는 기계는 그 기계의 규칙을 따로 본다(명단, 터미널 입력 허락, 대상 앱 workspace의 private, `public` command).
export type RemoteForward = (call: {
  caller: Extract<VerifiedCaller, { kind: "agent" | "app" }>;
  target: { machine: string; app: Id<"app"> };
  name: string;
  input: JsonValue | undefined;
}) => Promise<Result<ToolCallOutput>>;

// 명단의 컴퓨터를 이름으로 풀고 route 하나를 그 컴퓨터(기기 id)로 넘긴다. remote wiring이 낸다(`ctx.machineLinks`).
export type RemoteMachines = {
  computers(): MachineCandidate[];
  resolve(ref: string): Result<MachineCandidate>;
  call(
    device: string,
    call: { resource: string; method: string; body: unknown },
    by: Requester,
  ): Promise<Result<unknown>>;
};

export type RemoteForwardDeps = CallGateDeps & {
  machines(): RemoteMachines;
  // 이 기계의 call 정책(private workspace). 부른 쪽의 workspace가 private이면 다른 기계를 부르지 못한다.
  policy(): CallPolicy;
  // 사람이 보는 agent 이름. 받는 기계는 이 값으로 결정하지 않는다.
  agentName(agent: AgentId): string | null;
};

const forbidden = (message: string): Result<never> =>
  err({ code: "forbidden", message });

// 보냈는데 답을 잃은 호출: 그 기계에서 돌았을 수 있다.
const LOST: ToolCallOutput = {
  invocation: null,
  outcome: { status: "unknown", reason: "connection_lost" },
};

export function createRemoteForward(deps: RemoteForwardDeps): RemoteForward {
  return async ({ caller, target, name, input }) => {
    // private은 기계 사이에도 선다.
    const workspace =
      caller.kind === "agent"
        ? caller.workspace
        : ({ kind: "app", id: caller.app } as const);
    if (isPrivate(deps.policy(), workspace)) {
      return forbidden("a private workspace does not call another computer");
    }
    // 받은 call을 돌리는 중인 앱이 또 다른 기계를 부르면 권한이 한 hop 넓어진다.
    if (caller.kind === "app" && caller.parent.remote) {
      return forbidden("a received remote call is not forwarded again");
    }

    // 이 컴퓨터의 Gate가 이 호출에 물을 것을 컴퓨터 이름을 풀기 전에 본다: 할당이 없는 agent와 grant가 없는 앱이 명단의 컴퓨터 이름을 알아내지 못한다.
    const machines = deps.machines();
    let computers: MachineCandidate[];
    let assigned: Assignment["entries"] = [];
    if (caller.kind === "agent") {
      const assignment = deps.assignmentOf(caller.agent);
      if (!assignment.ok) return assignment;
      const lines = assignment.value.entries.filter(
        (entry) => entry.machine !== undefined && entry.app === target.app,
      );
      if (lines.length === 0) return ok(blocked());
      assigned = assignment.value.entries;
      // 이름은 그 agent의 줄이 가리키는 컴퓨터 가운데서만 푼다.
      const named = new Set(lines.map((entry) => entry.machine));
      computers = machines.computers().filter((one) => named.has(one.machine));
    } else {
      const allowed = await callAllowed(
        caller,
        { app: target.app, tool: name, effect: "external", public: true },
        deps,
      );
      if (!allowed.ok) return allowed;
      if (!allowed.value) return ok(blocked());
      computers = machines.computers();
    }
    const resolved = resolveMachine(target.machine, computers);
    if (!resolved.ok) return resolved;
    const computer = resolved.value;
    if (computer.self) {
      return err({
        code: "invalid_input",
        message: "that is this computer; call its apps without a machine",
      });
    }
    if (caller.kind === "agent") {
      // 그 컴퓨터에 할당한 줄만(`machine`을 뺀 꼴로) 본다.
      const entries: Assignment["entries"] = assigned
        .filter((entry) => entry.machine === computer.machine)
        .map((entry) => ({
          app: entry.app,
          removed_tools: entry.removed_tools,
        }));
      const judged = judge(
        { kind: "app_tool", app: target.app, tool: name, effect: "external" },
        { entries },
        { floor: [], layers: [] },
        "attended",
        false,
      );
      if (judged.kind === "deny") return ok(blocked());
    }

    const by: Requester =
      caller.kind === "agent"
        ? {
            kind: "agent",
            agent: caller.agent,
            session: caller.session,
            name: requesterName(deps.agentName(caller.agent) ?? caller.agent),
          }
        : { kind: "app", app: caller.app };
    const body: z.infer<typeof appRemoteCall.input> = {
      app: target.app,
      command: name,
      ...(input === undefined ? {} : { input }),
    };
    const sent = await machines.call(
      computer.device,
      { resource: appRemoteCall.resource, method: appRemoteCall.method, body },
      by,
    );
    if (!sent.ok) {
      const { code, details } = sent.error;
      return code === "unavailable" &&
        (details as { sent?: unknown } | undefined)?.sent === true
        ? ok(LOST)
        : sent;
    }
    const output = toolCallOutputSchema.safeParse(sent.value);
    return ok(output.success ? output.data : LOST);
  };
}

function blocked(): ToolCallOutput {
  return {
    invocation: null,
    outcome: {
      status: "denied",
      denial: { code: "gate_blocked", message: "the call is not granted" },
    },
  };
}
