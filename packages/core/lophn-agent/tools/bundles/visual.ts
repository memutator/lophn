import { z } from "zod";
import { err, ok, type Result } from "../../../../base/mod.ts";
import {
  messageBody,
  readCursorSchema,
  recordMessage,
  toolCallRead,
  type VisualBlock,
  visualKeySchema,
} from "../../../../protocol/lophn-agent/mod.ts";
import { appBlueprint } from "../../../../protocol/apps/mod.ts";
import { idSchema } from "../../../../protocol/base/mod.ts";
import {
  blocksOf,
  checkCardScreen,
  checkVisualContent,
  prepareVisualDocument,
  sourceLinks,
  type VisualBlockInput,
  type VisualRejection,
  windowText,
} from "../visuals/mod.ts";
import { TEXT_MAX_BYTES } from "../result.ts";
import type { ToolDefinition } from "../registry.ts";
import type { RunCredential, ToolHandler } from "../work.ts";
import {
  type ContractCall,
  defineBuiltin,
  type DefineOptions,
  READ,
  success,
} from "./common.ts";
import { bodyOf, continuation, resume, scopeOf, wrap } from "./paging.ts";
import type { ReadLog } from "./read-log.ts";
import {
  blockWindow,
  bodyParts,
  keyOf,
  messageIdFor,
  notDone,
  summaryOf,
  visualsOf,
} from "./visual-view.ts";

// 시각 묶음(concern harness/tools R19). 선언형 명세 검사와 세션 메시지 기록(`visual.show`), 확정
// 명세 읽기(`visual.read`), 문서 본문 준비(`visual.prepare_document`)만 한다. 문서 저장은 문서 tool이
// 따로 한다. 어느 handler도 blob을 준비하거나 hash를 만들지 않는다: 메시지 본문은 값으로
// RecordMessage에 싣고 core가 redaction·blob 준비·영구 참조를 맡으며, 문서 본문은 글 값으로 문서
// tool에 되돌아가 core가 같은 일을 한다.

export const VISUAL_TOOL_REVISION = "2026-10-06";

function define(
  name: string,
  description: string,
  input: z.ZodType,
  contract: string,
  options: DefineOptions,
): ToolDefinition {
  return defineBuiltin(
    VISUAL_TOOL_REVISION,
    name,
    description,
    input,
    contract,
    options,
  );
}

const showInput = z.strictObject({ content: z.json() });
const readInput = z.strictObject({
  message: idSchema("msg"),
  block_key: visualKeySchema.optional(),
  cursor: readCursorSchema.optional(),
});
const prepareInput = z.strictObject({
  message: idSchema("msg"),
  block_keys: z.array(visualKeySchema).min(1).max(8).refine(
    (keys) => new Set(keys).size === keys.length,
    { message: "block keys must be distinct" },
  ),
  cursor: readCursorSchema.optional(),
});

export const visualShowTool = define(
  "visual.show",
  "Show tables, bar, line or scatter charts, node and edge diagrams, and app cards in your answer. " +
    "Send content {schema_version: 1, parts: [text or visual parts in reading order]}. " +
    "A visual part is {kind: 'visual', block} with a declarative block: key, schema_version 1, kind, title, description, " +
    "sources (document versions you read, app command results of this run, or a labeled estimate), and the payload of its kind. " +
    "No HTML, script, CSS, or URL. Up to 8 blocks, 256 KiB in total, 1000 table rows by 20 columns, " +
    "8 chart series with 1000 points, 100 diagram nodes with 200 edges. An oversize message is rejected whole and nothing is cut or saved. " +
    "Missing values are null. Say in the description what has no evidence.",
  showInput,
  recordMessage.name,
  // 세션 출력의 append-only 기록이다. 메시지를 지우는 revert는 없고 정정은 새 메시지다.
  {
    effect: "write",
    scopeCheck: "the calling run's session",
    reversible: true,
    idempotent: true,
  },
);
export const visualReadTool = define(
  "visual.read",
  "Read the stored visual blocks of a message of this assignment. Without block_key it lists each block's title, " +
    "description, and sources. With block_key it reads that block's stored data, a window at a time. This changes nothing.",
  readInput,
  messageBody.name,
  { ...READ, scopeCheck: "messages of this assignment" },
);
export const visualPrepareDocumentTool = define(
  "visual.prepare_document",
  "Prepare the text/html body that keeps chosen visual blocks of a message as a document: title, description, sources, " +
    "the data as plain tables and lists, and the fixed specification as escaped text, with no script or live app. " +
    "Nothing is saved: pass the whole text, windows joined in order, to document.create or document.save_version " +
    "with media_type text/html. A prepared body is not a saved document.",
  prepareInput,
  messageBody.name,
  { ...READ, scopeCheck: "messages of this assignment" },
);

