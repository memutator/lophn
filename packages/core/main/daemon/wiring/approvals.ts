import { createIdSource, err, ok, type Result } from "../../../../base/mod.ts";
import type { TurnRequest } from "../../../../protocol/approvals/mod.ts";
import {
  DEFAULT_SHELL_RULES_SETTING,
  SHELL_RULES_SETTING_KEY,
  toolGateCheck,
  toolGateInputSchema,
  turnRequestDecide,
} from "../../../../protocol/approvals/mod.ts";
import { workspaceSessionRead } from "../../../../protocol/lophn-agent/agent-sessions.ts";
import type { AskResult } from "../../../../protocol/lophn-agent/ask-tool.ts";
import {
  type AskQuestion,
  askAnswer,
  askRead,
  askWait,
} from "../../../../protocol/lophn-agent/ask-tool.ts";
import type { CallAskKind } from "../../../../protocol/lophn-agent/calls.ts";
import {
  blocksText,
  textBlocks,
} from "../../../../protocol/lophn-agent/content-block.ts";
import { turnRead } from "../../../../protocol/lophn-agent/turn-reads.ts";
import type { TurnMode } from "../../../../protocol/lophn-agent/turn-values.ts";
import type {
  AgentId,
  Workspace,
} from "../../../../protocol/lophn-agent/workspaces.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import { createApprovals } from "../../../approvals/mod.ts";
import {
  shellRuleLayers,
  shellRulesSetting,
  withAlwaysRules,
} from "../../../approvals/shell-rules/mod.ts";
import { agentAssignment } from "../../../apps/usage/users.ts";
import type { Bus } from "../../../events/ports.ts";
import {
  createToolGate,
  type ToolGateDeps,
} from "../../../lophn-agent/tool-judgment/mod.ts";
import { createQuestionWaits } from "../../../lophn-agent/tools/questions/mod.ts";
import {
  loadProjectCommands,
  resolveProjectCommandPolicy,
} from "../../../projects/commands/store.ts";
import { callsAskOpen, callsAskWithdraw } from "../../../router/mod.ts";
import type { MemoryHandler } from "../../../server/mod.ts";
import { openConnection } from "../../../storage/ledger/mod.ts";
import type { WiringFactory } from "./context.ts";

// tool Gate가 session의 agent를 읽는 core 내부 machine 자격이다. 기동 때 ledger에 기록한다.
const APPROVALS_PRINCIPAL = "machine:approvals";

const APPROVALS_CONTEXT: AuthenticatedContext = {
  principal: APPROVALS_PRINCIPAL,
  actor: "machine",
  scope: {
    operations: [
      workspaceSessionRead.name,
      turnRead.name,
      callsAskOpen.name,
      callsAskWithdraw.name,
    ],
    targets: {},
  },
  conditions: {},
  credential_ref: APPROVALS_PRINCIPAL,
};

const DROPPING_BUS: Bus = {
  publish() {},
  subscribe: () => () => {},
};

// 호출한 agent의 credential이 묶인 session·turn과 입력이 같을 때만 받는다.
function ownTurn(
  who: AuthenticatedContext,
  input: { session: string; turn: string },
): Result<void> {
  return who.actor === `agent:${input.session}` &&
    who.conditions.session === input.session &&
    who.conditions.turn === input.turn
    ? ok(undefined)
    : err({
        code: "forbidden",
        message: "the credential belongs to another session or turn",
      });
}

type SessionInfo = {
  agent: AgentId;
  workspace: Workspace | null;
  // 팀 자식이면 부모 session.
  spawnedBy: string | null;
  skip: boolean;
};

