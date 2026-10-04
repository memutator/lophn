// CLI 출력 계층(architecture/coding-agent 5.1, cli#R2·R3). 기계 출력과 진단은
// 분리한다. --json이면 stdout에 JSON 하나와 마지막 newline만 쓰고 stderr에는
// redaction된 진단만 보낸다. 사람 출력은 같은 data를 줄로 표현한다.
import type {
  AgentFailure,
  AgentResult,
} from "../../contracts/coding-agent/mod.ts";
import { CLI_EXITS, cliExit } from "../../contracts/coding-agent/mod.ts";
import {
  createKnownSecretRegistry,
  type KnownSecretRegistry,
} from "../../platform/redaction/mod.ts";
import {
  createRedactionStream,
  type RedactionStream,
} from "../../platform/redaction/mod.ts";

export type OutputWriter = {
  result(result: AgentResult): Promise<void>;
  failure(failure: AgentFailure): Promise<void>;
  diagnostic(message: string): Promise<void>;
  exitCode(failure: AgentFailure | undefined): number;
};

export type OutputOptions = {
  json: boolean;
  // stdout·stderr을 바꿔 끼운다. 기본은 process의 것이다.
  stdout?: WritableStream<Uint8Array>;
  stderr?: WritableStream<Uint8Array>;
  registry?: KnownSecretRegistry;
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

// 실페 details와 message에서 raw secret을 지운다. 어느 쪽에도 원문을 쓰지 않는다(R3).
function redactText(registry: KnownSecretRegistry, text: string): string {
  const stream = createRedactionStream(registry);
  stream.push(text);
  return stream.finish();
}

export function createOutput(options: OutputOptions): OutputWriter {
  const json = options.json;
  const stdout = options.stdout ?? Deno.stdout.writable;
  const stderr = options.stderr ?? Deno.stderr.writable;
  const registry = options.registry ?? createKnownSecretRegistry();
  async function emitResult(result: AgentResult): Promise<void> {
    if (json) {
      write(stdout, `${JSON.stringify(result)}\n`);
      return;
    }
    write(stdout, `${result.summary}\n`);
    for (const line of humanLines(result)) {
      write(stdout, `${line}\n`);
    }
    if (result.next.length > 0) {
      write(stdout, "다음 조회:\n");
      for (const item of result.next) {
        write(stdout, `  ${item}\n`);
      }
    }
  }
  async function emitFailure(failure: AgentFailure): Promise<void> {
    if (json) {
      write(stdout, `${JSON.stringify({ error: failure })}\n`);
      return;
    }
    write(stderr, `${redactText(registry, failure.message)}\n`);
    if (failure.details !== undefined) {
      write(
        stderr,
        `${redactText(registry, JSON.stringify(failure.details))}\n`,
      );
    }
  }
  return {
    result: emitResult,
    failure: emitFailure,
    async diagnostic(message) {
      write(stderr, `${redactText(registry, message)}\n`);
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
