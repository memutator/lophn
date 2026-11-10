import { textBlocks } from "../../../../protocol/lophn-agent/content-block.ts";
import { createIdSource, err, ok, type Result } from "../../../../base/mod.ts";
import type { Id } from "../../../../protocol/base/ids.ts";
import {
  type AgentAddress,
  type AgentAtWorkspace,
  messageBody,
  workspaceSessionOpen,
  workspaceSessionRead,
  receivedMessageList,
  receivedMessageRead,
  sendMessage,
  stopTurn,
  turnRead,
} from "../../../../protocol/lophn-agent/mod.ts";
import {
  type RunRecord,
  runCancel,
  runCreate,
  runList,
  runRead,
  runSettle,
  runStart,
  runWait,
} from "../../../../protocol/runs/mod.ts";
import type {
  AuthenticatedContext,
  Input,
  Output,
} from "../../../../protocol/server/mod.ts";
import {
  createSessionDirectory,
  workspaceDepsOf,
} from "../../../lophn-agent/workspaces/mod.ts";
import { messageRemoveQueued } from "../../../lophn-agent/session/mod.ts";
import { ledgerSnapshot } from "../../../lophn-agent/session/rewind/files.ts";
import {
  createRunService,
  type RunOrigin,
  systemTimers,
} from "../../../runs/mod.ts";
import type { MemoryHandler } from "../../../server/mod.ts";
import type { WiringFactory } from "./context.ts";
import { turnAnswer } from "./turn-answer.ts";

// run이 사람 입력으로 session을 열고 메시지를 넣고 읽는 core 안 자격이다. 사람 메시지를 넣는 route는 user만
// 받는다(annotation 전달과 같은 꼴). 기동 때 ledger에 기록한다.
const RUNS_PRINCIPAL = "machine:runs";
const RUNS_CONTEXT: AuthenticatedContext = {
  principal: RUNS_PRINCIPAL,
  actor: "user",
  scope: {
    operations: [
      workspaceSessionOpen.name,
      sendMessage.name,
      stopTurn.name,
      workspaceSessionRead.name,
      receivedMessageRead.name,
      receivedMessageList.name,
      turnRead.name,
      messageBody.name,
      runRead.name,
      runList.name,
    ],
    targets: {},
  },
  conditions: {},
  credential_ref: RUNS_PRINCIPAL,
};

// run 기록을 만들고 끝내고 queue에서 메시지를 빼는 core 안 machine 자격이다. 기동 때 ledger에 기록한다.
const RUNS_SETTLE_PRINCIPAL = "machine:runs-settle";
const RUNS_SETTLE_CONTEXT: AuthenticatedContext = {
  principal: RUNS_SETTLE_PRINCIPAL,
  actor: "machine",
  scope: {
    operations: [runCreate.name, runSettle.name, messageRemoveQueued.name],
    targets: {},
  },
  conditions: {},
  credential_ref: RUNS_SETTLE_PRINCIPAL,
};

const route = (r: { resource: string; method: string }) =>
  `${r.resource}/${r.method}`;

