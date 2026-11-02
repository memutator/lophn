import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import type { ToolResult } from "../../../protocol/lophn-agent/mod.ts";
import { toolResultFile } from "../../../protocol/lophn-agent/tool-results.ts";
import { fitJson, jsonBytes, TEXT_MAX_BYTES } from "./result.ts";

// 결과를 줄이는 것은 runtime의 일이다. handler는 전체를 돌려주고, 상한을 넘으면 여기서 전체를 파일에 쓰고
// model에는 미리보기와 경로를 준다. 기록(ledger)에는 미리보기 판이 남아 history가 매번 같은 bytes다.

// 전체를 쓰는 길이다. 쓰기에 실패하면 던진다.
export type ResultSpill = {
  dataRoot: string;
  write(path: string, text: string): Promise<void>;
};

// data root가 절대 path가 아니면 쓸 곳을 알 수 없어 없다.
export function fileResultSpill(
  dataRoot: string | undefined,
): ResultSpill | undefined {
  if (dataRoot === undefined || !isAbsolute(dataRoot)) return undefined;
  return {
    dataRoot,
    async write(path, text) {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(path, text, { mode: 0o600 });
    },
  };
}

// 이 표시가 있는 handler 결과만 spill 대상이다. 스스로 page를 나누는 tool(file.read, shell.run 등)은 달지 않는다.
// arrayKeys는 미리보기에서 뒤쪽 항목부터 덜어 낼 배열 키다.
export type SpillableResult = ToolResult & {
  spill?: { arrayKeys: readonly string[] };
};

const PREVIEW_RESERVE = 256;

// 미리보기 문자열이 JSON으로 실려도 상한 안에 들도록 줄여 가며 자른다. 같은 입력은 늘 같은 글이 된다.
function headText(full: string): string {
  let head = full.slice(0, TEXT_MAX_BYTES);
  while (jsonBytes(head) + PREVIEW_RESERVE > TEXT_MAX_BYTES) {
    head = head.slice(0, Math.floor(head.length * 0.9));
  }
  const last = head.charCodeAt(head.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? head.slice(0, -1) : head;
}

export async function spillLarge(
  ctx: { session: string; tool_call: string; spill?: ResultSpill },
  produced: SpillableResult,
): Promise<ToolResult> {
  const { spill, ...result } = produced;
  if (
    spill === undefined ||
    result.content === null ||
    jsonBytes(result.content) <= TEXT_MAX_BYTES
  ) {
    return result;
  }
  const content = result.content;
  const full = JSON.stringify(content, null, 2);
  const fit =
    spill.arrayKeys.length > 0 &&
    typeof content === "object" &&
    !Array.isArray(content)
      ? fitJson(content as Record<string, unknown>, spill.arrayKeys)
      : null;
  const preview = (fit?.content ?? headText(full)) as ToolResult["content"];
  const bytes = new TextEncoder().encode(full).byteLength;
  const note = (pending: string): ToolResult => ({
    ...result,
    content: preview,
    complete: false,
    pending: [...result.pending, pending],
  });
  if (ctx.spill === undefined) {
    return note("The result was too large to show in full.");
  }
  const path = toolResultFile(ctx.spill.dataRoot, ctx.session, ctx.tool_call);
  try {
    await ctx.spill.write(path, full);
  } catch (error) {
    console.error(
      `tool result: could not write ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return note("The result was too large to show in full.");
  }
  return note(
    `The full result (${bytes} bytes) is in ${path}. Read parts with file.read (offset, limit) or search it with file.grep.`,
  );
}
