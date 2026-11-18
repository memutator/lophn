import { err, ok, type Result } from "../../../base/mod.ts";
import type { ToolCallInput } from "../../../protocol/apps/calls/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type { Requester } from "../../../protocol/machine/requester.ts";
import type {
  AgentId,
  Workspace,
} from "../../../protocol/lophn-agent/workspaces.ts";
import type { CallerDirectory } from "../ports.ts";
import type { Flight } from "./intake.ts";

// previewOnly는 route 입력이 아니라 core 안 호출자만 켠다(preview로만 가는 credential).
export type CallAuth = {
  actor: "user" | "agent" | "app" | "program" | "flow" | "event" | "remote";
  app?: Id<"app">;
  // actor가 program일 때만 있다. route는 이 자격을 만들지 못하고 core 안 run 연산만 만든다.
  program?: {
    job: Id<"job">;
    job_run: Id<"jbr">;
  };
  // actor가 flow일 때만 있다. program과 같이 route는 만들지 못하고 core 안 run 연산만 만든다.
  flow?: {
    instance: Id<"wfi">;
    agent: AgentId;
    workspace: Workspace | null;
  };
  // actor가 event일 때만 있다. 발행을 받은 core의 event 전달만 만든다(route는 만들지 못한다).
  // parent는 발행한 앱이 부모 invocation 안에서 냈을 때 core가 발행을 받는 순간 확인해 둔 도는 호출이다.
  event?: {
    publisher: string;
    event: string;
    publication: Id<"pub">;
    trace_id: string;
    chain: readonly string[];
    parent: Flight | null;
  };
  // actor가 remote일 때만 있다. route는 만들지 못하고 받는 기계의 앱 command 입구 handler만 만든다(frame의 `by`와 부른 컴퓨터).
  remote?: {
    machine: Id<"mch">;
    device: Id<"dev">;
    requester: Requester;
  };
  previewOnly?: true;
};

// 본문 주장 가운데 core가 직접 확인한 것만 남긴다.
export type VerifiedCaller =
  | { kind: "person" }
  | {
      kind: "agent";
      agent: AgentId;
      workspace: Workspace | null;
      session: Id<"ses">;
      turn: Id<"trn">;
      toolCall: Id<"tcl">;
    }
  | { kind: "app"; app: Id<"app">; parent: Flight }
  | { kind: "program"; job: Id<"job">; job_run: Id<"jbr"> }
  // remote: 다른 기계에서 온 event가 부른 handler다(다른 컴퓨터를 다시 부르지 못하고 낸 event도 다른 컴퓨터로 가지 않는다).
  | { kind: "event"; parent: Flight | null; remote: boolean }
  | {
      kind: "remote";
      machine: Id<"mch">;
      device: Id<"dev">;
      requester: Requester;
    }
  | {
      kind: "flow";
      instance: Id<"wfi">;
      agent: AgentId;
      workspace: Workspace | null;
    };

type CallerChecks = {
  callers: CallerDirectory;
  activeRelease(app: Id<"app">): Result<Id<"rel"> | null>;
  flight(id: Id<"inv">): Flight | undefined;
};

const KIND_OF_ACTOR = {
  user: "person",
  agent: "agent",
  app: "app",
  program: "program",
  flow: "flow",
  event: "event",
  remote: "remote",
} as const;

function sameRequester(a: Requester, b: Requester): boolean {
  if (a.kind === "agent") {
    return (
      b.kind === "agent" &&
      a.agent === b.agent &&
      a.session === b.session &&
      a.name === b.name
    );
  }
  if (a.kind === "app") return b.kind === "app" && a.app === b.app;
  return a.kind === b.kind;
}

function forbidden(message: string): Result<never> {
  return err({ code: "forbidden", message });
}

