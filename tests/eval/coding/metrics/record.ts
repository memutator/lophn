import type { Result } from "../../../../packages/base/mod.ts";
import type {
  CodingCommand,
  CodingRecord,
  CodingTrace,
  CodingUsage,
} from "../../types.ts";
import { countHook, parseCommandLog } from "./commands.ts";
import { readClaudeUsage } from "./jsonl.ts";

export function codingRecordOf(
  trace: CodingTrace,
  commands: CodingCommand[],
  usage: Result<CodingUsage>,
  permissionRequests: number,
): CodingRecord {
  const { command_log: _log, attach_socket: _socket, ...rest } = trace;
  return {
    ...rest,
    usage: usage.ok ? usage.value : null,
    usage_error: usage.ok ? null : usage.error.message,
    commands,
    message_send: commands.filter((c) => c.name === "message send").length,
    permission_requests: permissionRequests,
  };
}

export function codingTotals(records: CodingRecord[]): CodingUsage | null {
  const usages = records.flatMap((r) => r.usage ? [r.usage] : []);
  if (usages.length === 0) return null;
  const sum = (pick: (u: CodingUsage) => number) =>
    usages.reduce((n, u) => n + pick(u), 0);
  const inputTotal = sum((u) => u.input_total);
  const cacheRead = sum((u) => u.cache_read);
  const toolResults = sum((u) => u.tool_results);
  const toolErrors = sum((u) => u.tool_errors);
  return {
    files: sum((u) => u.files),
    models: [...new Set(usages.flatMap((u) => u.models))].sort(),
    api_calls: sum((u) => u.api_calls),
    input: sum((u) => u.input),
    output: sum((u) => u.output),
    cache_read: cacheRead,
    cache_write: sum((u) => u.cache_write),
    input_total: inputTotal,
    cache_hit_rate: inputTotal === 0 ? null : cacheRead / inputTotal,
    tool_results: toolResults,
    tool_errors: toolErrors,
    tool_error_rate: toolResults === 0 ? null : toolErrors / toolResults,
  };
}

export async function collectCoding(
  deps: { home: string },
  traces: CodingTrace[],
): Promise<CodingRecord[]> {
  return await Promise.all(traces.map(async (trace) => {
    // wrapper가 한 번도 안 불렸으면 file이 없다. 그것은 오류가 아니라 빈 기록이다.
    const log = await Deno.readTextFile(trace.command_log).catch(() => "");
    return codingRecordOf(
      trace,
      parseCommandLog(log),
      await readClaudeUsage(deps.home, trace.cwd),
      countHook(log, "PermissionRequest"),
    );
  }));
}
