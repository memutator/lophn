// stdio transport다(architecture/coding-agent 2.1). stdout에는 newline으로 끝난
// JSON-RPC 메시지만 나가고 stderr에는 진단만 나간다. 진단이 protocol을 깨지 않게
// 두 통로를 섞지 않는다. redaction은 조립이 끼워 준다(entry가 자기 기준으로 거른다).
export const MAX_LINE_BYTES = 8 * 1024 * 1024;

// stdin이 닫히면 server도 끝난다. MCP client가 process를 닫는 것이 종료다.
export type StdioStreams = {
  stdin: ReadableStream<Uint8Array>;
  stdout: WritableStream<Uint8Array>;
  stderr: WritableStream<Uint8Array>;
};

const decoder = new TextDecoder();
const encoder = new TextEncoder();

// 한 줄이 상한을 넘으면 메시지가 성립하지 않는다(parse 오류로 취급한다).
export type LineOutcome =
  | { kind: "line"; line: string }
  | { kind: "oversize" }
  | { kind: "eof" };

// 임의로 끊긴 chunk를 모아 newline 단위로 되돌린다. 보고 싶은 경계는 줄이다.
function createLineReader(stdin: ReadableStream<Uint8Array>): {
  next(): Promise<LineOutcome>;
} {
  const reader = stdin.getReader();
  let pending = "";
  return {
    async next(): Promise<LineOutcome> {
      while (true) {
        const newline = pending.indexOf("\n");
        if (newline >= 0) {
          const line = pending.slice(0, newline);
          pending = pending.slice(newline + 1);
          if (encoder.encode(line).length > MAX_LINE_BYTES) {
            // 상한을 넘은 줄은 통째로 버린다. 잘린 반 줄을 메시지로 내지 않는다.
            return { kind: "oversize" };
          }
          return { kind: "line", line };
        }
        const read = await reader.read();
        if (read.done) {
          if (pending.trim() !== "") {
            const line = pending;
            pending = "";
            if (encoder.encode(line).length > MAX_LINE_BYTES) {
              return { kind: "oversize" };
            }
            return { kind: "line", line };
          }
          return { kind: "eof" };
        }
        if (read.value.length === 0) continue;
        pending += decoder.decode(read.value, { stream: true });
      }
    },
  };
}

export type MessageSink = {
  // JSON-RPC 메시지는 stdout에만 나간다. newline과 함께 쓴다.
  send(text: string): Promise<void>;
  // 진단은 stderr에 newline으로 나낸다. protocol 통로를 잠그지 않게 따로 둔다.
  diagnose(text: string): Promise<void>;
  close(): Promise<void>;
};

export function createMessageSink(
  streams: StdioStreams,
  redact: (text: string) => string = (text) => text,
): MessageSink {
  return {
    send: async (text) => {
      await write(streams.stdout, encoder.encode(`${text}\n`));
    },
    diagnose: async (text) => {
      // 진단은 redaction을 거친 값만 나간다. secret이 stderr로 새지 않는다.
      try {
        await write(streams.stderr, encoder.encode(`${redact(text)}\n`));
      } catch {
        // 닫힌 stderr에 쓰려다 실패해도 server는 계속된다.
      }
    },
    close: async () => {
      try {
        await streams.stdout.getWriter().close();
      } catch {
        // 이미 닫혔으면 조용히 끝난다.
      }
    },
  };
}

async function write(
  stream: WritableStream<Uint8Array>,
  bytes: Uint8Array,
): Promise<void> {
  const writer = stream.getWriter();
  try {
    await writer.write(bytes);
  } finally {
    writer.releaseLock();
  }
}

// 줄 단위 읽기를 시작한다. next는 eof에 undefined를 돌려주고 stdin이 닫히면
// 등록한 종료 콜백을 모두 부른다.
export function startLineReader(stdin: ReadableStream<Uint8Array>): {
  next(): Promise<LineOutcome>;
  onEof(cb: () => void): void;
} {
  const reader = createLineReader(stdin);
  const onEof: (() => void)[] = [];
  return {
    async next(): Promise<LineOutcome> {
      const outcome = await reader.next();
      if (outcome.kind === "eof") {
        for (const cb of onEof) cb();
      }
      return outcome;
    },
    onEof(cb: () => void): void {
      onEof.push(cb);
    },
  };
}
