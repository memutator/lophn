// CLI 출력 계층(architecture/coding-agent 5.1). 기계 출력과 진단은
// 분리한다. --json이면 stdout에 JSON 하나와 마지막 newline만 쓰고 stderr에는
// redaction된 진단만 보낸다. 사람 출력은 같은 data를 줄로 표현한다. redaction은
// 조립이 끼워 준다(mcp-server/stdio의 같은 모양, entry가 자기 기준으로 거른다).
import type {
  AgentFailure,
  AgentResult,
} from "../../protocol/coding-agent/mod.ts";
import { CLI_EXITS, cliExit } from "../../protocol/coding-agent/mod.ts";

export type OutputWriter = {
  result(result: AgentResult): Promise<void>;
  failure(failure: AgentFailure): Promise<void>;
  diagnostic(message: string): Promise<void>;
  // 제품 hook이 context로 읽는 글 그대로다. 빈 글은 아무것도 쓰지 않는다.
  raw(text: string): Promise<void>;
  exitCode(failure: AgentFailure | undefined): number;
};

export type OutputOptions = {
  json: boolean;
  // stdout·stderr을 바꿔 끼운다. 기본은 process의 것이다.
  stdout?: WritableStream<Uint8Array>;
  stderr?: WritableStream<Uint8Array>;
  // 진단·실패 message·details를 거치는 함수다. 끼우지 않으면 거르지 않는다.
  redact?: (text: string) => string;
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

export function createOutput(options: OutputOptions): OutputWriter {
  const json = options.json;
  const stdout = options.stdout ?? Deno.stdout.writable;
  const stderr = options.stderr ?? Deno.stderr.writable;
  const redact = options.redact ?? ((text) => text);
  async function emitResult(result: AgentResult): Promise<void> {
    if (json) {
      await write(stdout, `${JSON.stringify(result)}\n`);
      return;
    }
    await write(stdout, `${result.summary}\n`);
    for (const line of humanLines(result)) {
      await write(stdout, `${line}\n`);
    }
    if (result.next.length > 0) {
      await write(stdout, "다음 조회:\n");
      for (const item of result.next) {
        await write(stdout, `  ${item}\n`);
      }
    }
  }
  async function emitFailure(failure: AgentFailure): Promise<void> {
    if (json) {
      await write(stdout, `${JSON.stringify({ error: failure })}\n`);
      return;
    }
    await write(stderr, `${redact(failure.message)}\n`);
    if (failure.details !== undefined) {
      await write(
        stderr,
        `${redact(JSON.stringify(failure.details))}\n`,
      );
    }
  }
  return {
    result: emitResult,
    failure: emitFailure,
    async diagnostic(message) {
      await write(stderr, `${redact(message)}\n`);
    },
    async raw(text) {
      if (text !== "") await write(stdout, `${redact(text)}\n`);
    },
    exitCode(failure) {
      return cliExit(failure);
    },
  };
}

// 사람 출력의 data 줄. JSON 구조를 다시 해석하지 않고 key: value 줄로 낸다.
function humanLines(result: AgentResult): string[] {
  if (result.data === undefined || result.data === null) return [];
  if (typeof result.data !== "object") {
    return [`${result.data}`];
  }
  const record = result.data as Record<string, unknown>;
  return Object.entries(record).map(([key, value]) =>
    `${key}: ${typeof value === "object" ? JSON.stringify(value) : `${value}`}`
  );
}

export { CLI_EXITS };
