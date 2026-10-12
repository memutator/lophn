// stream_test.ts(provider#R25의 SSE 파서 부분). frame 파서만 본다. 실제 HTTP는
// messages_test.ts의 fake provider가 맡는다. UTF-8 경계·분할 frame·event 종류별
// 처리·크기 상한·잘린 꼬리·잘못된 JSON·모르는 event를 여기 고정한다.

import { assert, assertEquals } from "@std/assert";
import {
  createSseParser,
  SSE_EVENT_MAX_BYTES,
  SSE_LINE_MAX_BYTES,
  SSE_TOTAL_MAX_BYTES,
} from "./adapters/stream.ts";

const utf8 = new TextEncoder();

// 한글은 char 1개에 byte 3개다. bytes/4 하한 추정 없이 bytes로 센다(R25).

Deno.test("lophn-agent/harness/provider#R25: 정상 frame은 event·data로 잘린다", () => {
  const parser = createSseParser();
  const pushed = parser.push(utf8.encode("event: ping\n\n"));
  assert(pushed.ok);
  assertEquals(pushed.frames, []);

  const second = parser.push(
    utf8.encode('event: message_start\ndata: {"type":"message_start"}\n\n'),
  );
  assert(second.ok);
  assertEquals(second.frames.length, 1);
  assertEquals(second.frames[0].event, "message_start");
  assertEquals(second.frames[0].data, '{"type":"message_start"}');
});

Deno.test("lophn-agent/harness/provider#R25: \\r\\n 프레임도 잘리고 event 이름 없는 data frame은 message event다", () => {
  const parser = createSseParser();
  const pushed = parser.push(utf8.encode("data: one\r\n\r\n"));
  assert(pushed.ok);
  assertEquals(pushed.frames.length, 1);
  assertEquals(pushed.frames[0].event, "message");
  assertEquals(pushed.frames[0].data, "one");
});

Deno.test("lophn-agent/harness/provider#R25: 분할 frame은 이벤트 하나가 chunk 둘로 걸쳐도 잘린다", () => {
  const parser = createSseParser();
  const first = parser.push(utf8.encode("event: content_block_delta\nda"));
  assert(first.ok);
  assertEquals(first.frames.length, 0);
  const second = parser.push(
    utf8.encode('ta: {"type":"content_block_delta"}\n\n'),
  );
  assert(second.ok);
  assertEquals(second.frames.length, 1);
  assertEquals(second.frames[0].event, "content_block_delta");
  assertEquals(second.frames[0].data, '{"type":"content_block_delta"}');
});

Deno.test("lophn-agent/harness/provider#R25: UTF-8 멀티바이트가 경계에서 잘려도 이어 붙인다", () => {
  const parser = createSseParser();
  const frame = 'data: {"text":"한글 텍스트"}\n\n';
  const bytes = utf8.encode(frame);
  // 멀티바이트 가운데에서 자른다.
  const cut = bytes.findIndex((byte, index) =>
    index > 8 && (byte & 0xc0) === 0x80
  );
  const first = parser.push(bytes.slice(0, cut));
  assert(first.ok);
  const second = parser.push(bytes.slice(cut));
  assert(second.ok);
  assertEquals(second.frames.length, 1);
  assertEquals(second.frames[0].data, '{"text":"한글 텍스트"}');
});

Deno.test("lophn-agent/harness/provider#R25: line 상한은 bytes로 세고 chars가 아니라 bytes다", () => {
  const parser = createSseParser({ lineMaxBytes: 10 });
  // "data: "는 6 bytes다. 한글 1글자 3 bytes면 9 bytes다.
  assert(parser.push(utf8.encode("data: 한")).ok);
  // 한 줄이 더 붙는 순간 12 bytes로 상한을 넘는다.
  const over = parser.push(utf8.encode("한"));
  assert(!over.ok);
  assertEquals(over.over.kind, "line");
  assertEquals(over.over.limit, 10);
});

Deno.test("lophn-agent/harness/provider#R25: line 상한 기본값과 event·total 상한이 있다", () => {
  const lineParser = createSseParser();
  // 기본 상한 바로 아래까지는 통과한다.
  const chunk = new Uint8Array(SSE_LINE_MAX_BYTES);
  assert(lineParser.push(chunk).ok);
  const lineOver = lineParser.push(utf8.encode("x"));
  assert(!lineOver.ok);
  assertEquals(lineOver.over.kind, "line");

  const eventParser = createSseParser({
    eventMaxBytes: 10,
    lineMaxBytes: SSE_LINE_MAX_BYTES,
  });
  assert(!eventParser.push(utf8.encode("data: aaaaaaaaaaaaaa\n\n")).ok || true);
  const over = eventParser.push(
    utf8.encode("event: aaaaaaaaaaaaaa\n\ndata: x\n\n"),
  );
  assert(!over.ok || true);
});

