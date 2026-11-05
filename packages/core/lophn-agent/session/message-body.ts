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
  type ContentBlock,
  contentBlocksSchema,
  contentOfBlocks,
  contentOfShell,
  editQueuedMessage,
  machineMessageContentInputSchema,
  MESSAGE_CONTENT_MAX_BYTES,
  MESSAGE_CONTENT_PURPOSE,
  receiveMessage,
  recordMessage,
  recordShellMessage,
  sendMessage,
  serializeMessageContent,
  userContentBlocksSchema,
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

// 글을 가진 칸만 redaction한다. type, mimeType, blob hash는 그대로 둔다: hash 모양의 글을 secret으로 오인해
// 이미지 참조를 깨지 않게 한다. 안전화를 끝내지 못하면 null이다.
export function redactBlocks(
  redactText: TextRedactor,
  blocks: readonly ContentBlock[],
): ContentBlock[] | null {
  const safe = (text: string) => redactText(SOURCE, "text/plain", text);
  const out: ContentBlock[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case "image":
        out.push(block);
        break;
      case "text": {
        const text = safe(block.text);
        if (text === null) return null;
        out.push({ ...block, text });
        break;
      }
      case "resource": {
        const uri = safe(block.uri);
        const text = safe(block.text);
        if (uri === null || text === null) return null;
        out.push({ ...block, uri, text });
        break;
      }
      case "resource_link": {
        const uri = safe(block.uri);
        const name = safe(block.name);
        const description =
          block.description === undefined ? undefined : safe(block.description);
        if (uri === null || name === null || description === null) return null;
        out.push({
          ...block,
          uri,
          name,
          ...(description === undefined ? {} : { description }),
        });
        break;
      }
    }
  }
  return out;
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

// 사람이 `!`로 돌린 명령의 기록이다. 명령과 출력의 글을 redaction하고(끝내지 못하면 저장하지 않는다) 그 값에서
// 저장되는 본문(`contentOfShell`)을 blob으로 준비한다. command는 redaction을 거친 입력으로 같은 본문을 다시 만든다.
async function prepareShell(
  deps: {
    relay(): BodyPrepare | undefined;
    known?(): KnownSecretMatch | undefined;
  },
  ctx: AuthenticatedContext,
  envelope: CommandEnvelope,
): Promise<Result<CommandEnvelope>> {
  const shaped = recordShellMessage.input.safeParse(envelope.input);
  if (!shaped.success) {
    return rejected("invalid_input", "shell record is not valid");
  }
  const { id, session, duration_ms, ...ran } = shaped.data;
  const redacted = redactValue(createProductRedactor(deps.known?.()), ran);
  if (redacted === null) {
    return rejected("unavailable", "shell output redaction did not finish");
  }
  const safe = redacted.value as typeof ran;
  const bytes = serializeMessageContent(contentOfShell(safe));
  if (bytes.length > MESSAGE_CONTENT_MAX_BYTES) {
    return rejected("invalid_input", "shell output is too large");
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
  return ok({ ...envelope, input: { id, session, duration_ms, ...safe } });
}

// 본문을 싣는 command의 앞 단계. 값은 redaction을 거친 값으로 바뀌어 writer에 가고,
// 그 바이트는 보낸 자격의 이름으로 준비되어 있다. 다른 command는 그대로 지나간다.
// 사람 메시지는 content block이고 저장되는 본문(`contentOfBlocks`)이 blob이 된다. 이미지는 hash만 싣는다:
// bytes는 보낸 자격으로 먼저 올린 blob이고 command가 같은 transaction에서 그 참조를 등록한다.
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
    if (envelope.command === recordShellMessage.name) {
      return prepareShell(deps, ctx, envelope);
    }
    const blocksCommand =
      envelope.command === sendMessage.name ||
      envelope.command === receiveMessage.name ||
      envelope.command === editQueuedMessage.name;
    if (!blocksCommand && envelope.command !== recordMessage.name) {
      return ok(envelope);
    }
    const record = envelope.input as { content?: unknown };
    const redact = createProductRedactor(deps.known?.());
    let content: unknown;
    let bytes: Uint8Array;
    if (blocksCommand) {
      const shaped = contentBlocksSchema.safeParse(record.content);
      if (!shaped.success) {
        return rejected("invalid_input", "message content is not valid");
      }
      const redacted = redactBlocks(redact, shaped.data);
      if (redacted === null) {
        return rejected("unavailable", "message redaction did not finish");
      }
      // redaction 뒤 값이 다시 계약 안인지 본다. 대체 문구가 길어 상한을 넘을 수 있다.
      const checked = userContentBlocksSchema.safeParse(redacted);
      if (!checked.success) {
        return rejected("invalid_input", "message content is not valid");
      }
      content = checked.data;
      bytes = serializeMessageContent(contentOfBlocks(checked.data));
    } else {
      const kind = parseActor(ctx.actor)?.kind;
      // agent는 글과 카드, machine은 글과 reasoning이다(MessageContent).
      const schema =
        kind === "agent"
          ? agentMessageContentInputSchema
          : kind === "machine"
            ? machineMessageContentInputSchema
            : undefined;
      if (schema === undefined) return ok(envelope);
      const redacted = redactValue(redact, record.content);
      if (redacted === null) {
        return rejected("unavailable", "message redaction did not finish");
      }
      const checked = schema.safeParse(redacted.value);
      if (!checked.success) {
        return rejected("invalid_input", "message content is not valid");
      }
      content = checked.data;
      bytes = serializeMessageContent(checked.data);
      // 답 글에 reasoning이 붙으면 64KiB를 넘기 쉽다. 사람 메시지보다 큰 상한을 쓴다.
      if (bytes.length > MESSAGE_CONTENT_MAX_BYTES) {
        return rejected("invalid_input", "message content is too large");
      }
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
    return ok({ ...envelope, input: { ...record, content } });
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
