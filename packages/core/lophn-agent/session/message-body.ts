// 메시지 본문의 core 쪽 길(lophn-agent/conversation). 호출자(shell·runtime)는
// blob을 준비하지 않고 본문 값을 요청에 싣는다. core가 command 앞에서 값을 redaction해
// 정규 직렬화 bytes로 blob을 준비하고, command가 같은 transaction에서 영구 참조를
// 등록한다. 읽기는 ledger 참조 행을 snapshot에서 판정한 뒤 blob 바이트를 읽는다.
import {
  err,
  type LophnError,
  ok,
  type Result,
  sha256Hex,
} from "../../../base/mod.ts";
import {
  agentMessageContentInputSchema,
  machineMessageContentInputSchema,
  MESSAGE_CONTENT_MAX_BYTES,
  MESSAGE_CONTENT_PURPOSE,
  MESSAGE_TEXT_CONTENT_MAX_BYTES,
  receiveMessage,
  recordMessage,
  sendMessage,
  serializeMessageContent,
  userMessageContentInputSchema,
} from "../../../protocol/lophn-agent/mod.ts";
import type { AuthenticatedContext } from "../../../protocol/server/mod.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import {
  type CommandEnvelope,
  openConnection,
  type Writer,
} from "../../storage/ledger/mod.ts";
import type { MessageBodyEnvironment } from "./mod.ts";
import type { KnownSecretMatch } from "../../storage/ledger/mod.ts";
import {
  createProductRedactor,
  type TextRedactor,
} from "../../../base/redaction/mod.ts";
import type { PreparedRelayResult } from "../../storage/blobs/prepare-relay.ts";

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

const SOURCE = {
  concern: "lophn-agent/conversation",
  revision: "1",
  scope: "message-body",
};

// 문자열 값만 redaction한다(키·구조는 그대로). 안전화를 끝내지 못하면 null이다.
function redactValue(
  redactText: TextRedactor,
  value: unknown,
): { value: unknown } | null {
  if (typeof value === "string") {
    const redacted = redactText(SOURCE, "text/plain", value);
    return redacted === null ? null : { value: redacted };
  }
  if (Array.isArray(value)) {
    const items: unknown[] = [];
    for (const item of value) {
      const one = redactValue(redactText, item);
      if (one === null) return null;
      items.push(one.value);
    }
    return { value: items };
  }
  if (value !== null && typeof value === "object") {
    const entries: [string, unknown][] = [];
    for (const [key, item] of Object.entries(value)) {
      const one = redactValue(redactText, item);
      if (one === null) return null;
      entries.push([key, one.value]);
    }
    return { value: Object.fromEntries(entries) };
  }
  return { value };
}

export function rejected(
  code: LophnError["code"],
  message: string,
): Result<never> {
  return err({ code, message });
}

// 같은 주체·purpose·hash의 살아 있는 준비가 없으면 그 바이트를 준비한다. 같은 값을 다시
// 보낸 재전송과 같은 값의 동시 요청은 이미 살아 있는 준비를 쓴다. 준비한 바이트의 hash를
// 돌려준다(command가 같은 값에서 같은 hash를 다시 만든다).
export async function prepareBytes(
  relay: BodyPrepare,
  ctx: AuthenticatedContext,
  purpose: string,
  bytes: Uint8Array,
  what: string,
): Promise<Result<string>> {
  const hash = await sha256Hex(bytes);
  const key = { hash, principal: ctx.principal, purpose };
  if (!relay.live(key)) {
    const prepared = await relay.prepare({
      principal: ctx.principal,
      purpose,
      expectedHash: hash,
      bytes: new ReadableStream({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
    });
    if (!prepared.ok && !relay.live(key)) {
      return rejected(
        prepared.error.code === "invalid_input"
          ? "invalid_input"
          : "unavailable",
        `${what} could not be prepared`,
      );
    }
  }
  return ok(hash);
}

// 본문을 싣는 command의 앞 단계. 값은 redaction을 거친 값으로 바뀌어 writer에 가고,
// 그 바이트는 보낸 자격의 이름으로 준비되어 있다. 다른 command는 그대로 지나간다.
export function createMessageBodyPreparer(deps: {
  // 준비 통로. I/O worker가 뜨기 전에는 없다(unavailable).
  relay(): BodyPrepare | undefined;
  // 알려진 secret 값의 matcher(core 프로세스의 secret store). pattern 규칙에 더해 그 값도
  // 가린다. 값을 아직 다 모르는 동안(matcher가 ready가 아님)은 안전화를 끝낼 수 없어 막는다.
  // 없으면 pattern 규칙만 쓴다.
  known?(): KnownSecretMatch | undefined;
}): (
  ctx: AuthenticatedContext,
  envelope: CommandEnvelope,
) => Promise<Result<CommandEnvelope>> {
  return async (ctx, envelope) => {
    if (
      envelope.command !== sendMessage.name &&
      envelope.command !== receiveMessage.name &&
      envelope.command !== recordMessage.name
    ) return ok(envelope);
    const kind = parseActor(ctx.actor)?.kind;
    const record = envelope.input as { content?: unknown };
    // 사람은 글만, machine은 글과 reasoning, agent는 글과 카드다(MessageContent).
    const schema = kind === "agent"
      ? agentMessageContentInputSchema
      : kind === "machine"
      ? machineMessageContentInputSchema
      : userMessageContentInputSchema;
    // 답 글에 reasoning이 붙으면 64KiB를 넘기 쉽다. agent와 같은 상한을 쓴다.
    const max = kind === "agent" || kind === "machine"
      ? MESSAGE_CONTENT_MAX_BYTES
      : MESSAGE_TEXT_CONTENT_MAX_BYTES;
    const redacted = redactValue(
      createProductRedactor(deps.known?.()),
      record.content,
    );
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
    const prepared = await prepareBytes(
      relay,
      ctx,
      MESSAGE_CONTENT_PURPOSE,
      bytes,
      "message body",
    );
    if (!prepared.ok) return prepared;
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
