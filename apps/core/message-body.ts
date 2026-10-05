// 메시지 본문의 core 쪽 길(lophn-agent/conversation, plan Q29). 호출자(shell·runtime)는
// blob을 준비하지 않고 본문 값을 요청에 싣는다. core가 command 앞에서 값을 redaction해
// 정규 직렬화 bytes로 blob을 준비하고, command가 같은 transaction에서 영구 참조를
// 등록한다. 읽기는 ledger 참조 행을 snapshot에서 판정한 뒤 blob 바이트를 읽는다.
import {
  err,
  type LophnError,
  ok,
  type Result,
  sha256Hex,
} from "../../packages/base/mod.ts";
import {
  agentMessageContentInputSchema,
  MESSAGE_CONTENT_MAX_BYTES,
  MESSAGE_CONTENT_PURPOSE,
  MESSAGE_TEXT_CONTENT_MAX_BYTES,
  receiveMessage,
  recordMessage,
  serializeMessageContent,
  userMessageContentInputSchema,
} from "../../packages/contracts/lophn-agent/mod.ts";
import {
  type AuthenticatedContext,
  parseActor,
} from "../../packages/contracts/platform/mod.ts";
import {
  type CommandEnvelope,
  openConnection,
  type Writer,
} from "../../packages/platform/ledger/mod.ts";
import type { MessageBodyEnvironment } from "../../packages/lophn-agent/conversation/mod.ts";
import { createProductRedactor } from "./documents-redactor.ts";
import type { PreparedRelayResult } from "./blob-prepare.ts";

export type BodyPrepare = {
  // 같은 주체·purpose·hash의 살아 있는 준비가 이미 있는지.
  live(prepared: { hash: string; principal: string; purpose: string }): boolean;
  prepare(call: {
    principal: string;
    purpose: string;
    expectedHash?: string;
    bytes: ReadableStream<Uint8Array>;
  }): Promise<Result<PreparedRelayResult>>;
};

const redactText = createProductRedactor();
const SOURCE = {
  concern: "lophn-agent/conversation",
  revision: "1",
  scope: "message-body",
};

// 문자열 값만 redaction한다(키·구조는 그대로). 안전화를 끝내지 못하면 null이다.
function redactValue(value: unknown): { value: unknown } | null {
  if (typeof value === "string") {
    const redacted = redactText(SOURCE, "text/plain", value);
    return redacted === null ? null : { value: redacted };
  }
  if (Array.isArray(value)) {
    const items: unknown[] = [];
    for (const item of value) {
      const one = redactValue(item);
      if (one === null) return null;
      items.push(one.value);
    }
    return { value: items };
  }
  if (value !== null && typeof value === "object") {
    const entries: [string, unknown][] = [];
    for (const [key, item] of Object.entries(value)) {
      const one = redactValue(item);
      if (one === null) return null;
      entries.push([key, one.value]);
    }
    return { value: Object.fromEntries(entries) };
  }
  return { value };
}

function rejected(code: LophnError["code"], message: string): Result<never> {
  return err({ code, message });
}

// 본문을 싣는 command의 앞 단계. 값은 redaction을 거친 값으로 바뀌어 writer에 가고,
// 그 바이트는 보낸 자격의 이름으로 준비되어 있다. 다른 command는 그대로 지나간다.
export function createMessageBodyPreparer(deps: {
  // 준비 통로. I/O worker가 뜨기 전에는 없다(unavailable).
  relay(): BodyPrepare | undefined;
}): (
  ctx: AuthenticatedContext,
  envelope: CommandEnvelope,
) => Promise<Result<CommandEnvelope>> {
  return async (ctx, envelope) => {
    if (
      envelope.command !== receiveMessage.name &&
      envelope.command !== recordMessage.name
    ) return ok(envelope);
    const kind = parseActor(ctx.actor)?.kind;
    const record = envelope.input as { content?: unknown };
    // 사람과 machine은 글만, agent는 글과 시각 블록이다(MessageContent).
    const schema = kind === "agent"
      ? agentMessageContentInputSchema
      : userMessageContentInputSchema;
    const max = kind === "agent"
      ? MESSAGE_CONTENT_MAX_BYTES
      : MESSAGE_TEXT_CONTENT_MAX_BYTES;
    const redacted = redactValue(record.content);
    if (redacted === null) {
      return rejected("unavailable", "message redaction did not finish");
    }
    // redaction 뒤 값이 다시 계약 안인지 본다. 대체 문구가 길어 상한을 넘을 수 있다.
    const checked = schema.safeParse(redacted.value);
    if (!checked.success) {
      return rejected("invalid_input", "message content is not valid");
    }
    const bytes = serializeMessageContent(checked.data);
    if (bytes.length > max) {
      return rejected("invalid_input", "message content is too large");
    }
    const relay = deps.relay();
    if (relay === undefined) {
      return rejected("unavailable", "blob preparation is not available");
    }
    const hash = await sha256Hex(bytes);
    const key = {
      hash,
      principal: ctx.principal,
      purpose: MESSAGE_CONTENT_PURPOSE,
    };
    // 같은 값을 다시 보낸 재전송은 이미 살아 있는 준비를 쓴다.
    if (!relay.live(key)) {
      const prepared = await relay.prepare({
        principal: ctx.principal,
        purpose: MESSAGE_CONTENT_PURPOSE,
        expectedHash: hash,
        bytes: new ReadableStream({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        }),
      });
      // 같은 값의 동시 요청이 먼저 준비를 마쳤으면 그 준비를 쓴다.
      if (!prepared.ok && !relay.live(key)) {
        return rejected(
          prepared.error.code === "invalid_input" ? "invalid_input" : "unavailable",
          "message body could not be prepared",
        );
      }
    }
    return ok({
      ...envelope,
      input: { ...record, content: checked.data },
    });
  };
}

// writer.command 앞에 본문 준비를 끼운다. 나머지 Writer 동작은 그대로다.
export function withMessageBody(
  writer: Writer,
  prepare: ReturnType<typeof createMessageBodyPreparer>,
): Writer {
  return {
    ...writer,
    async command(ctx, envelope) {
      const ready = await prepare(ctx, envelope);
      if (!ready.ok) return ready;
      return await writer.command(ctx, ready.value);
    },
  };
}

// ReadMessageBody가 core 안에서 읽는 통로. 참조 행은 ledger를 읽기 전용 connection으로
// 짧게 열어 읽고, 바이트는 blob 읽기 통로로 받는다.
export function messageBodyEnvironment(input: {
  ledgerPath: string;
  read: MessageBodyEnvironment["bytes"];
}): MessageBodyEnvironment {
  return {
    snapshot(read) {
      const opened = openConnection(input.ledgerPath);
      if (!opened.ok) return opened;
      try {
        const head = opened.value.sql.get(
          "select coalesce(max(seq), 0) as seq from events",
          [],
        );
        return read(opened.value.sql, String(head?.["seq"] ?? 0));
      } catch {
        return err({ code: "unavailable", message: "message를 읽지 못했다" });
      } finally {
        opened.value.close();
      }
    },
    bytes: (hash, offset, length) => input.read(hash, offset, length),
  };
}
