// agent가 다른 컴퓨터에서 부를 수 있는 것을 읽는 길이다. 보내는 쪽(`machines/sessions`, `machines/agents`)은 agent session 대신 그 컴퓨터의
// `a2a/*`를 부르고, 받는 쪽(`a2a/sessions`, `a2a/agents`)은 명단의 컴퓨터에게만 답한다. 받는 쪽은 이 기계에서 private인 workspace의
// session과 명함을 내주지 않고 그런 workspace가 있는지도 알리지 않는다. 누구를 부를지는 고르지 않는다(지침의 일이다).
import { err, ok, type Result } from "../../base/mod.ts";
import type { Id } from "../../protocol/base/ids.ts";
import type { AgentCard } from "../../protocol/lophn-agent/agent-definitions.ts";
import {
  type CallPolicy,
  isPrivate,
} from "../../protocol/lophn-agent/call-policy.ts";
import {
  type RemoteWorkspace,
  SENDABLE_SESSION_STATES,
} from "../../protocol/lophn-agent/calls.ts";
import type {
  AgentAddress,
  AgentId,
  Workspace,
} from "../../protocol/lophn-agent/workspaces.ts";
import {
  a2aAgents,
  a2aSessions,
  machinesAgents,
  machinesSessions,
  type RemoteSession,
  type RemoteWorkspaceOutput,
} from "../../protocol/machine/a2a.ts";
import {
  type MachineCandidate,
  type Requester,
  requesterName,
} from "../../protocol/machine/requester.ts";
import type { AuthenticatedContext } from "../../protocol/server/mod.ts";
import type { z } from "zod";

// 이 기계에 열린 session 하나(Router의 session 목록과 같은 규칙으로 읽은 것).
export type OpenSession = {
  session: Id<"ses">;
  handle: string;
  name: string;
  title: string | null;
  workspace: Workspace | null;
  accepting: boolean;
  opened_by_machine: Id<"mch"> | null;
  state: string;
  last_active_at: string | null;
};

export type A2aListsDeps = {
  // 이 기계의 call 정책(private workspace).
  policy(): CallPolicy;
  // 명단의 컴퓨터(이 컴퓨터 포함)와 그 컴퓨터로 route 하나 넘기기. remote wiring이 늦게 낸다.
  computers(): MachineCandidate[];
  resolve(ref: string): Result<MachineCandidate>;
  call(
    device: string,
    call: {
      resource: string;
      method: string;
      body: unknown;
      deadlineMs: number;
    },
    by: Requester,
  ): Promise<Result<unknown>>;
  // 받는 쪽이 이 기계의 ledger에서 읽는 것.
  openSessions(): OpenSession[];
  project(
    id: string,
  ): { identity: string | null; name: string; archived: boolean } | null;
  projectByIdentity(identity: string): string | null;
  app(id: string): { name: string; archived: boolean } | null;
  cards(workspace: Workspace | null): Promise<Result<AgentCard[]>>;
  // 보내는 쪽: 부른 session이 다른 컴퓨터에 닿아도 되는가(`remoteReach`)와 그 agent의 이름.
  sender(
    session: Id<"ses">,
  ): Result<{ workspace: Workspace | null; agent: AgentId; name: string }>;
  // 이 기계의 workspace 이름을 기계를 건너는 꼴로 바꾼다(`remoteWorkspaceOf`). 이름이 없으면 부른 쪽 workspace다.
  remoteWorkspace(
    name: AgentAddress["workspace"],
    caller: Workspace | null,
  ): Result<RemoteWorkspace>;
  // 그 컴퓨터가 이만큼 답하지 않으면 "not reachable now"다(link의 120초를 기다리지 않는다).
  deadlineMs?: number;
};

const forbidden = (message: string): Result<never> =>
  err({ code: "forbidden", message });

// 다른 컴퓨터가 낸 글은 이 컴퓨터 밖의 것이다. model에 닿기 전에 제어 문자를 빼고 길이와 개수를 줄인다(`machines/app_tools`와 같다).
const MAX_ITEMS = 200;
const MAX_TITLE = 256;
const MAX_TEXT = 1024;
// 줄바꿈과 탭은 설명에 쓸 수 있다. 그 밖의 제어 문자는 뺀다.
const CONTROLS = /[^\P{Cc}\n\t]/gu;
const LINE_BREAKS = /[\n\t]/g;