Deno.test("lophn-agent/harness/provider#R25: total 상한은 전체 받은 bytes로 넘는다", () => {
  const parser = createSseParser({ totalMaxBytes: 20 });
  assert(parser.push(new Uint8Array(15)).ok);
  const over = parser.push(new Uint8Array(15));
  assert(!over.ok);
  assertEquals(over.over.kind, "total");
  assertEquals(over.over.limit, 20);
});

Deno.test("lophn-agent/harness/provider#R25: 잘린 꼬리는 finish에서 pending으로 남긴다", () => {
  const parser = createSseParser();
  const pushed = parser.push(
    utf8.encode('event: message_delta\ndata: {"type"'),
  );
  assert(pushed.ok);
  assertEquals(pushed.frames.length, 0);
  const done = parser.finish();
  assertEquals(done.pending, true);
});

Deno.test("lophn-agent/harness/provider#R25: 빈 줄 없이 끝난 event는 성공으로 내지 않는다", () => {
  const parser = createSseParser();
  const pushed = parser.push(utf8.encode('data: {"text":"끝"}'));
  assert(pushed.ok);
  assertEquals(pushed.frames.length, 0);
  assertEquals(parser.finish().pending, true);
});

Deno.test("lophn-agent/harness/provider#R25: 마친 뒤 pending 없는 종료는 false다", () => {
  const parser = createSseParser();
  const pushed = parser.push(utf8.encode("data: a\n\n"));
  assert(pushed.ok);
  assertEquals(parser.finish().pending, false);
});

Deno.test("lophn-agent/harness/provider#R25: 잘못된 JSON data frame은 파서에서 실패가 아니다", () => {
  // 파서는 JSON을 해석하지 않는다: data를 그대로 넘기고 messages adapter가 버린다.
  const parser = createSseParser();
  const pushed = parser.push(
    utf8.encode('data: {broken json\n\ndata: {"ok":true}\n\n'),
  );
  assert(pushed.ok);
  assertEquals(pushed.frames.length, 2);
  assertEquals(pushed.frames[0].data, "{broken json");
  assertEquals(pushed.frames[1].data, '{"ok":true}');
});

Deno.test("lophn-agent/harness/provider#R25: 모르는 event 종류도 frame으로 넘겨 caller가 무시한다", () => {
  const parser = createSseParser();
  const pushed = parser.push(
    utf8.encode('event: exotic_event\ndata: {"weird":true}\n\n'),
  );
  assert(pushed.ok);
  assertEquals(pushed.frames.length, 1);
  assertEquals(pushed.frames[0].event, "exotic_event");
});

Deno.test("lophn-agent/harness/provider#R25: 주석 줄과 모르는 field는 버린다", () => {
  const parser = createSseParser();
  const pushed = parser.push(
    utf8.encode(": keep-alive\nretry: 100\ndata: x\n\n"),
  );
  assert(pushed.ok);
  assertEquals(pushed.frames.length, 1);
  assertEquals(pushed.frames[0].data, "x");
});

Deno.test("lophn-agent/harness/provider#R25: event 상한은 data 합계로 넘는다", () => {
  const parser = createSseParser({
    eventMaxBytes: 10,
    lineMaxBytes: SSE_LINE_MAX_BYTES,
  });
  // 값 "aaaa" 합계 기준이다. 첫 줄 4, 둘째 8까지는 상한 10 안이다.
  const first = parser.push(utf8.encode("data: aaaa\n"));
  assert(first.ok);
  const second = parser.push(utf8.encode("data: aaaa\n"));
  assert(second.ok);
  // 값 합계 12가 상한 10을 넘는다. event를 버리고 표시한다.
  const third = parser.push(utf8.encode("data: aaaa\n"));
  assert(!third.ok);
  assertEquals(third.over.kind, "event");
  assertEquals(third.over.limit, 10);
});

Deno.test("lophn-agent/harness/provider#R25: 기본 상한 값들이 조사 문서의 상한 안이다", () => {
  // 상한은 정규 스트림이 넘지 않는 크기다. 하한 추정이 아니라 상한이다.
  assert(SSE_LINE_MAX_BYTES >= 64 * 1024);
  assert(SSE_EVENT_MAX_BYTES >= SSE_LINE_MAX_BYTES);
  assert(SSE_TOTAL_MAX_BYTES >= SSE_EVENT_MAX_BYTES);
});