// runtime이 Gate가 걸리는 tool을 실행하기 직전에 부르는 입구다. 판정, 묻기, 사람 결정 기다리기를 모두 여기서 한다.
// mode는 그 turn 행의 mode다(시작 때 정해 바뀌지 않는다). 읽지 못하면 판정하지 않는다.
export function toolGateHandler(deps: {
  approvals: ToolGateDeps["approvals"];
  sessionOf(session: string): Promise<Result<SessionInfo>>;
  modeOf(turn: string): Promise<Result<TurnMode>>;
}): MemoryHandler {
  return async (who, body) => {
    const input = toolGateInputSchema.parse(body);
    const own = ownTurn(who, input);
    if (!own.ok) return own;
    const found = await deps.sessionOf(input.session);
    if (!found.ok) return found;
    const mode = await deps.modeOf(input.turn);
    if (!mode.ok) return mode;
    return await createToolGate({ approvals: deps.approvals }).check({
      session: input.session,
      turn: input.turn,
      toolCall: input.tool_call,
      agent: found.value.agent,
      workspace: found.value.workspace,
      mode: mode.value,
      // skip이 먼저다: 사람이 skip을 켠 session은 팀 자식이어도 묻지 않는다. setting·project_command·project_command_definition은
      // skip도 묻는 호출이라 팀 자식이면 skip과 상관없이 자식으로 판정한다(setting·definition은 Gate가 막고, command는 부모에게 간다).
      toParent:
        found.value.spawnedBy !== null &&
        (!found.value.skip ||
          input.call.kind === "setting" ||
          input.call.kind === "project_command" ||
          input.call.kind === "project_command_definition"),
      tool: input.tool,
      call: input.call,
    });
  };
}

// `ask` tool의 기다림 입구다. 사람 없는 turn(unattended)과 팀 자식의 질문을 여기서 한 번에 가른다:
// 자식이면 mode와 skip에 상관없이 부모에게 가고, 팀 밖이면 unattended turn만 묻지 않고 돌려준다.
export function askWaitHandler(deps: {
  ask(
    call: { session: string; turn: string; tool_call: string },
    questions: AskQuestion[],
    toParent: boolean,
  ): Promise<AskResult>;
  sessionOf(session: string): Promise<Result<SessionInfo>>;
  modeOf(turn: string): Promise<Result<TurnMode>>;
}): MemoryHandler {
  return async (who, body) => {
    const input = askWait.input.parse(body);
    const own = ownTurn(who, input);
    if (!own.ok) return own;
    const found = await deps.sessionOf(input.session);
    if (!found.ok) return found;
    const mode = await deps.modeOf(input.turn);
    if (!mode.ok) return mode;
    const toParent = found.value.spawnedBy !== null;
    if (!toParent && mode.value === "unattended") {
      return ok({ outcome: "unattended" });
    }
    return ok(await deps.ask(input, input.questions, toParent));
  };
}

// 부모에게 가는 ask call 본문이다. 승인은 카드 내용(명령 글이나 tool 이름)만 싣고 agent가 쓴 설명은 싣지 않는다.
const ASK_HELP =
  "If you cannot decide, use `ask` yourself; it goes to your own parent or the person.";

function approvalText(subject: TurnRequest["subject"]): string {
  const what =
    subject.kind === "shell"
      ? `run this shell command:\n${subject.command}`
      : subject.kind === "project_command"
        ? `run project command "${subject.name}":\n${subject.command}${subject.cwd ? `\ncwd: ${subject.cwd}` : ""}${subject.env_keys.length > 0 ? `\nenv keys: ${subject.env_keys.join(", ")}` : ""}`
        : subject.kind === "mcp_tool"
          ? `use the tool ${subject.server}/${subject.tool}`
          : subject.kind === "app_tool"
            ? `use the tool ${subject.tool}`
            : "continue";
  return `A team member needs approval to ${what}\n\nReply with \`lophn call reply <call> --allow\` or \`lophn call reply <call> --reject --body <reason>\`. ${ASK_HELP}`;
}

function questionText(questions: readonly AskQuestion[]): string {
  const lines = questions.flatMap((one, at) => [
    `${at + 1}. [${one.header}] ${one.question}${one.multiSelect ? " (more than one may apply)" : ""}`,
    ...one.options.map(
      (option) => `   - ${option.label}: ${option.description}`,
    ),
  ]);
  return `A team member asks:\n${lines.join("\n")}\n\nReply with \`lophn call reply <call> --body <answer>\`. If you cannot answer, use \`ask\` yourself; it goes to your own parent or the person.`;
}

