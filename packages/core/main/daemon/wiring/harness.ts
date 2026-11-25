import { mkdir } from "node:fs/promises";
import { resolve, sep } from "node:path";
import {
  canonicalize,
  createIdSource,
  err,
  ok,
  type Result,
  sha256Hex,
} from "../../../../base/mod.ts";
import type { Id } from "../../../../protocol/base/ids.ts";
import { HARNESS_ADAPTER_OF_RUNTIME } from "../../../../protocol/coding-agent/harness-adapter.ts";
import { harnessHomeName } from "../../../../protocol/coding-agent/harness-home.ts";
import {
  type AgentId,
  type AgentRuntime,
  archiveSession,
  bindHarnessSession,
  blocksOfContent,
  type ContentBlock,
  failHarnessMemberCall,
  finishTurn,
  messageBody,
  openHarnessMember,
  recordMessage,
  startTurn,
  type TurnOutcome,
  turnRead,
} from "../../../../protocol/lophn-agent/mod.ts";
import type {
  AuthenticatedContext,
  Output,
} from "../../../../protocol/server/mod.ts";
import {
  type WorkflowOrigin,
  workflowOriginSchema,
} from "../../../../protocol/workflows/values.ts";
import { appFolderPaths, appSourcePath } from "../../../apps/lookups.ts";
import { createHold } from "../../../host-queue/mod.ts";
import {
  createQueue,
  createQueueApplier,
  inputParts,
  QUEUE_CLEAR_TOPIC,
  QUEUE_PUT_TOPIC,
  QUEUE_WITHDRAW_TOPIC,
  turnLimitsOf,
} from "../../../lophn-agent/run-loop/mod.ts";
import { unstartedHumanMessages } from "../../../lophn-agent/session/message-commands.ts";
import {
  forkedHarnessSession,
  HARNESS_QUEUE_PUT_TOPIC,
  harnessOf,
} from "../../../lophn-agent/session/mod.ts";
import {
  type AgentSessionRow,
  loadSession,
  workspaceOf,
} from "../../../lophn-agent/session/model.ts";
import { ledgerSnapshot } from "../../../lophn-agent/session/rewind/files.ts";
import {
  createSessionDirectory,
  workspaceDepsOf,
} from "../../../lophn-agent/workspaces/mod.ts";
import { projectFolderPaths } from "../../../projects/lookups.ts";
import {
  openConnection,
  withAfterCommit,
} from "../../../storage/ledger/mod.ts";
import type {
  HarnessMembers,
  MemberTurnEnd,
} from "../../../terminal-agents/member.ts";
import type { WiringFactory } from "./context.ts";
import {
  createHarnessCredentials,
  type HarnessCredentials,
} from "./harness-credential.ts";

// core 안 harness 실행(터미널 GUI 탭과 background 실행)이 쓰는 ledger·queue port다.
// queue(메모리)를 쥐고, turn과 메시지는 machine 자격으로 기존 command(StartTurn, RecordMessage, FinishTurn)에 기록한다.
const HARNESS_PRINCIPAL = "machine:harness";
const HARNESS_CONTEXT: AuthenticatedContext = {
  principal: HARNESS_PRINCIPAL,
  actor: "machine",
  scope: {
    operations: [
      startTurn.name,
      finishTurn.name,
      recordMessage.name,
      bindHarnessSession.name,
      openHarnessMember.name,
      failHarnessMemberCall.name,
      turnRead.name,
      messageBody.name,
    ],
    targets: {},
  },
  conditions: {},
  credential_ref: HARNESS_PRINCIPAL,
};

const key = (route: { resource: string; method: string }) =>
  `${route.resource}/${route.method}`;