export function verifyCaller(
  input: ToolCallInput,
  auth: CallAuth,
  checks: CallerChecks,
): Result<VerifiedCaller> {
  const caller = input.caller;
  if (KIND_OF_ACTOR[auth.actor] !== caller.kind) {
    return forbidden("caller kind does not match the credential");
  }
  if (caller.kind === "person") return ok({ kind: "person" });

  if (caller.kind === "agent") {
    const target = input.target;
    // preview는 그 앱 workspace의 session만 부른다(아래 판정). remote는 service가 다른 기계로 넘긴다.
    if (target.mode === "live" && target.release !== null) {
      return err({
        code: "invalid_input",
        message:
          "agent calls target the live active release or its own preview",
      });
    }
    const found = checks.callers.agentToolCall(
      caller.session as Id<"ses">,
      caller.turn as Id<"trn">,
      caller.tool_call as Id<"tcl">,
    );
    if (!found.ok) return found;
    if (found.value === null) return forbidden("unknown tool call");
    if (
      target.mode === "preview" &&
      !(
        found.value.workspace?.kind === "app" &&
        found.value.workspace.id === target.app
      )
    ) {
      return forbidden(
        "only a session in the app's workspace calls its preview",
      );
    }
    return ok({
      kind: "agent",
      agent: found.value.agent,
      workspace: found.value.workspace,
      session: caller.session as Id<"ses">,
      turn: caller.turn as Id<"trn">,
      toolCall: caller.tool_call as Id<"tcl">,
    });
  }

  if (caller.kind === "program") {
    if (input.target.mode !== "live" || input.target.release !== null) {
      return err({
        code: "invalid_input",
        message: "program calls target the live active release",
      });
    }
    // 본문은 주장일 뿐이라 core가 만든 자격과 맞춰 본다.
    const { program } = auth;
    if (
      program === undefined ||
      program.job !== caller.job ||
      program.job_run !== caller.job_run
    ) {
      return forbidden("job run does not match the credential");
    }
    return ok({
      kind: "program",
      job: program.job,
      job_run: program.job_run,
    });
  }

  if (caller.kind === "event") {
    if (input.target.mode !== "live" || input.target.release !== null) {
      return err({
        code: "invalid_input",
        message: "event deliveries target the live active release",
      });
    }
    // 본문은 주장일 뿐이라 core가 만든 자격과 맞춰 본다.
    const { event } = auth;
    if (
      event === undefined ||
      event.publisher !== caller.publisher ||
      event.event !== caller.event ||
      event.publication !== caller.publication ||
      event.trace_id !== caller.trace_id ||
      event.chain.join(",") !== caller.chain.join(",") ||
      (event.parent?.id ?? null) !== caller.parent_invocation
    ) {
      return forbidden("event delivery does not match the credential");
    }
    return ok({
      kind: "event",
      parent: event.parent,
      remote: caller.machine !== undefined,
    });
  }

  if (caller.kind === "remote") {
    if (input.target.mode !== "live" || input.target.release !== null) {
      return err({
        code: "invalid_input",
        message: "remote calls target the live active release",
      });
    }
    // 본문은 주장일 뿐이라 받는 기계의 입구 handler가 만든 자격과 맞춰 본다.
    const { remote } = auth;
    if (
      remote === undefined ||
      remote.machine !== caller.machine ||
      remote.device !== caller.device ||
      !sameRequester(remote.requester, caller.requester)
    ) {
      return forbidden("remote caller does not match the credential");
    }
    return ok({
      kind: "remote",
      machine: remote.machine,
      device: remote.device,
      requester: remote.requester,
    });
  }

  if (caller.kind === "flow") {
    if (input.target.mode !== "live" || input.target.release !== null) {
      return err({
        code: "invalid_input",
        message: "flow calls target the live active release",
      });
    }
    const { flow } = auth;
    if (flow === undefined || flow.instance !== caller.instance) {
      return forbidden("workflow instance does not match the credential");
    }
    return ok({
      kind: "flow",
      instance: flow.instance,
      agent: flow.agent,
      workspace: flow.workspace,
    });
  }

  if (
    input.target.mode === "preview" ||
    (input.target.mode === "live" && input.target.release !== null)
  ) {
    return err({
      code: "invalid_input",
      message: "app calls target the live active release",
    });
  }
  const app = caller.app as Id<"app">;
  if (auth.app !== app) return forbidden("app does not match the credential");
  const active = checks.activeRelease(app);
  if (!active.ok) return active;
  if (active.value !== caller.release) {
    return forbidden("release is not the active release");
  }
  const parent =
    caller.parent_invocation === null
      ? undefined
      : checks.flight(caller.parent_invocation as Id<"inv">);
  if (!parent || parent.app !== app || parent.release !== caller.release) {
    return forbidden("unknown parent invocation");
  }
  return ok({ kind: "app", app, parent });
}