export const approvalsWiring: WiringFactory = () => {
  let stopWatching: (() => void) | undefined;
  // 내려갈 때 기다림을 모두 푼다. 풀지 않으면 기다리는 요청 때문에 서버가 멈추지 못한다.
  let releaseWaits: (() => void) | undefined;
  return {
    name: "approvals",
    records: () => [APPROVALS_CONTEXT],
    build(ctx) {
      // Bus는 events가 만들어 slot으로 낸다. slot이 비어 있으면 event를 버린다.
      const bus: Bus = ctx.peek.bus ?? DROPPING_BUS;
      // 할당은 agent 정의 파일에서 그때그때 읽는다.
      const assignmentOf = (agent: AgentId) => {
        const connection = openConnection(ctx.ledgerPath);
        if (!connection.ok) return Promise.resolve(connection);
        try {
          return Promise.resolve(agentAssignment(connection.value.sql, agent));
        } finally {
          connection.value.close();
        }
      };
      const shellRulesNow = () =>
        ctx.peek.settings?.get(shellRulesSetting) ??
        DEFAULT_SHELL_RULES_SETTING;
      const projectCommandPolicyOf = (
        project: string,
        commandId: string | null,
        agent: AgentId,
      ) => {
        const connection = openConnection(ctx.ledgerPath);
        if (!connection.ok) return Promise.resolve(connection);
        try {
          const loaded = loadProjectCommands(connection.value.sql, project);
          if (!loaded.ok) return Promise.resolve(loaded);
          return Promise.resolve(
            ok(
              resolveProjectCommandPolicy(
                loaded.value.commands,
                loaded.value.settings,
                commandId,
                agent,
              ),
            ),
          );
        } finally {
          connection.value.close();
        }
      };
      const service = createApprovals({
        assignmentOf,
        // 판정마다 읽어 사람이 Settings에서 고친 값이 다음 호출부터 쓰인다.
        shellRules: (workspace) => shellRuleLayers(shellRulesNow(), workspace),
        projectCommandPolicyOf,
        bus,
        clock: ctx.clock,
        ids: createIdSource({ clock: ctx.clock, random: ctx.random }),
      });
      // `always`는 사람의 결정에서만 온다(decide는 사람 자격만 받는다). 규칙은 workspace로 고른 층에 더한다.
      service.remember("shell", (request, workspace) => {
        const next = withAlwaysRules(
          shellRulesNow(),
          workspace,
          request.always_patterns,
        );
        const written = ctx.settingsUpdate([
          { key: SHELL_RULES_SETTING_KEY, action: "set", value: next },
        ]);
        return Promise.resolve(
          !written.ok || written.value.rejected.length > 0
            ? err({
                code: "internal",
                message: "the shell rule could not be saved",
              })
            : ok(undefined),
        );
      });
      ctx.provide("approvals", service);

      // runtime의 Gate 입구와 ask 기다림이다. 기다림은 여기 main thread 메모리에 있고 runtime은 결과만 받는다.
      const ids = createIdSource({ clock: ctx.clock, random: ctx.random });
      const waits = createQuestionWaits({ bus, clock: ctx.clock, ids });
      ctx.provide("questionWaits", waits);
      // turn이 끝나거나 session이 닫히면 기다리던 turn request와 질문을 cancelled로 푼다.
      // 사람이 기다리는 session에 메시지를 보내면 질문은 그 메시지로 풀린다.
      stopWatching = bus.subscribe(
        [
          {
            types: ["TurnEnded", "SessionEnded", "MessageReceived"],
          },
        ],
        {
          send(event) {
            if (!("session" in event)) return;
            if (event.type === "TurnEnded") {
              service.cancelTurnRequests(event.session, "turn_ended");
              waits.cancel(event.session, event.payload.turn);
            } else if (event.type === "SessionEnded") {
              service.cancelTurnRequests(event.session, "session_closed");
              waits.cancel(event.session);
            } else if (
              event.type === "MessageReceived" &&
              event.payload.from.kind === "human"
            ) {
              waits.humanMessage(event.session, blocksText(event.payload.body));
            }
          },
          close() {},
        },
      );
      // 팀 자식의 request·질문은 사람 대신 부모에게 가는 result call로 간다. call과 request(질문 묶음)의 짝은 메모리에만 둔다:
      // request가 메모리라 재시작하면 짝도 사라지고, 열린 ask call은 Router의 recover가 닫는다.
      // 꺼질 때는 call을 닫지 않는다(구독을 먼저 뗀다).
      const sessionInfo = async (
        session: string,
      ): Promise<Result<SessionInfo>> => {
        const found = await ctx.runtime.readers.read(
          workspaceSessionRead,
          APPROVALS_CONTEXT,
          { session },
        );
        if (!found.ok) return found;
        const { agent, workspace, spawned_by, skip } = (
          found.value as {
            session: {
              agent: AgentId;
              workspace: Workspace | null;
              spawned_by: string | null;
              skip: boolean;
            };
          }
        ).session;
        return ok({ agent, workspace, spawnedBy: spawned_by, skip });
      };
      const modeOf = async (turn: string): Promise<Result<TurnMode>> => {
        const found = await ctx.runtime.readers.read(
          turnRead,
          APPROVALS_CONTEXT,
          { turn },
        );
        if (!found.ok) return found;
        return ok((found.value as { turn: { mode: TurnMode } }).turn.mode);
      };
      const asks = new Map<
        string,
        { kind: CallAskKind; key: string; session: string }
      >();
      const callOf = new Map<string, string>();
      // 부모에게 갔고 아직 열려 있는 request·묶음. call을 여는 동안 닫혔는지 가린다.
      const waiting = new Set<string>();
      const run = async (
        route: { name: string },
        input: unknown,
      ): Promise<Result<Record<string, unknown>>> => {
        const done = await ctx.writer.command(APPROVALS_CONTEXT, {
          command: route.name,
          input,
          idempotency_key: ids.newId("idk"),
          compare: {},
          prepared: [],
        });
        return done.ok
          ? ok(done.value.result as Record<string, unknown>)
          : done;
      };
      const forget = (key: string) => {
        waiting.delete(key);
        const call = callOf.get(key);
        callOf.delete(key);
        if (call !== undefined) asks.delete(call);
        return call;
      };
      const settleGone = (kind: CallAskKind, key: string, reason: string) => {
        if (kind === "approval")
          service.answerFromParent(key, "reject", reason);
        else waits.settleGroup(key, { outcome: "cancelled", answers: [] });
      };
      const openAsk = async (
        kind: CallAskKind,
        key: string,
        session: string,
        turn: string,
        text: string,
      ) => {
        waiting.add(key);
        const found = await sessionInfo(session);
        const mode = await modeOf(turn);
        const parent = found.ok ? found.value.spawnedBy : null;
        const opened =
          parent === null || !mode.ok
            ? null
            : await run(callsAskOpen, {
                from: session,
                to: parent,
                ask: kind,
                body: textBlocks(text),
                unattended: mode.value === "unattended",
              });
        // 부모에게 닿지 않으면(끝났거나 call이 거절됐다) 자식의 turn이 걸리지 않게 바로 푼다.
        if (
          opened === null ||
          !opened.ok ||
          opened.value["state"] !== "accepted"
        ) {
          if (waiting.delete(key)) {
            settleGone(
              kind,
              key,
              "the request could not reach the parent session",
            );
          }
          return;
        }
        const call = String(opened.value["call"]);
        if (!waiting.has(key)) {
          // 여는 동안 다른 이유로 이미 닫혔다.
          void run(callsAskWithdraw, { call, session });
          return;
        }
        asks.set(call, { kind, key, session });
        callOf.set(key, call);
      };
      const closedOther = (key: string) => {
        const ask = asks.get(callOf.get(key) ?? "");
        const call = forget(key);
        if (ask !== undefined && call !== undefined) {
          void run(callsAskWithdraw, { call, session: ask.session });
        }
      };
      service.askReplies = {
        answered({ call, decision, text }) {
          const ask = asks.get(call);
          if (ask === undefined) return;
          forget(ask.key);
          if (ask.kind === "approval") {
            service.answerFromParent(
              ask.key,
              decision === "allow" ? "allow" : "reject",
              decision === "reject" && text.trim() !== ""
                ? text.trim().slice(0, 500)
                : null,
            );
          } else {
            waits.settleGroup(ask.key, {
              outcome: "parent_reply",
              message: text,
            });
          }
        },
        ended({ call }) {
          const ask = asks.get(call);
          if (ask === undefined) return;
          forget(ask.key);
          settleGone(
            ask.kind,
            ask.key,
            "the parent session ended without answering",
          );
        },
      };
      const stopAsks = bus.subscribe(
        [
          {
            types: [
              "TurnRequestOpened",
              "TurnRequestClosed",
              "QuestionAsked",
              "QuestionResolved",
            ],
          },
        ],
        {
          send(event) {
            if (!("session" in event)) return;
            if (event.type === "TurnRequestOpened") {
              const { request } = event.payload;
              if (request.to_parent) {
                void openAsk(
                  "approval",
                  request.id,
                  event.session,
                  request.turn,
                  approvalText(request.subject),
                );
              }
            } else if (event.type === "QuestionAsked") {
              const { group, turn, tool_call, to_parent } = event.payload;
              const read = to_parent
                ? waits.read(event.session, tool_call)
                : null;
              if (read?.ok) {
                void openAsk(
                  "question",
                  group,
                  event.session,
                  turn,
                  questionText(read.value.questions),
                );
              }
            } else if (event.type === "TurnRequestClosed") {
              closedOther(event.payload.request);
            } else if (event.type === "QuestionResolved") {
              closedOther(event.payload.group);
            }
          },
          close() {},
        },
      );
      const stopAll = stopWatching;
      stopWatching = () => {
        stopAll?.();
        stopAsks();
      };
      const gating = new Set<string>();
      releaseWaits = () => {
        waits.cancelAll();
        for (const session of gating) {
          service.cancelTurnRequests(session, "restart");
        }
      };
      const toolGate = toolGateHandler({
        approvals: {
          ...service,
          openTurnRequest(origin, subject) {
            gating.add(origin.session);
            return service.openTurnRequest(origin, subject);
          },
        },
        sessionOf: sessionInfo,
        modeOf,
      });
      const askWaitRoute = askWaitHandler({
        ask: (call, questions, toParent) =>
          waits.ask(call, questions, toParent),
        sessionOf: sessionInfo,
        modeOf,
      });
      const humanOnly = (who: AuthenticatedContext): Result<void> =>
        who.actor === "user"
          ? ok(undefined)
          : err({ code: "forbidden", message: "only the user answers" });
      const askReadHandler: MemoryHandler = (who, body) => {
        const user = humanOnly(who);
        if (!user.ok) return user;
        const input = askRead.input.parse(body);
        return waits.read(input.session, input.tool_call);
      };
      const askAnswerHandler: MemoryHandler = (who, body) => {
        const user = humanOnly(who);
        if (!user.ok) return user;
        const input = askAnswer.input.parse(body);
        return waits.answer(input.session, input.tool_call, input.answers);
      };
      const key = (route: { resource: string; method: string }) =>
        `${route.resource}/${route.method}`;
      return ok({
        memory: [
          [key(turnRequestDecide), (who, body) => service.decide(who, body)],
          [key(toolGateCheck), toolGate],
          [key(askWait), askWaitRoute],
          [key(askRead), askReadHandler],
          [key(askAnswer), askAnswerHandler],
        ],
      });
    },
    closeIntake() {
      stopWatching?.();
      releaseWaits?.();
    },
  };
};