function text(value: string, max: number): string {
  return value.replace(CONTROLS, "").trim().slice(0, max);
}
function line(value: string, max: number): string {
  return text(value.replace(LINE_BREAKS, " "), max);
}
function label(value: string): string {
  return requesterName(value.replace(CONTROLS, "").replace(LINE_BREAKS, " "));
}

function checkedSession(session: RemoteSession): RemoteSession {
  const workspace: RemoteWorkspaceOutput =
    session.workspace.kind === "home"
      ? session.workspace
      : { ...session.workspace, name: label(session.workspace.name) };
  return {
    ...session,
    handle: label(session.handle),
    name: label(session.name),
    title: session.title === null ? null : line(session.title, MAX_TITLE),
    workspace,
  };
}

function checkedCard(card: AgentCard): AgentCard {
  const { callable: _callable, ...rest } = card;
  return {
    ...rest,
    name: label(card.name),
    ...(card.description === undefined
      ? {}
      : { description: text(card.description, MAX_TEXT) }),
    diff: {
      plus: card.diff.plus
        .slice(0, MAX_ITEMS)
        .map((one) => line(one, MAX_TEXT)),
      minus: card.diff.minus
        .slice(0, MAX_ITEMS)
        .map((one) => line(one, MAX_TEXT)),
    },
    notes: card.notes.slice(0, MAX_ITEMS).map((one) => text(one, MAX_TEXT)),
  };
}