export const VISUAL_TOOLS: readonly ToolDefinition[] = [
  visualShowTool,
  visualReadTool,
  visualPrepareDocumentTool,
];
export const VISUAL_TOOL_NAMES: readonly string[] = VISUAL_TOOLS.map((tool) =>
  tool.name
);

export type VisualToolPorts = ContractCall & {
  newId(prefix: "msg"): string;
  // 기록할 세션은 호출 run이 이어진 사실에서 온다. 세션 없는 주기 회차에는 없다.
  runFacts(run: string): Promise<Result<{ session: string | null }>>;
};

// 준비한 글 한 조각의 JSON 문자열 크기. 결과의 나머지 field가 상한 안에 남게 한다.
const TEXT_WINDOW_BYTES = 20 * 1024;

export function createVisualToolHandlers(
  ports: VisualToolPorts,
  reads: ReadLog,
): ReadonlyMap<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();

  // 출처는 이 run이 읽은 문서 판, 이 run이 실행해 끝낸 앱 command 결과, 표시한 추정뿐이다. 소유
  // contract로 확인하지 못한 것은 같은 문장으로 거절한다(없는 것과 다른 run의 것을 가르지 않는다).
  async function verifySources(
    blocks: readonly VisualBlockInput[],
    credential: RunCredential,
  ): Promise<Result<VisualRejection | null>> {
    const unverified = (block: string, index: number): VisualRejection => ({
      code: "invalid_input",
      stage: "source",
      block,
      message:
        `source ${index} is not a document version read or an app command result run in this run`,
    });
    for (const block of blocks) {
      for (const [index, source] of block.sources.entries()) {
        if (source.kind === "document") {
          const { document, version } = source.reference;
          if (!reads.has(credential.run, document, version)) {
            return ok(unverified(block.key, index));
          }
        } else if (source.kind === "app_command") {
          const { app, release, command, tool_call } = source.reference;
          const read = await ports.call(
            toolCallRead.name,
            { tool_call },
            credential.run,
          );
          if (!read.ok) {
            if (
              read.error.code === "not_found" || read.error.code === "forbidden"
            ) return ok(unverified(block.key, index));
            return read;
          }
          const call = bodyOf(read.value)["tool_call"] as
            | {
              run?: string;
              state?: string;
              outcome?: { kind?: string } | null;
              app_command?: {
                app?: string;
                release?: string;
                command?: string;
              } | null;
            }
            | undefined;
          const matches = call !== undefined && call.run === credential.run &&
            call.state === "finished" && call.outcome?.kind === "success" &&
            call.app_command?.app === app &&
            call.app_command?.release === release &&
            call.app_command?.command === command;
          if (!matches) return ok(unverified(block.key, index));
        }
      }
    }
    return ok(null);
  }

  // 앱 카드는 blueprint에서 카드 크기를 지원한 화면만 참조한다(visuals#R4). 카드가 있으면
  // 이 run의 agent 자격으로 앱 blueprint를 읽어 view 화면이 card 크기를 선언했는지 본다.
  // 읽지 못한 앱과 card 미지원 화면은 같은 거절이며 존재를 새지 않는다.
  async function verifyCards(
    blocks: readonly VisualBlockInput[],
    credential: RunCredential,
  ): Promise<Result<VisualRejection | null>> {
    for (const block of blocks) {
      if (block.kind !== "app_card") continue;
      const read = await ports.call(
        appBlueprint.name,
        { app: block.payload.app },
        credential.run,
      );
      if (!read.ok) {
        if (
          read.error.code === "not_found" || read.error.code === "forbidden"
        ) {
          return ok(cardUnsupported(block.key));
        }
        return read;
      }
      const body = bodyOf(read.value) as {
        screens?: { key: string; sizes: string[] }[];
      };
      const supported = checkCardScreen(body, block.payload);
      if (!supported.ok) return ok(cardUnsupported(block.key));
    }
    return ok(null);
  }

  function cardUnsupported(block: string): VisualRejection {
    return {
      code: "invalid_input",
      stage: "block",
      block,
      message:
        "app card does not reference a screen of the active release that declares the card size",
    };
  }

  handlers.set(
    visualShowTool.name,
    async (input, credential: RunCredential) => {
      const facts = await ports.runFacts(credential.run);
      if (!facts.ok) return facts;
      // 세션 없는 주기 회차에는 둘 곳이 없다. 없는 tool과 같은 답이다.
      if (facts.value.session === null) {
        return err({ code: "not_found", message: "no session to show in" });
      }
      const checked = checkVisualContent(
        (input as z.infer<typeof showInput>).content,
      );
      if (!checked.ok) return ok(notDone("not shown", checked.error));
      const blocks = blocksOf(checked.value);
      const verified = await verifySources(blocks, credential);
      if (!verified.ok) return verified;
      if (verified.value !== null) {
        return ok(notDone("not shown", verified.value));
      }
      // 카드 참조의 화면이 지금 active release의 card 크기 화면인지 본다(visuals#R4).
      const cards = await verifyCards(blocks, credential);
      if (!cards.ok) return cards;
      if (cards.value !== null) {
        return ok(notDone("not shown", cards.value));
      }
      const id = messageIdFor(credential.call, () => ports.newId("msg"));
      const recorded = await ports.call(recordMessage.name, {
        id,
        session: facts.value.session,
        run: credential.run,
        content: checked.value,
        links: sourceLinks(blocks),
      }, credential.run);
      if (!recorded.ok) return recorded;
      return ok(success("visuals shown", {
        message: id,
        stored: true,
        blocks: blocks.map((block) => ({ key: block.key, kind: block.kind })),
      }));
    },
  );

  handlers.set(
    visualReadTool.name,
    async (input, credential) => {
      const value = input as z.infer<typeof readInput>;
      const scope = scopeOf(visualReadTool.name, {
        message: value.message,
        block_key: value.block_key ?? null,
      });
      const resumed = resume(value.cursor, scope);
      if (!resumed.ok) return resumed;
      const read = await ports.call(
        messageBody.name,
        { message: value.message },
        credential.run,
      );
      if (!read.ok) return read;
      const stored = bodyParts(read.value);
      if (!stored.ok) return stored;
      const visuals = visualsOf(stored.value.parts);
      if (value.block_key === undefined) {
        return ok(success("visual blocks listed", {
          message: value.message,
          blocks: visuals.map(summaryOf),
        }));
      }
      const found = visuals.find((entry) => keyOf(entry) === value.block_key);
      if (found === undefined) {
        return err({ code: "not_found", message: "no such block" });
      }
      if (found.stored.status !== "ready") {
        return ok(success("visual block unavailable", {
          message: value.message,
          ...summaryOf(found),
        }));
      }
      return ok(blockWindow(
        "visual block read",
        scope,
        found.stored.block,
        resumed.value?.skip ?? 0,
        found.position,
      ));
    },
  );

  handlers.set(
    visualPrepareDocumentTool.name,
    async (input, credential) => {
      const value = input as z.infer<typeof prepareInput>;
      const scope = scopeOf(visualPrepareDocumentTool.name, {
        message: value.message,
        block_keys: value.block_keys,
      });
      const resumed = resume(value.cursor, scope);
      if (!resumed.ok) return resumed;
      const read = await ports.call(
        messageBody.name,
        { message: value.message },
        credential.run,
      );
      if (!read.ok) return read;
      const stored = bodyParts(read.value);
      if (!stored.ok) return stored;
      // 고른 key가 하나라도 없거나 이용할 수 없으면 일부만 준비하지 않는다. 같은 답이다.
      const chosen: VisualBlock[] = [];
      for (const entry of visualsOf(stored.value.parts)) {
        const key = keyOf(entry);
        if (key === null || !value.block_keys.includes(key)) continue;
        if (entry.stored.status !== "ready") {
          return err({ code: "not_found", message: "no such block" });
        }
        chosen.push(entry.stored.block);
      }
      if (chosen.length !== value.block_keys.length) {
        return err({ code: "not_found", message: "no such block" });
      }
      const prepared = prepareVisualDocument({
        message: value.message,
        source_body: stored.value.body,
        blocks: chosen,
      });
      if (!prepared.ok) {
        return ok(notDone("not prepared", {
          stage: "content",
          block: null,
          message: prepared.error.message,
        }));
      }
      const piece = windowText(
        prepared.value.text,
        resumed.value?.skip ?? 0,
        TEXT_WINDOW_BYTES,
      );
      const next = piece.next === null ? null : wrap(scope, null, piece.next);
      const content = {
        prepared: true,
        // 준비한 글이다. 저장하지 않았고 저장 전에는 본문 hash도 없다.
        saved: false,
        message: value.message,
        block_keys: prepared.value.block_keys,
        media_type: "text/html",
        document_bytes: prepared.value.bytes,
        segments: piece.total_segments,
        snapshots: prepared.value.snapshots,
        text: piece.text,
      };
      if (
        new TextEncoder().encode(JSON.stringify(content)).byteLength >
          TEXT_MAX_BYTES
      ) {
        return err({
          code: "internal",
          message: "prepared window is too large",
        });
      }
      return ok({
        status: "success",
        summary: next === null
          ? "document body prepared, not saved"
          : "document body window, not saved",
        content,
        complete: next === null,
        source: null,
        continuation: continuation(next),
        pending: [],
      });
    },
  );
  return handlers;
}