// harness turn의 끝을 ledger turn의 끝으로 옮긴다. 사람이 멈춘 turn을 interrupted로 닫는 길은 StopTurn이다.
function outcomeOf(end: MemberTurnEnd): TurnOutcome {
  return end === "completed"
    ? { kind: "completed", reason: "answer_completed" }
    : end === "failed"
      ? { kind: "failed", reason: "model_error" }
      : end === "stopped"
        ? { kind: "failed", reason: "no_answer" }
        : end === "unconfigured"
          ? { kind: "failed", reason: "configuration_unavailable" }
          : { kind: "failed", reason: "target_unavailable" };
}

async function ensureDataFolder(
  dataRoot: string,
  name: string,
): Promise<Result<string>> {
  const root = resolve(dataRoot);
  const target = resolve(root, name);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    return err({ code: "invalid_input", message: "folder escapes data root" });
  }
  try {
    await mkdir(target, { recursive: true });
    return ok(target);
  } catch (cause) {
    return err({
      code: "unavailable",
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

export const harnessWiring: WiringFactory = () => {
  // harness session의 queue다. run-loop의 queue와 따로여서 run-loop가 harness 입력을 가져가지 않는다.
  const queue = createQueue();
  let unsubscribe: (() => void) | undefined;
  // harness가 `lophn`을 부를 turn 자격. build에서 만들고 TurnEnded가 끝낸다.
  let credentials: HarnessCredentials | undefined;
  const turnClosed = new Set<
    (event: { session: string; turn: string }) => void
  >();
  return {
    name: "harness",
    records: () => [HARNESS_CONTEXT],
    build(ctx) {
      const ids = createIdSource({ clock: ctx.clock, random: ctx.random });
      const turnCredentials = createHarnessCredentials({
        registry: ctx.registry,
        record: (context) => ctx.runtime.record(context),
      });
      credentials = turnCredentials;
      // TUI가 열린 session. queue와 따로 둔다: setRunning으로 막으면 steer 입력이 steering으로 가 harness가 읽지 않고 잃는다.
      const hold = createHold({ clock: ctx.clock });
      const read = async <T>(
        r: { resource: string; method: string },
        input: unknown,
      ): Promise<Result<T>> =>
        (await ctx.runtime.reads.get(key(r))!(
          HARNESS_CONTEXT,
          input,
        )) as Result<T>;
      const command = (name: string, input: unknown, compare = {}) =>
        ctx.writer.command(HARNESS_CONTEXT, {
          command: name,
          input,
          idempotency_key: ids.newId("idk"),
          compare,
          prepared: [],
        });

      // 이 session이 열려 있고 입력을 받고 runtime이 harness여야 한다. 아니면 어떤 route도 고치지 못한다.
      const harnessSession = (session: string) => {
        const found = ledgerSnapshot(ctx.ledgerPath, (lookup) => {
          const directory = createSessionDirectory({
            ...workspaceDepsOf(lookup.sql),
            publish: () => {},
            sql: () => lookup.sql,
          });
          const row = loadSession(lookup, session);
          return {
            row,
            target: directory.find(session as Id<"ses">),
            fork: row === undefined ? null : forkedHarnessSession(lookup, row),
          };
        });
        if (!found.ok) return found;
        const harness = harnessOf(found.value.row);
        if (!harness.ok) return harness;
        return ok({
          row: harness.value,
          accepting: found.value.target?.accepting === true,
          fork: found.value.fork,
        });
      };

      // `tabs/open`의 tui가 부른다. 판정을 통과하면 그 자리에서 hold를 건다(core는 한 thread라 사이에 turn이 끼지 못한다).
      ctx.provide("harnessHold", {
        heartbeat: (sessions) => hold.beat(sessions),
        open(session) {
          const found = harnessSession(session);
          if (!found.ok) {
            return found.error.code === "not_found"
              ? found
              : err({
                  code: "invalid_input",
                  message: "a tui opens harness agent sessions only",
                });
          }
          const row = found.value.row;
          // GUI 탭의 팀원은 그 탭이 CLI를 쥐고 있다. TUI를 따로 열면 한 CLI session을 process 둘이 쓴다.
          if (row.harness_gui) {
            return err({
              code: "invalid_input",
              message: "a tui opens harness agent sessions only",
            });
          }
          if (row.workspace_kind !== "project") {
            return err({
              code: "invalid_input",
              message: "a tui opens sessions of a project workspace only",
            });
          }
          if (row.harness_session === null) {
            return err({
              code: "conflict",
              message: "this session has not run yet",
            });
          }
          if (queue.isRunning(session)) {
            return err({
              code: "conflict",
              message: "a turn is running; wait or stop it",
            });
          }
          const bg = ctx.peek.terminalAgents?.background;
          if (bg?.isAlive(session)) {
            // 상주 background CLI process가 아직 살아 있으면 유휴 handle을 즉시 닫고 재시도하게 한다.
            bg.evict(session);
            return err({
              code: "conflict",
              message: "this session is closing in the background; try again",
            });
          }
          if (hold.held(session)) {
            return err({
              code: "conflict",
              message: "this session is already open in a tui",
            });
          }
          hold.reserve(session);
          return ok({
            harness: HARNESS_ADAPTER_OF_RUNTIME[row.harness],
            external_session: row.harness_session,
          });
        },
      });

      // queue 맨 앞 입력을 harness에 넘길 글로 싼다. 본문은 session 기록이 정본이다(빼거나 고친 사람 메시지가 queue에 남지 않게 한다).
      // 본문이 없어졌으면 그 입력을 queue에서 뺀다.
      const headOf = async (session: Id<"ses">, row: { harness: string }) => {
        const head = queue.next(session)!;
        const body = await read<Output<typeof messageBody>>(messageBody, {
          message: head.message,
        });
        if (!body.ok) {
          if (body.error.code === "not_found") {
            queue.remove(session, head.message as string);
          }
          return null;
        }
        const prompt = inputParts(
          { ...head, body: blocksOfContent(body.value.content) },
          row.harness as AgentRuntime,
        )
          .map((part) =>
            part.kind === "text"
              ? part.text
              : `[image: ${part.media_type} not passed to the harness]`,
          )
          .join("\n");
        return { head, prompt };
      };

      // 입력 하나로 turn을 연다. 그 turn의 자격을 내고 StartTurn이 기록한 그 입력만 queue에서 꺼낸다.
      const beginTurn = async (
        session: Id<"ses">,
        inputMessage: string,
        row: AgentSessionRow,
      ): Promise<Result<{ turn: string; credential: string }>> => {
        const head = queue.next(session);
        if (
          head === undefined ||
          head.message !== inputMessage ||
          queue.isRunning(session)
        ) {
          return err({
            code: "conflict",
            message: "that input is not the next one of an idle session",
          });
        }
        const limits = turnLimitsOf(ctx.settings);
        if (!limits.ok) return limits;
        const turn = ids.newId("trn");
        const credential = await turnCredentials.issue({
          session,
          turn,
          workspace: workspaceOf(row),
        });
        if (!credential.ok) return credential;
        const started = await command(startTurn.name, {
          id: turn,
          session,
          input_message: inputMessage,
          basis: await sha256Hex(
            canonicalize({
              harness: row.harness,
              session,
              input_message: inputMessage,
            }),
          ),
          limits: limits.value,
          mode: head.unattended ? "unattended" : "attended",
        });
        if (!started.ok) {
          turnCredentials.end(turn);
          // 입력의 메시지가 없어졌으면 queue에 남겨 같은 입력을 되풀이하게 두지 않는다.
          if (started.error.code === "not_found") {
            queue.remove(session, inputMessage);
          }
          return started;
        }
        // 기다리는 사이 머리가 바뀌었어도 남의 입력을 집지 않는다.
        queue.take(session, inputMessage as Id<"msg">);
        queue.setRunning(session, true);
        return ok({ turn, credential: credential.value });
      };

      // 모델이 쓴 본문이 없으므로 알린 사실만 결과로 정리한다(StopTurn과 같다).
      const finishOf = async (
        turnId: string,
        outcome: TurnOutcome,
      ): Promise<Result<void>> => {
        const turn = await read<Output<typeof turnRead>>(turnRead, {
          turn: turnId,
        });
        if (!turn.ok) return turn;
        const found = harnessSession(turn.value.turn.session);
        if (!found.ok) return found;
        const result = await sha256Hex(
          canonicalize({
            turn: turnId,
            session: turn.value.turn.session,
            outcome,
          }),
        );
        const done = await command(
          finishTurn.name,
          { turn: turnId, outcome, result },
          { state_seq: turn.value.turn.state_seq },
        );
        return done.ok ? ok(undefined) : done;
      };

      // GUI 탭 팀원(`member.ts`)과 background 실행기(`background.ts`)가 함께 쓰는 port다.
      const queued = new Set<(session: string) => void>();
      const personTurns = new Set<
        (
          event:
            | { kind: "started"; session: string }
            | {
                kind: "ended";
                session: string;
                end: MemberTurnEnd;
                error: string | null;
              },
        ) => void
      >();
      // 화면에 내지 않을 session인지(`hidingSessions`). session의 표시는 바뀌지 않으므로 한 번 읽어 둔다.
      const memberOf = new Map<string, boolean>();
      const members: HarnessMembers = {
        async ensure(input) {
          const found = ledgerSnapshot(ctx.ledgerPath, (lookup) =>
            lookup.sql
              .all(
                `select id from sessions where harness_gui = 1 and lifecycle = 'open'
                   and harness = ? and project = ? and harness_session = ?
                 order by created_seq desc`,
                [input.harness, input.project, input.cli_session],
              )
              .map((row) => String(row["id"])),
          );
          if (!found.ok) return found;
          const reuse = found.value.find((id) => !input.taken.has(id));
          if (reuse !== undefined) {
            memberOf.set(reuse, true);
            return ok(reuse);
          }
          const id = ids.newId("ses");
          // SessionStarted가 화면으로 가기 전에 표시한다.
          memberOf.set(id, true);
          const opened = await command(openHarnessMember.name, {
            id,
            harness: input.harness,
            project: input.project,
            external_session_id: input.cli_session,
          });
          if (!opened.ok) memberOf.delete(id);
          return opened.ok ? ok(id) : opened;
        },
        async openForAgent(input) {
          const id = ids.newId("ses");
          // SessionStarted가 화면으로 가기 전에 팀원 표시를 먼저 둔다.
          memberOf.set(id, true);
          const opened = await command(openHarnessMember.name, {
            id,
            harness: input.harness,
            project: input.project,
            agent: input.agent,
            external_session_id: null,
          });
          if (!opened.ok) memberOf.delete(id);
          return opened.ok ? ok(id) : opened;
        },
        async bind(session, cliSession) {
          const done = await command(bindHarnessSession.name, {
            session,
            external_session_id: cliSession,
          });
          return done.ok ? ok(undefined) : done;
        },
        async next(session) {
          const id = session as Id<"ses">;
          if (queue.isRunning(id) || queue.next(id) === undefined) return null;
          const found = harnessSession(id);
          if (!found.ok || !found.value.accepting) {
            if (!found.ok && found.error.code !== "unavailable") {
              queue.clear(id);
            }
            return null;
          }
          const row = found.value.row;
          if (!row.harness_gui && hold.held(id)) return null;
          const taken = await headOf(id, row);
          return taken === null
            ? null
            : {
                message: taken.head.message as string,
                kind: taken.head.kind,
                call: taken.head.call,
                reply: taken.head.reply,
                prompt: taken.prompt,
              };
        },
        async start(session, message) {
          const id = session as Id<"ses">;
          const found = harnessSession(id);
          if (!found.ok) return found;
          const row = found.value.row;
          if (!found.value.accepting || (!row.harness_gui && hold.held(id))) {
            return err({
              code: "conflict",
              message: "that input is not the next one of an idle session",
            });
          }
          const begun = await beginTurn(id, message, row);
          return begun.ok
            ? ok({ turn: begun.value.turn, token: begun.value.credential })
            : begun;
        },
        async credential(session) {
          const found = harnessSession(session);
          if (!found.ok) return found;
          const turn = ids.newId("trn");
          const token = await turnCredentials.issue({
            session,
            turn,
            workspace: workspaceOf(found.value.row),
          });
          return token.ok ? ok({ turn, token: token.value }) : token;
        },
        async record(session, turn, part) {
          const message = ids.newId("msg");
          const done = await command(recordMessage.name, {
            id: message,
            session,
            turn,
            content: { schema_version: 1, parts: [part] },
          });
          if (!done.ok) return done;
          // model 호출이 없는 message라 model_call은 null이다. Home/App 화면이 대화를 바로 갱신한다.
          ctx.bus.publish({
            session: session as Id<"ses">,
            type: "MessageRecorded",
            at: ctx.clock.now(),
            payload: {
              turn,
              message: message as Id<"msg">,
              model_call: null,
            },
          });
          return ok(undefined);
        },
        finish: (turn, end) => finishOf(turn, outcomeOf(end)),
        async failCall(session, call) {
          const done = await command(failHarnessMemberCall.name, {
            session,
            call,
          });
          return done.ok ? ok(undefined) : done;
        },
        // 답을 기다리는 열린 call이 있거나 도는 workflow step을 맡은 session. 읽지 못하면 쥔 것으로 보아 닫지 않는다.
        holding(session) {
          const found = ledgerSnapshot(ctx.ledgerPath, (lookup) =>
            lookup.sql.all(
              `select 1 as held from agent_calls
                 where from_session = ? and state = 'accepted'
               union all
               select 1 from messages m
                 join workflow_instances w on w.id = m.step_instance
                 where m.session = ? and w.state = 'running' and w.current_step = m.step_name`,
              [session, session],
            ),
          );
          return !found.ok || found.value.length > 0;
        },
        describe(session) {
          const found = harnessSession(session);
          if (!found.ok || !found.value.accepting) return null;
          const row = found.value.row;
          if (
            !row.harness_gui ||
            row.workspace_kind !== "project" ||
            row.workspace_id === null
          ) {
            return null;
          }
          let workflow_origin: WorkflowOrigin | null = null;
          if (row.workflow_origin !== null) {
            try {
              const parsed = workflowOriginSchema.safeParse(
                JSON.parse(row.workflow_origin),
              );
              if (parsed.success) workflow_origin = parsed.data;
            } catch {
              // 손상된 값은 무시하고 실행 project에 연다.
            }
          }
          return {
            project: row.workspace_id,
            harness: row.harness,
            cli_session: row.harness_session,
            team: row.spawned_by !== null,
            workflow_origin,
          };
        },
        background(session) {
          const id = session as Id<"ses">;
          const found = harnessSession(id);
          if (!found.ok || !found.value.accepting) {
            if (!found.ok && found.error.code !== "unavailable") {
              queue.clear(id);
            }
            return null;
          }
          const row = found.value.row;
          if (row.harness_gui) return null;
          return {
            harness: row.harness,
            agent: row.agent,
            cli_session: row.harness_session,
            fork_from: found.value.fork,
            held: hold.held(id),
          };
        },
        waiting: () => queue.waiting(),
        async cwd(session) {
          const found = harnessSession(session);
          if (!found.ok) return null;
          const row = found.value.row;
          if (row.workspace_kind === null) {
            const made = await ensureDataFolder(
              ctx.root.path,
              harnessHomeName(session),
            );
            return made.ok ? made.value : null;
          }
          const path = ledgerSnapshot(ctx.ledgerPath, (lookup) => {
            if (row.workspace_kind === "project") {
              return (
                projectFolderPaths(lookup.sql, row.workspace_id!)[0] ?? null
              );
            }
            return (
              appSourcePath(lookup.sql, row.workspace_id!) ??
              appFolderPaths(lookup.sql, row.workspace_id!)[0] ??
              null
            );
          });
          return path.ok ? path.value : null;
        },
        async definition(session) {
          const found = harnessSession(session);
          if (!found.ok) return found;
          const agent = found.value.row.agent as AgentId;
          const info = ledgerSnapshot(ctx.ledgerPath, (lookup) =>
            workspaceDepsOf(lookup.sql).agents.agent(agent),
          );
          if (!info.ok) return info;
          if (info.value === null) {
            return err({
              code: "not_found",
              message: "The agent definition could not be read.",
            });
          }
          return ok({
            deny: info.value.deny,
            ...(info.value.harnessConfig === undefined
              ? {}
              : { harness_config: info.value.harnessConfig }),
          });
        },
        async approve(session, subject) {
          const reject = (reason = "no one is watching this background run") =>
            ({ reject: reason }) as const;
          if (subject.kind === "setting") return reject();
          const found = harnessSession(session);
          if (!found.ok) return reject();
          const row = found.value.row;
          const agent = row.agent as AgentId;
          const info = ledgerSnapshot(ctx.ledgerPath, (lookup) =>
            workspaceDepsOf(lookup.sql).agents.agent(agent),
          );
          if (!info.ok || info.value === null) return reject();
          // session이나 agent 정의의 권한 단계가 full이면 ask 규칙을 묻지 않고 허용한다(floor·deny 규칙은 늘 유지).
          const full =
            row.permission_mode === "full" ||
            info.value.permissionMode === "full";
          if (subject.kind === "plan") return full ? "allow" : reject();
          if (subject.kind === "file_change") return "allow";
          const judged = await ctx.approvals.judge(subject, {
            agent,
            session,
            workspace: workspaceOf(row),
            mode: full ? "full" : row.permission_mode,
            context: "unattended",
          });
          if (!judged.ok) return reject();
          if (judged.value.kind === "run") return "allow";
          if (judged.value.kind === "deny") {
            return reject(`denied (${judged.value.denial.message})`);
          }
          return reject();
        },
        async forget(who, input) {
          if (who.actor !== "user") {
            return err({ code: "forbidden", message: "only a person forgets" });
          }
          const rows = ledgerSnapshot(ctx.ledgerPath, (lookup) =>
            lookup.sql
              .all(
                `select id, state_seq from sessions where harness_gui = 1 and lifecycle = 'open'
                   and project = ? and harness = ? and harness_session = ?`,
                [input.project, input.harness, input.cli_session],
              )
              .map((row) => ({
                id: String(row["id"]),
                state_seq: String(row["state_seq"]),
              })),
          );
          if (!rows.ok) return rows;
          for (const row of rows.value) {
            const done = await ctx.writer.command(who, {
              command: archiveSession.name,
              input: { session: row.id, stop_turn: true },
              idempotency_key: ids.newId("idk"),
              compare: { state_seq: row.state_seq },
              prepared: [],
            });
            if (!done.ok) return done;
          }
          return ok(rows.value.length);
        },
        // 탭을 열지 못한 팀원의 queue를 비우고 그 안의 call을 보낸 쪽에 실패로 돌려준다.
        async failQueued(session) {
          const id = session as Id<"ses">;
          for (let head = queue.next(id); head; head = queue.next(id)) {
            queue.take(id, head.message as Id<"msg">);
            if (head.kind !== "call" || head.call === null) continue;
            const done = await command(failHarnessMemberCall.name, {
              session,
              call: head.call,
            });
            if (!done.ok) return done;
          }
          return ok(undefined);
        },
        end: (turn) => turnCredentials.end(turn),
        onQueued(listener) {
          queued.add(listener);
          return () => void queued.delete(listener);
        },
        onTurnClosed(listener) {
          turnClosed.add(listener);
          return () => void turnClosed.delete(listener);
        },
        personTurnStarted(session) {
          for (const listener of personTurns) {
            listener({ kind: "started", session });
          }
        },
        personTurnEnded(session, end, error) {
          for (const listener of personTurns) {
            listener({ kind: "ended", session, end, error });
          }
        },
        onPersonTurn(listener) {
          personTurns.add(listener);
          return () => void personTurns.delete(listener);
        },
      };
      ctx.provide("harnessMembers", {
        ...members,
        isMember(session: string) {
          const known = memberOf.get(session);
          if (known !== undefined) return known;
          const row = ledgerSnapshot(ctx.ledgerPath, (lookup) =>
            loadSession(lookup, session),
          );
          // 새 팀원은 open_member 앞에 표시하므로 여기서 "아니다"를 쥐어도 낡지 않는다. 읽지 못했으면 쥐지 않는다.
          if (!row.ok) return false;
          const member = row.value?.harness_gui === true;
          memberOf.set(session, member);
          return member;
        },
      });

      // 입력을 queue에 넣는 일은 commit 뒤 main thread가 한다(`createQueueApplier`를 harness queue로 쓴다).
      // 같은 afterCommit 묶음의 다른 일(Bus event 등)은 run-loop 쪽 applier가 이미 했으므로 여기서는 거른다.
      const applyQueue = createQueueApplier({
        queue,
        publish: (event) => ctx.bus.publish(event),
      });
      const apply: typeof applyQueue = (actions) => {
        applyQueue(actions);
        for (const action of actions) {
          if (action.topic !== QUEUE_PUT_TOPIC) continue;
          const session = (action.data as { session: string }).session;
          for (const listener of queued) listener(session);
        }
      };
      return ok({
        writer: (inner) =>
          withAfterCommit(
            inner,
            (actions) =>
              apply(
                actions.flatMap((action) =>
                  action.topic === HARNESS_QUEUE_PUT_TOPIC
                    ? [{ ...action, topic: QUEUE_PUT_TOPIC }]
                    : action.topic === QUEUE_CLEAR_TOPIC ||
                        action.topic === QUEUE_WITHDRAW_TOPIC
                      ? [action]
                      : [],
                ),
              ),
            ctx.telemetry.logger,
          ),
      });
    },
    // 꺼졌다 켜지면 queue가 비므로 접수만 된 사람 메시지를 다시 넣는다(run-loop 쪽은 router wiring이 한다).
    // 도는 turn은 router가 먼저 interrupted(restarted)로 닫았다.
    start(ctx) {
      const opened = openConnection(ctx.ledgerPath);
      if (opened.ok) {
        try {
          const sql = opened.value.sql;
          const directory = createSessionDirectory({
            ...workspaceDepsOf(sql),
            publish: () => {},
            sql: () => sql,
          });
          for (const pending of unstartedHumanMessages(sql)) {
            const target = directory.find(pending.session as Id<"ses">);
            if (!target?.accepting || target.transport !== "harness") continue;
            queue.put(pending.session as Id<"ses">, {
              kind: "message",
              from: { kind: "human" },
              call: null,
              reply_to: null,
              // 본문은 headOf가 session 기록에서 읽는다.
              body: [] as ContentBlock[],
              refs: pending.refs,
              delivery: "next_turn",
              message: pending.id as Id<"msg">,
              reply: null,
              outcome: null,
              event: null,
              notice: null,
              step: null,
              unattended: false,
            });
          }
        } finally {
          opened.value.close();
        }
      }
      // turn이 어떻게 끝나든(실행기의 끝냄, 사람의 멈춤, session 끝남) 그 session은 다음 입력을 받을 수 있다.
      unsubscribe = ctx.bus.subscribe([{ types: ["TurnEnded"] }], {
        send(event) {
          if (event.type === "TurnEnded") {
            credentials?.end(event.payload.turn);
            queue.setRunning(event.session as Id<"ses">, false);
            for (const listener of turnClosed) {
              listener({ session: event.session, turn: event.payload.turn });
            }
          }
        },
        close() {},
      });
      return Promise.resolve(ok(undefined));
    },
    closeIntake() {
      unsubscribe?.();
      unsubscribe = undefined;
    },
  };
};
