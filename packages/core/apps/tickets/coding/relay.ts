// main thread 쪽. 메모리 route의 handler, Reactor handler, commit 뒤 일 적용, 켤 때 복구가 모두 writer에
// `ApplyCodingSignal` command를 내는 일이다. session 상태는 writer 쪽 표에 있으므로 여기에는 감지 보고 사본만 둔다.
import { err, ok, type Result } from "../../../../base/mod.ts";
import { parseActor } from "../../../../protocol/base/mod.ts";
import type {
  CodingOptions,
} from "../../../../protocol/coding-agent/harness-id.ts";
import type { HarnessDetection } from "../../../../protocol/coding-agent/harnesses.ts";
import type { CodingTokens } from "../../../../protocol/coding-agent/token.ts";
import { CODING_TOKEN_ENV } from "../../../../protocol/coding-agent/token.ts";
import { codingHook } from "../../../../protocol/coding-agent/hook.ts";
import { codingMessageSend } from "../../../../protocol/coding-agent/message.ts";
import {
  harnessList,
  harnessReport,
} from "../../../../protocol/coding-agent/harness-report.ts";
import { codingSourceDiff } from "../../../../protocol/coding-agent/source-diff.ts";
import {
  codingTerminalExited,
  type CodingTerminalRequest,
  codingTerminalResult,
} from "../../../../protocol/coding-agent/terminal-requests.ts";
import type {
  DomainEvent,
  GatewayServerFrame,
} from "../../../../protocol/events/mod.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import type { ReactorHandler } from "../../../events/mod.ts";
import type { CommitAction } from "../../../storage/ledger/mod.ts";
import { CODING_REVOKE_TOPIC, CODING_TERMINAL_TOPIC } from "./events.ts";
import { harnessList as harnessItems } from "./harnesses.ts";
import type { CodingSignal } from "./signal.ts";
import { type ReleaseSourceReader, sourceDiff } from "./source-diff.ts";

export type SignalResult = { accepted: boolean; app: string | null };

type CodingRelayDeps = {
  // core 안 machine 자격으로 writer에 command를 낸다. 같은 key는 효과가 한 번이다.
  run(signal: CodingSignal, key?: string): Promise<Result<SignalResult>>;
  // session 하나 범위 token의 발급과 회수.
  tokens(): CodingTokens;
  // Settings의 기본 실행 옵션.
  defaults(): CodingOptions;
  // 연결된 shell main에 터미널 요청 frame을 보낸다. 연결이 없으면 unavailable이다.
  send(frame: GatewayServerFrame): Result<void>;
  // 없으면 source diff는 unavailable이다.
  sources(): ReleaseSourceReader | undefined;
};

type Handler = (
  ctx: AuthenticatedContext,
  raw: unknown,
) => Promise<Result<unknown>>;

const bad = (message: string) =>
  err({ code: "invalid_input" as const, message });