export function createA2aLists(deps: A2aListsDeps) {
  const deadline = deps.deadlineMs ?? 5000;

  // 받는 쪽은 명단의 다른 컴퓨터의 core만 부른다(기기 자격). 명단의 컴퓨터 목록에 폰은 없으므로 폰과 명단 밖 기기, 기기가 아닌 자격은
  // 읽지 못한다.
  function origin(ctx: AuthenticatedContext): Result<Id<"mch">> {
    const device = ctx.principal.startsWith("device:")
      ? ctx.principal.slice("device:".length)
      : null;
    const found = deps
      .computers()
      .find((one) => !one.self && one.device === device);
    return found === undefined
      ? forbidden("only another computer of this person reads this")
      : ok(found.machine as Id<"mch">);
  }

  function crossing(workspace: Workspace | null): RemoteWorkspaceOutput {
    if (workspace === null) return { kind: "home" };
    if (workspace.kind === "app") {
      return {
        kind: "app",
        app: workspace.id,
        name: deps.app(workspace.id)?.name ?? workspace.id,
      };
    }
    const project = deps.project(workspace.id);
    return {
      kind: "project",
      identity: (project?.identity ?? null) as Id<"pri"> | null,
      name: project?.name ?? workspace.id,
    };
  }

  // 기계를 건너는 이름을 이 기계의 workspace로 푼다. 없거나 보관했거나 private이면 null이다(셋을 가르지 않는다).
  function local(
    name: RemoteWorkspace,
  ): { workspace: Workspace | null } | null {
    let workspace: Workspace | null;
    if ("home" in name) workspace = null;
    else if ("app" in name) {
      const app = deps.app(name.app);
      if (app === null || app.archived) return null;
      workspace = { kind: "app", id: name.app };
    } else {
      const id = deps.projectByIdentity(name.project);
      const project = id === null ? null : deps.project(id);
      if (id === null || project === null || project.archived) return null;
      workspace = { kind: "project", id: id as Id<"prj"> };
    }
    return isPrivate(deps.policy(), workspace) ? null : { workspace };
  }

  // 다른 컴퓨터가 부를 수 있는 session은 그 컴퓨터의 mail이 연 session뿐이다(Router의 받는 규칙). 목록에 있는 것은 모두 부를 수 있다.
  function sessions(
    ctx: AuthenticatedContext,
  ): Result<z.infer<typeof a2aSessions.output>> {
    const from = origin(ctx);
    if (!from.ok) return from;
    const policy = deps.policy();
    const listed: RemoteSession[] = [];
    for (const one of deps.openSessions()) {
      if (
        !one.accepting ||
        one.opened_by_machine !== from.value ||
        isPrivate(policy, one.workspace)
      ) {
        continue;
      }
      listed.push({
        session: one.session,
        handle: one.handle,
        name: one.name,
        title: one.title,
        workspace: crossing(one.workspace),
        state:
          SENDABLE_SESSION_STATES.find((state) => state === one.state) ??
          "unknown",
        last_active_at: one.last_active_at,
      });
    }
    return ok({ sessions: listed });
  }

  async function agents(
    ctx: AuthenticatedContext,
    input: z.infer<typeof a2aAgents.input>,
  ): Promise<Result<z.infer<typeof a2aAgents.output>>> {
    const from = origin(ctx);
    if (!from.ok) return from;
    const found = local(input.workspace);
    if (found === null) return ok({ found: false, cards: [] });
    const cards = await deps.cards(found.workspace);
    if (!cards.ok) return cards;
    return ok({
      found: true,
      cards: cards.value.map(({ callable: _callable, ...card }) => card),
    });
  }

  // 보내는 쪽: 부른 session이 다른 컴퓨터에 닿아도 되는지 보고 그 컴퓨터를 고른다.
  function target(
    ctx: AuthenticatedContext,
    machine: string,
  ): Result<{
    computer: MachineCandidate;
    workspace: Workspace | null;
    by: Requester;
  }> {
    const session = ctx.conditions.session as Id<"ses"> | undefined;
    if (session === undefined) {
      return forbidden("only an agent session reads another computer");
    }
    const sender = deps.sender(session);
    if (!sender.ok) return sender;
    const computer = deps.resolve(machine);
    if (!computer.ok) return computer;
    if (computer.value.self) {
      return err({
        code: "invalid_input",
        message: "that is this computer; leave out --on",
      });
    }
    return ok({
      computer: computer.value,
      workspace: sender.value.workspace,
      by: {
        kind: "agent",
        agent: sender.value.agent,
        session,
        name: requesterName(sender.value.name),
      },
    });
  }

  async function ask<T>(
    computer: MachineCandidate,
    route: { resource: string; method: string; output: z.ZodType<T> },
    body: unknown,
    by: Requester,
  ): Promise<Result<T>> {
    const answer = await deps.call(
      computer.device,
      {
        resource: route.resource,
        method: route.method,
        body,
        deadlineMs: deadline,
      },
      by,
    );
    if (!answer.ok) {
      if (answer.error.code === "not_found") {
        return err({
          code: "unavailable",
          message: `${computer.name} runs an older lophn; update lophn there`,
        });
      }
      if (answer.error.code === "unavailable") {
        return err({
          code: "unavailable",
          message: `${computer.name} is not reachable now`,
        });
      }
      return answer;
    }
    const parsed = route.output.safeParse(answer.value);
    return parsed.success
      ? ok(parsed.data)
      : err({
          code: "unavailable",
          message: `${computer.name} gave an answer this computer cannot read`,
        });
  }

  async function machineSessions(
    ctx: AuthenticatedContext,
    input: z.infer<typeof machinesSessions.input>,
  ): Promise<Result<z.infer<typeof machinesSessions.output>>> {
    const found = target(ctx, input.machine);
    if (!found.ok) return found;
    const { computer, by } = found.value;
    const read = await ask(computer, a2aSessions, {}, by);
    if (!read.ok) return read;
    return ok({
      machine: { machine: computer.machine, name: computer.name },
      sessions: read.value.sessions.slice(0, MAX_ITEMS).map(checkedSession),
    });
  }

  async function machineAgents(
    ctx: AuthenticatedContext,
    input: z.infer<typeof machinesAgents.input>,
  ): Promise<Result<z.infer<typeof machinesAgents.output>>> {
    const found = target(ctx, input.machine);
    if (!found.ok) return found;
    const { computer, by } = found.value;
    const workspace = deps.remoteWorkspace(
      input.workspace,
      found.value.workspace,
    );
    if (!workspace.ok) return workspace;
    const read = await ask(
      computer,
      a2aAgents,
      { workspace: workspace.value },
      by,
    );
    if (!read.ok) return read;
    return ok({
      machine: { machine: computer.machine, name: computer.name },
      workspace: workspace.value,
      found: read.value.found,
      cards: read.value.cards.slice(0, MAX_ITEMS).map(checkedCard),
    });
  }

  return { sessions, agents, machineSessions, machineAgents };
}