// 규칙은 runs module의 service가 갖는다. 여기는 port를 core에 잇기만 한다.
export const runsWiring: WiringFactory = () => {
  let unsubscribe: (() => void) | undefined;
  let service: ReturnType<typeof createRunService> | undefined;
  return {
    name: "runs",
    records: () => [RUNS_CONTEXT, RUNS_SETTLE_CONTEXT],
    build(ctx) {
      const ids = createIdSource({ clock: ctx.clock, random: ctx.random });
      // 접은 writer를 쓴다. 날 writer는 본문 준비와 queue 적용을 건너뛰어 turn이 열리지 않는다.
      // ctx.writer는 build가 다 끝난 뒤 채워지므로 부를 때 읽는다.
      const command = async <T>(
        who: AuthenticatedContext,
        r: { name: string },
        input: unknown,
        compare: unknown = {},
      ): Promise<Result<T>> => {
        const done = await ctx.writer.command(who, {
          command: r.name,
          input,
          idempotency_key: ids.newId("idk"),
          compare,
          prepared: [],
        });
        return done.ok ? ok(done.value.result as T) : done;
      };
      // pool read와 pool 밖 read(ReadMessageBody)가 같은 길이다.
      const read = async <T>(
        r: { resource: string; method: string },
        input: unknown,
      ): Promise<Result<T>> =>
        (await ctx.runtime.reads.get(route(r))!(
          RUNS_CONTEXT,
          input,
        )) as Result<T>;

      const readTurn = (turn: Id<"trn">) =>
        read<Output<typeof turnRead>>(turnRead, { turn });

      const agents = {
        // Router와 같은 주소 풀기다.
        resolve(address: AgentAddress) {
          const found = ledgerSnapshot(ctx.ledgerPath, (lookup) => {
            return createSessionDirectory({
              ...workspaceDepsOf(lookup.sql),
              publish: () => {},
              sql: () => lookup.sql,
            }).resolveAddress(address);
          });
          return Promise.resolve(found.ok ? found.value : found);
        },
        async agentOf(session: Id<"ses">) {
          const found = await read<Output<typeof workspaceSessionRead>>(
            workspaceSessionRead,
            { session },
          );
          if (!found.ok) return found;
          const s = found.value.session;
          if (s.lifecycle !== "open") {
            return err({
              code: "conflict" as const,
              message: "the session is not open",
            });
          }
          return ok({
            agent: s.agent,
            workspace: s.workspace,
          });
        },
        async open(agent: AgentAtWorkspace, session: Id<"ses">) {
          const opened = await command(RUNS_CONTEXT, workspaceSessionOpen, {
            id: session,
            agent: agent.agent,
            workspace: agent.workspace,
          });
          return opened.ok ? ok(undefined) : opened;
        },
        async send(session: Id<"ses">, message: Id<"msg">, text: string) {
          const sent = await command(RUNS_CONTEXT, sendMessage, {
            id: message,
            session,
            content: textBlocks(text),
            delivery: "next_turn",
            refs: [],
            unattended: true,
          });
          return sent.ok ? ok(undefined) : sent;
        },
        async turnOf(message: Id<"msg">) {
          const found = await read<Output<typeof receivedMessageRead>>(
            receivedMessageRead,
            { message },
          );
          // 취소로 지워진 메시지는 turn이 없다.
          if (!found.ok) {
            return found.error.code === "not_found" ? ok(null) : found;
          }
          const turn = found.value.message.turn;
          if (turn === null) return ok(null);
          const record = await readTurn(turn as Id<"trn">);
          if (!record.ok) return record;
          const { state, outcome } = record.value.turn;
          return ok({ turn: turn as Id<"trn">, state, outcome });
        },
        answer: (session: Id<"ses">, turn: Id<"trn">) =>
          turnAnswer(read, session, turn),
        // turn을 닫은 TurnEnded가 agent runtime의 구독으로 child에 turn_stop을 보낸다.
        // state_seq가 checkpoint로 움직여 compare가 어긋나면 다시 읽어 건다.
        async stop(turn: Id<"trn">) {
          for (let attempt = 0; ; attempt++) {
            const record = await readTurn(turn);
            if (!record.ok) return record;
            if (record.value.turn.state !== "running") return ok(undefined);
            const stopped = await command(
              RUNS_CONTEXT,
              stopTurn,
              { turn, request_key: `run:${turn}`, reason: "user_stopped" },
              { state_seq: record.value.turn.state_seq },
            );
            if (stopped.ok) return ok(undefined);
            if (stopped.error.code !== "conflict" || attempt >= 2) {
              return stopped;
            }
          }
        },
        // 기록을 먼저 지운다. 이미 가져간 메시지는 거기서 conflict로 막힌다.
        async unqueue(session: Id<"ses">, message: Id<"msg">) {
          const removed = await command(
            RUNS_SETTLE_CONTEXT,
            messageRemoveQueued,
            { session, message },
          );
          if (!removed.ok) return removed;
          ctx.queue.remove(session, message);
          return ok(undefined);
        },
      };

      const tools = {
        resolveApp(app: string) {
          const found = ledgerSnapshot(ctx.ledgerPath, (lookup) =>
            workspaceDepsOf(lookup.sql).apps.appByName(app),
          );
          if (!found.ok) return Promise.resolve(found);
          const resolved = found.value;
          return Promise.resolve(
            resolved.ok ? ok(resolved.value.id as Id<"app">) : resolved,
          );
        },
        // 사람이 부른 것과 같은 길이다. Gate를 거치지 않는다.
        call: (
          run: Id<"run">,
          app: Id<"app">,
          tool: string,
          input: Parameters<typeof ctx.appCallPath.call>[0]["input"],
          origin?: RunOrigin,
        ) => {
          const call = {
            target: { mode: "live", app, release: null },
            kind: "command",
            name: tool,
            ...(input === undefined ? {} : { input }),
          } as const;
          if (origin !== undefined && "instance" in origin) {
            return ctx.appCallPath.call(
              {
                ...call,
                caller: { kind: "flow", instance: origin.instance },
              },
              {
                actor: "flow",
                flow: {
                  instance: origin.instance,
                  agent: origin.creator.agent,
                  workspace: origin.creator.workspace,
                },
              },
            );
          }
          // job이 연 run은 program caller로, instance가 연 run은 flow caller로 부른다.
          // flow 자격의 agent·workspace는 instance의 project workspace session이다.
          return origin === undefined
            ? ctx.appCallPath.call(
                { ...call, caller: { kind: "person", view_session: run } },
                { actor: "user" },
              )
            : ctx.appCallPath.call(
                {
                  ...call,
                  caller: {
                    kind: "program",
                    job: origin.job,
                    job_run: origin.job_run,
                  },
                },
                {
                  actor: "program",
                  program: { job: origin.job, job_run: origin.job_run },
                },
              );
        },
      };

      const store = {
        async create(input: Input<typeof runCreate>) {
          const done = await command<{ run: RunRecord }>(
            RUNS_SETTLE_CONTEXT,
            runCreate,
            input,
          );
          return done.ok ? ok(done.value.run) : done;
        },
        async settle(input: Input<typeof runSettle>) {
          const done = await command<{ run: RunRecord }>(
            RUNS_SETTLE_CONTEXT,
            runSettle,
            input,
            { state: "running" },
          );
          return done.ok ? ok(done.value.run) : done;
        },
        async read(run: Id<"run">) {
          const done = await read<Output<typeof runRead>>(runRead, { run });
          return done.ok ? ok(done.value.run) : done;
        },
        async running() {
          const runs: RunRecord[] = [];
          let cursor: string | undefined;
          for (;;) {
            const page = await read<Output<typeof runList>>(runList, {
              state: "running",
              ...(cursor === undefined ? {} : { cursor }),
            });
            if (!page.ok) return page;
            runs.push(...page.value.runs);
            const next = page.value.next_cursor;
            if (next === null || next === undefined) return ok(runs);
            cursor = next;
          }
        },
      };

      const built = createRunService({
        agents,
        tools,
        store,
        ids,
        timers: systemTimers,
      });
      service = built;
      ctx.provide("runService", built);
      const handler =
        (call: (input: never) => Promise<Result<RunRecord>>): MemoryHandler =>
        async (_who, input) => {
          const done = await call(input as never);
          return done.ok ? ok({ run: done.value }) : done;
        };
      return ok({
        memory: [
          [route(runStart), handler((i) => built.start(i))],
          [
            route(runWait),
            handler((i: { run: Id<"run">; timeout_ms: number }) =>
              built.wait(i.run, i.timeout_ms),
            ),
          ],
          [
            route(runCancel),
            handler((i: { run: Id<"run"> }) => built.cancel(i.run)),
          ],
        ],
      });
    },
    // 먼저 구독하고 reconcile한다. 그 사이에 끝난 turn을 놓치지 않는다. 같은 run을 둘이 settle해도
    // SettleRun의 compare가 하나만 받는다. router의 start(켤 때 돌던 turn 닫기) 뒤에 돌아야 한다.
    async start(ctx) {
      unsubscribe = ctx.bus.subscribe(
        [{ types: ["TurnEnded", "SessionEnded"] }],
        {
          send(event) {
            if (event.type === "TurnEnded") {
              void service!.turnEnded({
                turn: event.payload.turn,
                messages: event.payload.messages,
              });
            } else if (
              event.type === "SessionEnded" &&
              (event.payload.reason === "archived" ||
                event.payload.reason === "deleted")
            ) {
              void service!.sessionEnded(event.session);
            }
          },
          close() {},
        },
      );
      try {
        await service!.reconcile();
      } catch (e) {
        ctx.telemetry.logger.error({
          component: "runs",
          event: "reconcile_failed",
          fields: { error: String(e) },
        });
      }
      return ok(undefined);
    },
    // server.stop이 받은 요청을 기다리므로 걸린 WaitRun을 풀어 종료를 늦추지 않는다.
    async closeIntake() {
      unsubscribe?.();
      await service?.close();
    },
  };
};
