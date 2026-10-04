// stdio transport의 framing·상한·종료 테스트다(R1). stdout에는 protocol 메시지만
// 나가는지와 stderr 진단이 protocol을 깨지 않는지 본다. 실제 process를 띄우지 않고
// stream을 끼운다.
import { assertEquals } from "@std/assert";
import { createMessageSink, MAX_LINE_BYTES, startLineReader } from "./stdio.ts";

function streams() {
  const inbox = new TransformStream<Uint8Array, Uint8Array>();
  const outbox = new TransformStream<Uint8Array, Uint8Array>();
  const errbox = new TransformStream<Uint8Array, Uint8Array>();
  return {
    stdin: inbox.readable,
    incoming: inbox.writable,
    stdout: outbox.writable,
    outgoing: outbox.readable,
    stderr: errbox.writable,
    diagnostics: errbox.readable,
  };
}

// 쓰기를 마친 뒤 닫힌 스트림의 남은 chunk를 읽는다. for-await drain은 닫힘이
// 필요하므로 sink가 닫지 않는 stderr에는 첫 chunk 읽기와 cancel을 쓴다.
async function firstChunk(
  readable: ReadableStream<Uint8Array>,
): Promise<string> {
  const decoder = new TextDecoder();
  const reader = readable.getReader();
  const read = await reader.read();
  const text = read.done ? "" : decoder.decode(read.value, { stream: true });
  await reader.cancel();
  return text;
}

// 쓰기를 마친 뒤 스트림을 닫는다. 읽은 text가 곧$output이 된다.
async function drain(
  readable: ReadableStream<Uint8Array>,
): Promise<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of readable) {
    buffer += decoder.decode(chunk, { stream: true });
  }
  return buffer;
}

Deno.test("coding-agent/mcp-server#R1: newline framing은 임의로 끊긴 chunk를 줄로 모은다", async () => {
  const pair = streams();
  const reader = startLineReader(pair.stdin);
  const writer = pair.incoming.getWriter();
  const encoder = new TextEncoder();
  const read = reader.next(); // 읽기가 먼저 대기한다.
  await writer.write(encoder.encode('{"a":'));
  await writer.write(encoder.encode('1}\n{"b":2}\n'));
  const first = await read;
  assertEquals(first, { kind: "line", line: '{"a":1}' });
  const second = await reader.next();
  assertEquals(second, { kind: "line", line: '{"b":2}' });
  await writer.close();
  const done = await reader.next();
  assertEquals(done.kind, "eof");
});

Deno.test("coding-agent/mcp-server#R1: 상한을 넘은 줄은 통째로 버리고 다음 줄은 살린다", async () => {
  const pair = streams();
  const reader = startLineReader(pair.stdin);
  const writer = pair.incoming.getWriter();
  const encoder = new TextEncoder();
  const big = "x".repeat(MAX_LINE_BYTES + 1);
  const read = reader.next();
  await writer.write(encoder.encode(`${big}\n{"b":2}\n`));
  await writer.close();
  assertEquals((await read).kind, "oversize");
  const next = await reader.next();
  assertEquals(next, { kind: "line", line: '{"b":2}' });
  assertEquals((await reader.next()).kind, "eof");
});

Deno.test("coding-agent/mcp-server#R1: newline 없이 끝난 마지막 줄은 빈 줄이 아니면 되돌린다", async () => {
  const pair = streams();
  const reader = startLineReader(pair.stdin);
  const writer = pair.incoming.getWriter();
  const first = reader.next(); // 읽기가 먼저 대기한다.
  const last = reader.next();
  await writer.write(new TextEncoder().encode('{"a":1}\n   '));
  await writer.close();
  assertEquals(await first, { kind: "line", line: '{"a":1}' });
  assertEquals((await last).kind, "eof");
});

Deno.test("coding-agent/mcp-server#R1: 메시지는 stdout에만 나가고 진단은 stderr에 redaction을 거쳐 나간다", async () => {
  const pair = streams();
  const redacted: string[] = [];
  const sink = createMessageSink(
    {
      stdin: pair.stdin,
      stdout: pair.stdout,
      stderr: pair.stderr,
    },
    (text) => {
      redacted.push(text);
      return text.replace(/sk-[A-Za-z0-9]+/g, "<redacted>");
    },
  );
  const out = drain(pair.outgoing);
  await sink.send('{"jsonrpc":"2.0"}');
  await sink.close();
  assertEquals(await out, '{"jsonrpc":"2.0"}\n');

  const diagnostics = firstChunk(pair.diagnostics);
  await sink.diagnose("openai key: sk-abc123");
  // redaction을 거친 값만 stderr에 나간다. secret이 stderr로 새지 않는다.
  const text = await diagnostics;
  assertEquals(text.includes("sk-abc123"), false);
  assertEquals(text, "openai key: <redacted>\n");
});
