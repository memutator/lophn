// main thread 쪽. 메모리 route의 handler, commit 뒤 일 적용, 켤 때 복구가 모두 writer에
// `ApplyCodingSignal` command를 내는 일이다. session 상태는 writer 쪽 표에 있으므로 여기에는 감지 보고 사본만 둔다.
import { err, ok, type Result } from "../../../base/mod.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import type { CodingOptions } from "../../../protocol/coding-agent/harness-id.ts";
import type { HarnessDetection } from "../../../protocol/coding-agent/harnesses.ts";
import type { CodingTokens } from "../../../protocol/coding-agent/token.ts";
import { CODING_TOKEN_ENV } from "../../../protocol/coding-agent/token.ts";
import { withCodingMcp } from "../../../protocol/coding-agent/mcp-launch.ts";
import { codingMessageSend } from "../../../protocol/coding-agent/message.ts";
import {
  harnessList,
  harnessReport,
} from "../../../protocol/coding-agent/harness-report.ts";
import {
  codingTerminalExited,
  codingTerminalHook,
  type CodingTerminalRequest,
  codingTerminalResult,
} from "../../../protocol/coding-agent/terminal-requests.ts";
import type { GatewayServerFrame } from "../../../protocol/events/mod.ts";
import type { AuthenticatedContext } from "../../../protocol/server/mod.ts";
import type { CommitAction } from "../../storage/ledger/mod.ts";
import { CODING_REVOKE_TOPIC, CODING_TERMINAL_TOPIC } from "./events.ts";
import { harnessList as harnessItems } from "./harnesses.ts";
import type { CodingSignal } from "./signal.ts";

export type SignalResult = { accepted: boolean };

type CodingRelayDeps = {
  // core 안 machine 자격으로 writer에 command를 낸다.
  run(signal: CodingSignal): Promise<Result<SignalResult>>;
  // session 하나 범위 token의 발급과 회수.
  tokens(): CodingTokens;
  // Settings의 기본 실행 옵션.
  defaults(): CodingOptions;
  // 발급한 token의 자격을 ledger에 기록한다. 기록이 없으면 writer가 그 token의 command를 거절한다.
  record(credentialRef: string): Promise<Result<void>>;
  // 연결된 shell main에 터미널 요청 frame을 보낸다. 연결이 없으면 unavailable이다.
  send(frame: GatewayServerFrame): Result<void>;
  // coding agent가 쓸 MCP endpoint url이다. server가 열리기 전이면 null이라 MCP 없이 띄운다.
  mcpUrl(): string | null;
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

  async function signal(value: CodingSignal): Promise<Result<SignalResult>> {
    return await deps.run(value);
  }

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
    } as never);
    return done.ok ? ok({ accepted: true as const }) : done;
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

  // shell main이 터미널의 hook socket에서 받아 넘긴 harness hook이다. session은 shell main이 터미널로 정한다.
  const hook: Handler = async (_ctx, raw) => {
    const input = codingTerminalHook.input.safeParse(raw);
    if (!input.success) return bad("terminal hook is not valid");
    const done = await signal({ kind: "hook", ...input.data });
    return done.ok ? ok({ accepted: done.value.accepted }) : done;
  };

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

  // open 요청에 token을 만들어 plan의 env에 담아 보낸다. token의 자격은 ledger에 기록한 뒤에야 쓸 수 있다.
  async function open(
    request: Extract<CodingTerminalRequest, { kind: "open" }>,
  ): Promise<void> {
    const { session, app } = request.plan;
    const issued = deps.tokens().issue({ session, app } as never);
    if (!issued.ok) {
      console.error(`coding: token issue failed (${issued.error.code})`);
      failed(request.request);
      return;
    }
    const recorded = await deps.record(issued.value.credential_ref);
    if (!recorded.ok) {
      console.error(`coding: token record failed (${recorded.error.code})`);
      failed(request.request);
      return;
    }
    let plan: typeof request.plan = {
      ...request.plan,
      env: { ...request.plan.env, [CODING_TOKEN_ENV]: issued.value.token },
    };
    const url = deps.mcpUrl();
    if (url !== null) {
      const withMcp = withCodingMcp(plan, url);
      if (!withMcp.ok) {
        console.error(`coding: mcp config failed (${withMcp.error.code})`);
        failed(request.request);
        return;
      }
      plan = withMcp.value;
    }
    const sent = deps.send({
      type: "coding_terminal",
      request: { ...request, plan },
    });
    if (!sent.ok) failed(request.request);
  }

  return {
    // route 이름은 `${resource}/${method}`다.
    handlers: {
      hook,
      message,
      report,
      list,
      result,
      exited,
    },
    // commit 뒤 일 가운데 token 회수와 터미널 요청을 한다. open 요청은 여기서 token을 만들어 plan의 env에 담는다.
    // token을 못 만들거나 frame을 보내지 못하면 터미널이 실패 결과를 낸 것으로 본다.
    apply(actions: readonly CommitAction[]): void {
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
        const request = action.data as CodingTerminalRequest;
        if (request.kind === "open") {
          void open(request);
          continue;
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
