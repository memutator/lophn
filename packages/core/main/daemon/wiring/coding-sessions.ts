import { ok, type Result } from "../../../../base/mod.ts";
import { createProductRedactor } from "../../../../base/redaction/mod.ts";
import { codingHook } from "../../../../protocol/coding-agent/hook.ts";
import {
  harnessList,
  harnessReport,
} from "../../../../protocol/coding-agent/harness-report.ts";
import { codingMessageSend } from "../../../../protocol/coding-agent/message.ts";
import { CODING_MCP_PATH } from "../../../../protocol/coding-agent/mcp.ts";
import {
  codingTerminalExited,
  codingTerminalResult,
} from "../../../../protocol/coding-agent/terminal-requests.ts";
import {
  MESSAGE_CONTENT_MAX_BYTES,
  MESSAGE_CONTENT_PURPOSE,
  serializeMessageContent,
} from "../../../../protocol/lophn-agent/mod.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import { createCodingTokens } from "../../../server/identity/mod.ts";
import {
  CODING_REACTION_TEXTS,
  codingDefaultHarness,
  codingDefaultModel,
  type CodingSignal,
  codingSignal,
  createCodingRelay,
  type SignalResult,
} from "../../../apps/coding/mod.ts";
import {
  prepareBytes,
  rejected,
} from "../../../lophn-agent/session/message-body.ts";
import type { BodyPrepare } from "../../../lophn-agent/session/message-body.ts";
import {
  type CommandEnvelope,
  type KnownSecretMatch,
  withAfterCommit,
  type Writer,
} from "../../../storage/ledger/mod.ts";
import type { WiringFactory } from "./context.ts";

// 메모리 route가 받은 일을 writer에 내는 core 안 machine 자격이다. 기록이 없으면 writer가 거절한다.
const CODING_PRINCIPAL = "machine:coding-sessions";
const CODING_CONTEXT: AuthenticatedContext = {
  principal: CODING_PRINCIPAL,
  actor: "machine",
  scope: { operations: [codingSignal.name], targets: {} },
  conditions: {},
  credential_ref: CODING_PRINCIPAL,
};

const SOURCE = {
  concern: "coding-agent/sessions",
  revision: "1",
  scope: "message-body",
};

// call을 닫으며 맡긴 App Engineer에게 가는 입력의 고정 문구다.
const CLOSING_KINDS = new Set(["terminal_result", "terminal_exited"]);

function textBytes(text: string): Uint8Array {
  return serializeMessageContent({
    schema_version: 1,
    parts: [{ kind: "text", text }],
  });
}

// 받는 session 기록은 글을 blob으로 둔다. command 안에서 쓰는 글은 그 command를 부른 자격의 이름으로 미리
// 준비돼 있어야 한다. coding agent의 메시지 본문은 redaction을 거친 값으로 바꿔 보낸다.
function withCodingBody(
  writer: Writer,
  deps: {
    relay(): BodyPrepare | undefined;
    known(): KnownSecretMatch | undefined;
  },
): Writer {
  return {
    ...writer,
    async command(ctx, envelope) {
      if (envelope.command !== codingSignal.name) {
        return await writer.command(ctx, envelope);
      }
      const input = envelope.input as CodingSignal;
      const texts: string[] = [];
      let next: CommandEnvelope = envelope;
      if (input.kind === "message") {
        const safe = createProductRedactor(deps.known())(
          SOURCE,
          "text/plain",
          input.body,
        );
        if (safe === null) {
          return rejected("unavailable", "message redaction did not finish");
        }
        texts.push(safe);
        next = { ...envelope, input: { ...input, body: safe } };
      } else if (CLOSING_KINDS.has(input.kind)) {
        texts.push(...Object.values(CODING_REACTION_TEXTS));
      } else return await writer.command(ctx, envelope);
      const relay = deps.relay();
      if (relay === undefined) {
        return rejected("unavailable", "blob preparation is not available");
      }
      for (const text of new Set(texts)) {
        const bytes = textBytes(text);
        if (bytes.length > MESSAGE_CONTENT_MAX_BYTES) {
          return rejected("invalid_input", "message is too large");
        }
        const prepared = await prepareBytes(
          relay,
          ctx,
          MESSAGE_CONTENT_PURPOSE,
          bytes,
          "coding text",
        );
        if (!prepared.ok) return prepared;
      }
      return await writer.command(ctx, next);
    },
  };
}

const key = (route: { resource: string; method: string }) =>
  `${route.resource}/${route.method}`;

export const codingSessionsWiring: WiringFactory = () => {
  let recover: (() => Promise<Result<void>>) | undefined;
  return {
    name: "coding-sessions",
    operations: () => [{
      name: codingSignal.name,
      actors: ["machine"],
      kind: "command",
    }],
    records: () => [CODING_CONTEXT],
    build(ctx) {
      // registry는 마지막 wiring이 열므로 처음 쓸 때 만든다.
      let tokens: ReturnType<typeof createCodingTokens> | undefined;
      const relay = createCodingRelay({
        tokens: () => tokens ??= createCodingTokens({ registry: ctx.registry }),
        async run(signal) {
          const done = await ctx.writer.command(CODING_CONTEXT, {
            command: codingSignal.name,
            input: signal,
            idempotency_key: crypto.randomUUID(),
            compare: {},
            prepared: [],
          });
          return done.ok ? ok(done.value.result as SignalResult) : done;
        },
        // 값이 없는 칸은 싣지 않는다. 정규 JSON은 undefined를 받지 않는다.
        defaults() {
          const settings = ctx.peek.settings;
          const harness = settings?.get(codingDefaultHarness) ?? undefined;
          const model = settings?.get(codingDefaultModel) ?? undefined;
          return {
            ...(harness === undefined ? {} : { harness }),
            ...(model === undefined ? {} : { model }),
          };
        },
        // 발급한 token의 자격을 ledger에 기록한다.
        async record(credential_ref) {
          const current = ctx.registry.revalidate({ credential_ref });
          return current.ok ? await ctx.runtime.record(current.value) : current;
        },
        send: (frame) => ctx.gateway.send(frame),
        // server는 relay보다 늦게 열리므로 부를 때 읽는다.
        mcpUrl() {
          const port = ctx.peek.server?.port ?? 0;
          return port === 0
            ? null
            : `http://127.0.0.1:${port}${CODING_MCP_PATH}`;
        },
      });
      recover = relay.recover;
      const { handlers } = relay;
      return ok({
        writer: (inner) =>
          withCodingBody(withAfterCommit(inner, relay.apply), {
            relay: () => ctx.peek.bodyPrepare,
            known: () => ctx.peek.knownSecrets,
          }),
        memory: [
          [key(codingHook), handlers.hook],
          [key(codingMessageSend), handlers.message],
          [key(harnessReport), handlers.report],
          [key(harnessList), handlers.list],
          [key(codingTerminalResult), handlers.result],
          [key(codingTerminalExited), handlers.exited],
        ],
      });
    },
    // 켤 때 한 번. 살아 있는 session이 없으므로 끝나지 않은 session 행을 끝낸 것으로 둔다.
    async start() {
      const done = await recover?.();
      if (done !== undefined && !done.ok) {
        console.error(`coding sessions: recover failed (${done.error.code})`);
      }
      return ok(undefined);
    },
  };
};
