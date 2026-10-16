import type { Clock } from "../../base/mod.ts";
import { ok } from "../../base/mod.ts";
import {
  type DiagnosticRecord,
  diagnosticRecordSchema,
} from "../../protocol/diagnostics/mod.ts";
import type { ReadHandler } from "../server/mod.ts";

export type DiagnosticQuery = {
  component?: string;
  kind?: DiagnosticRecord["kind"];
};

// 기록된 안전 진단. 원문은 여기 들어오기 전에 redaction을 통과한 것이다.
export type DiagnosticListSource = {
  records(query: DiagnosticQuery): Promise<readonly DiagnosticRecord[]>;
};

const LIST_MAX = 200;

export function diagnosticsListRead(source: DiagnosticListSource): ReadHandler {
  return async (_ctx, input) => {
    const query = input && typeof input === "object"
      ? input as DiagnosticQuery
      : {};
    return ok({
      records: await source.records({
        component: query.component,
        kind: query.kind,
      }),
      as_of_seq: "0",
      next_cursor: null,
    });
  };
}

// files.ts가 쓴 `<root>/logs/platform-N.jsonl`을 읽는다. 줄이 DiagnosticRecord가 아니면 건너뛰고
// 그 개수만 안전한 log 줄로 남긴다. 최근 순서로 최대 LIST_MAX개를 준다.
export function createLogRecordSource(
  root: string,
  clock: Clock,
): DiagnosticListSource {
  const directory = `${root}/logs`;
  return {
    async records(query) {
      const all: DiagnosticRecord[] = [];
      let skipped = 0;
      for (const name of await logNames(directory)) {
        const text = await readText(`${directory}/${name}`);
        for (const line of text.split("\n")) {
          if (!line) continue;
          const record = parseLine(line);
          if (record) all.push(record);
          else skipped++;
        }
      }
      if (skipped > 0) all.push(skippedRecord(skipped, clock.now()));
      return all
        .filter((record) =>
          (query.component === undefined ||
            record.component === query.component) &&
          (query.kind === undefined || record.kind === query.kind)
        )
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
        .slice(0, LIST_MAX);
    },
  };
}

async function logNames(directory: string): Promise<string[]> {
  const names: string[] = [];
  try {
    for await (const entry of Deno.readDir(directory)) {
      if (entry.isFile && /^platform-\d+\.jsonl$/.test(entry.name)) {
        names.push(entry.name);
      }
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  return names;
}

async function readText(path: string): Promise<string> {
  try {
    return await Deno.readTextFile(path);
  } catch (error) {
    // 회전 중 지워진 파일은 빈 것으로 본다.
    if (error instanceof Deno.errors.NotFound) return "";
    throw error;
  }
}

function parseLine(line: string): DiagnosticRecord | undefined {
  try {
    const parsed = diagnosticRecordSchema.safeParse(JSON.parse(line));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function skippedRecord(count: number, at: string): DiagnosticRecord {
  return {
    at,
    component: "platform/diagnostics",
    kind: "log",
    code: "unreadable_lines",
    error_type: null,
    location: null,
    message: `${count} log lines could not be read.`,
    redaction: {
      rule_revision: "diagnostic-fixed-catalog",
      status: "partial",
      content: null,
      redacted_items: [],
      omissions: [{
        location: "payload",
        reason: "private",
        message: "Only the count is retained.",
      }],
    },
  };
}