export function createCodingRelay(deps: CodingRelayDeps) {
  let detections: HarnessDetection[] = [];

  // 호출한 coding session. token이 정한다.
  function codingSession(ctx: AuthenticatedContext): string | null {
    const actor = parseActor(ctx.actor);
    return actor?.kind === "coding_agent" ? actor.id : null;
  }

  async function signal(
    value: CodingSignal,
    key?: string,
  ): Promise<Result<SignalResult>> {
    return await deps.run(value, key);
  }

  const hook: Handler = async (ctx, raw) => {
    const session = codingSession(ctx);
    if (session === null) {
      return err({ code: "forbidden", message: "only a coding session" });
    }
    const input = codingHook.input.safeParse(raw);
    if (!input.success) return bad("hook input is not valid");
    const done = await signal(
      { kind: "hook", session, ...input.data } as never,
    );
    return done.ok ? ok({ accepted: done.value.accepted }) : done;
  };

  const message: Handler = async (ctx, raw) => {
    const session = codingSession(ctx);
    if (session === null) {
      return err({ code: "forbidden", message: "only a coding session" });
    }
    const input = codingMessageSend.input.safeParse(raw);
    if (!input.success) return bad("message input is not valid");
    const done = await signal({
      kind: "message",
      session,
      body: input.data.body,
      tickets: input.data.refs ?? [],
    } as never);
    return done.ok ? ok({ accepted: true as const }) : done;
  };

  const source: Handler = async (ctx, raw) => {
    const input = codingSourceDiff.input.safeParse(raw);
    if (!input.success) return bad("source diff input is not valid");
    let app: string | null | undefined = input.data.app;
    const session = codingSession(ctx);
    if (session !== null) {
      // coding agent는 token이 정한 앱만 본다.
      const found = await signal({ kind: "app_of", session } as never);
      if (!found.ok) return found;
      app = found.value.app;
    } else if (app !== undefined && ctx.conditions.app !== app) {
      return err({ code: "forbidden", message: "the app is not yours" });
    }
    if (app === undefined || app === null) {
      return err({ code: "forbidden", message: "the app is unknown" });
    }
    const reader = deps.sources();
    if (reader === undefined) {
      return err({
        code: "unavailable",
        message: "release sources are not readable",
      });
    }
    return await sourceDiff(reader, {
      app,
      from_release: input.data.from_release,
      to_release: input.data.to_release,
    });
  };

  const report: Handler = async (_ctx, raw) => {
    const input = harnessReport.input.safeParse(raw);
    if (!input.success) return bad("harness report is not valid");
    detections = input.data.detections;
    const done = await signal({
      kind: "harnesses",
      detections,
      defaults: deps.defaults(),
    });
    return done.ok ? ok({}) : done;
  };

  const list: Handler = (_ctx, raw) => {
    const input = harnessList.input.safeParse(raw);
    return Promise.resolve(
      input.success
        ? ok({ harnesses: harnessItems(detections) })
        : bad("harness list input is not valid"),
    );
  };

  const result: Handler = async (_ctx, raw) => {
    const input = codingTerminalResult.input.safeParse(raw);
    if (!input.success) return bad("terminal result is not valid");
    const done = await signal({
      kind: "terminal_result",
      request: input.data.request,
      ok: input.data.ok,
    });
    return done.ok ? ok({}) : done;
  };

  const exited: Handler = async (_ctx, raw) => {
    const input = codingTerminalExited.input.safeParse(raw);
    if (!input.success) return bad("terminal exit is not valid");
    const done = await signal({
      kind: "terminal_exited",
      session: input.data.session,
    });
    return done.ok ? ok({}) : done;
  };

  // 같은 (handler 이름, seq)로 두 번 일해도 call은 한 번 닫힌다.
  function closer<
    T extends
      | "TicketCompletionReported"
      | "TicketClaimExpired"
      | "CodingSessionEndedUnreported",
  >(
    type: T,
    fields: (event: Extract<DomainEvent, { type: T }>) => {
      session: string;
      ticket: string;
      app: string;
    },
  ): ReactorHandler<T> {
    return {
      name: `coding.close_call.${type}`,
      async handle(event, context) {
        const key = await context.idempotencyKey("close_call");
        const done = await signal({
          kind: "close_call",
          event: type,
          seq: (event as { seq: string }).seq,
          ...fields(event),
        } as never, key);
        return done.ok ? ok(undefined) : done;
      },
    };
  }

  return {
    // route 이름은 `${resource}/${method}`다.
    handlers: {
      hook,
      message,
      source,
      report,
      list,
      result,
      exited,
    },
    reactor: {
      TicketCompletionReported: closer(
        "TicketCompletionReported",
        (event) => ({
          session: event.payload.session,
          ticket: event.subject,
          app: event.payload.app,
        }),
      ),
      TicketClaimExpired: closer("TicketClaimExpired", (event) => ({
        session: event.payload.session,
        ticket: event.subject,
        app: event.payload.app,
      })),
      CodingSessionEndedUnreported: closer(
        "CodingSessionEndedUnreported",
        (event) => ({
          session: event.subject,
          ticket: event.payload.ticket,
          app: event.payload.app,
        }),
      ),
    },
    // commit 뒤 일 가운데 token 회수와 터미널 요청을 한다. open 요청은 여기서 token을 만들어 plan의 env에 담는다.
    // token을 못 만들거나 frame을 보내지 못하면 터미널이 실패 결과를 낸 것으로 본다.
    apply(actions: readonly CommitAction[]): void {
      const failed = (request: string) =>
        void signal({ kind: "terminal_result", request, ok: false }).then(
          (done) => {
            if (!done.ok) {
              console.error(
                `coding: terminal failure not recorded (${done.error.code})`,
              );
            }
          },
        );
      for (const action of actions) {
        if (action.topic === CODING_REVOKE_TOPIC) {
          const { session } = action.data as { session: string };
          const revoked = deps.tokens().revoke(session);
          if (!revoked.ok) {
            console.error(
              `coding: token revoke failed (${revoked.error.code})`,
            );
          }
          continue;
        }
        if (action.topic !== CODING_TERMINAL_TOPIC) continue;
        let request = action.data as CodingTerminalRequest;
        if (request.kind === "open") {
          const { session, app } = request.plan;
          const issued = deps.tokens().issue({ session, app } as never);
          if (!issued.ok) {
            console.error(`coding: token issue failed (${issued.error.code})`);
            failed(request.request);
            continue;
          }
          request = {
            ...request,
            plan: {
              ...request.plan,
              env: {
                ...request.plan.env,
                [CODING_TOKEN_ENV]: issued.value.token,
              },
            },
          };
        }
        if (!deps.send({ type: "coding_terminal", request }).ok) {
          failed(request.request);
        }
      }
    },
    // 켤 때 한 번과 감지 보고가 없을 때의 기본값 전달이다.
    async recover(): Promise<Result<void>> {
      const done = await signal({ kind: "recover" });
      if (!done.ok) return done;
      const synced = await signal({
        kind: "harnesses",
        detections,
        defaults: deps.defaults(),
      });
      return synced.ok ? ok(undefined) : synced;
    },
  };
}
