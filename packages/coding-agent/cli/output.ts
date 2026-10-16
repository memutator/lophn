// CLI 출력 계층. 기계 출력과 진단은 분리한다.
// --json이면 stdout에 JSON 하나와 마지막 newline만 쓴다. 아니면 같은 data를 줄로 풀어 쓰되 token이 아닌
// 문자열(사람 말, 앱 문자열, log 원문)은 모두 data fence 안에 둔다. 받은 coding token은 어떤 출력에도 남지 않는다.
import type { LophnError } from "../../base/mod.ts";
import { fenceBlock, isPlainToken } from "./fence.ts";

export const CLI_EXITS = {
  success: 0,
  internal: 1,
  invalid_input: 2,
  unauthorized: 3,
  failed: 4,
  transport: 5,
  effect_unknown: 6,
} as const;

// 쓰기 응답을 잃은 것은 실패와 구별한다. 같은 key로 대상을 다시 읽어야 한다.
export function exitOf(error: LophnError | undefined): number {
  if (error === undefined) return CLI_EXITS.success;
  if (error.details?.diagnosis === "effect_unknown") {
    return CLI_EXITS.effect_unknown;
  }
  switch (error.code) {
    case "invalid_input":
      return CLI_EXITS.invalid_input;
    case "unauthorized":
    case "forbidden":
      return CLI_EXITS.unauthorized;
    case "unavailable":
      return CLI_EXITS.transport;
    case "internal":
      return CLI_EXITS.internal;
    default:
      return CLI_EXITS.failed;
  }
}

type OutputWriter = {
  // data가 undefined이면 아무것도 쓰지 않는다(hook).
  result(data: unknown): Promise<void>;
  failure(error: LophnError): Promise<void>;
  // 안내 글이다(help). 자료가 아니므로 fence 없이 stdout에 쓴다.
  text(text: string): Promise<void>;
};

type OutputOptions = {
  json: boolean;
  stdout?: WritableStream<Uint8Array>;
  stderr?: WritableStream<Uint8Array>;
  // 출력에서 지울 비밀 값이다(coding token).
  secrets?: readonly string[];
};

const encoder = new TextEncoder();

async function write(
  writer: WritableStream<Uint8Array>,
  text: string,
): Promise<void> {
  const stream = writer.getWriter();
  try {
    await stream.write(encoder.encode(text));
  } finally {
    stream.releaseLock();
  }
}

// data를 줄로 푼다. key는 CLI·protocol이 정한 이름이라 그대로 쓰고, 문자열 값만 fence를 판단한다.
function renderLines(
  value: unknown,
  indent = "",
  label = "data",
): string[] {
  if (value === null || typeof value !== "object") {
    if (typeof value === "string" && !isPlainToken(value)) {
      const fenced = fenceBlock(label, value);
      return fenced.length === 0
        ? [`${indent}""`]
        : fenced.map((line) => `${indent}${line}`);
    }
    return [`${indent}${value === null ? "null" : String(value)}`];
  }
  const lines: string[] = [];
  const entries: [string, unknown][] = Array.isArray(value)
    ? value.map((item, index) => [`[${index}]`, item])
    : Object.entries(value);
  for (const [key, item] of entries) {
    const name = label === "data" ? key : `${label}.${key}`;
    const child = renderLines(item, `${indent}  `, name);
    const inline = item === null || typeof item !== "object" ||
      (typeof item === "string" && isPlainToken(item));
    if (inline && child.length === 1) {
      lines.push(`${indent}${key}: ${child[0].trimStart()}`);
    } else {
      lines.push(`${indent}${key}:`, ...child);
    }
  }
  return lines;
}

export function createOutput(options: OutputOptions): OutputWriter {
  const stdout = options.stdout ?? Deno.stdout.writable;
  const stderr = options.stderr ?? Deno.stderr.writable;
  const secrets = (options.secrets ?? []).filter((value) => value !== "");
  const scrub = (text: string) =>
    secrets.reduce((acc, secret) => acc.replaceAll(secret, "[redacted]"), text);
  return {
    async result(data) {
      if (data === undefined) return;
      const text = options.json
        ? JSON.stringify(data)
        : renderLines(data).join("\n");
      await write(stdout, `${scrub(text)}\n`);
    },
    async failure(error) {
      const body = { code: error.code, message: error.message };
      if (options.json) {
        await write(
          stdout,
          `${
            scrub(JSON.stringify({
              error: error.details === undefined
                ? body
                : { ...body, details: error.details },
            }))
          }\n`,
        );
        return;
      }
      const lines = [`${error.code}: ${error.message}`];
      if (error.details !== undefined) {
        lines.push(...renderLines(error.details, "  ", "details"));
      }
      await write(stderr, `${scrub(lines.join("\n"))}\n`);
    },
    async text(text) {
      await write(stdout, `${text}\n`);
    },
  };
}
