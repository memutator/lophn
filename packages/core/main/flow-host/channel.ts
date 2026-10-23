import {
  type ByteSource,
  createStreamDecoder,
  drain,
} from "../../apps/runtime/observations/stream-decoder.ts";
import type { SpawnedWriter } from "../../supervision/responsiveness/process.ts";
import {
  type FlowRequest,
  flowRequestSchema,
  type FlowResponse,
  type FlowStartMessage,
} from "../../../protocol/workflows/flow-wire.ts";

// process -> core 한 줄의 상한(줄바꿈 제외). SDK는 줄바꿈까지 1 MiB를 넘기면 보내지 않는다.
export const FLOW_LINE_MAX_BYTES = 1024 * 1024;

export type RequestHandlers = {
  request(request: FlowRequest): void;
  // id는 읽혔지만 값이 틀린 요청. 통로는 멀쩡하므로 process를 죽이지 않고 실패 응답을 쓴다.
  invalid(id: string, message: string): void;
  // 통로가 깨졌다. 한 번만 부르고 그 뒤 줄은 무시한다.
  bad(reason: string): void;
};

export async function readRequests(
  stdout: ByteSource,
  handlers: RequestHandlers,
): Promise<void> {
  let broken = false;
  const bad = (reason: string) => {
    if (broken) return;
    broken = true;
    handlers.bad(reason);
  };
  await drain(
    stdout,
    createStreamDecoder({
      maxLineBytes: FLOW_LINE_MAX_BYTES,
      onDropped: () => bad("line too long"),
      onLine(line) {
        if (broken) return;
        let value: unknown;
        try {
          value = JSON.parse(line);
        } catch {
          return bad("line is not JSON");
        }
        if (
          typeof value !== "object" || value === null || Array.isArray(value)
        ) {
          return bad("line is not an object");
        }
        const id = (value as { id?: unknown }).id;
        if (typeof id !== "string" || id === "") return bad("line has no id");
        const parsed = flowRequestSchema.safeParse(value);
        if (!parsed.success) {
          const issue = parsed.error.issues[0];
          const where = issue?.path.join(".");
          return handlers.invalid(
            id,
            issue
              ? `${where ? `${where}: ` : ""}${issue.message}`
              : "invalid request",
          );
        }
        handlers.request(parsed.data);
      },
    }),
  );
}

// 여러 요청이 동시에 응답하므로 쓰기를 한 줄로 이어 줄이 섞이지 않게 한다.
// start는 쓰기 실패를 호출자에게 던진다(launch가 알아야 한다). response는 삼킨다. child가 이미 죽었으면
// 그 instance는 `exited`가 정리한다.
export function createWriter(stdin: SpawnedWriter) {
  let tail: Promise<void> = Promise.resolve();
  const encoder = new TextEncoder();
  const send = (message: FlowStartMessage | FlowResponse): Promise<void> => {
    const bytes = encoder.encode(JSON.stringify(message) + "\n");
    const written = tail.then(() => stdin.write(bytes));
    tail = written.catch(() => {});
    return written;
  };
  return {
    start: (message: FlowStartMessage) => send(message),
    response: (message: FlowResponse) => send(message).catch(() => {}),
  };
}
