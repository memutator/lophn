import { assertEquals } from "@std/assert";
import { err } from "../../base/mod.ts";
import {
  bodyChunk,
  decodeBodyCursor,
  decodeOutlineCursor,
  encodeBodyCursor,
  encodeOutlineCursor,
  estimatedTokens,
} from "./model.ts";

// estimated token은 Unicode codepoint 수를 3으로 나눈 올림이다(R6).
Deno.test("documents/outline-and-search#R6: estimated token은 codepoint 수를 3으로 나눈 올림이다", () => {
  assertEquals(estimatedTokens(0), 0);
  assertEquals(estimatedTokens(1), 1);
  assertEquals(estimatedTokens(2), 1);
  assertEquals(estimatedTokens(3), 1);
  assertEquals(estimatedTokens(4), 2);
  assertEquals(estimatedTokens(30), 10);
  // 한글 3글자는 codepoint 3개다.
  assertEquals(estimatedTokens([..."가나다"].length), 1);
  assertEquals(estimatedTokens([..."가나다라"].length), 2);
});

// 12,000 codepoint를 넘는 본문과 한 줄짜리 긴 본문 이어 읽기(R7).
Deno.test("documents/outline-and-search#R7: 12,000 codepoint를 넘는 본문을 겹침·누락 없이 이어 읽는다", () => {
  const first = "첫".repeat(8000);
  const second = "둘".repeat(8000);
  const lines = [first, second];
  const head = bodyChunk(lines, [1, 2], { line: 1, codepoint: 0 }, 12000);
  assertEquals(head.complete, false);
  // 첫 줄 전체(8000)와 붙임 줄바꿈(1)과 둘째 줄 앞 3999가 첫 조각이다(합 12000).
  // 연속 줄을 하나의 range로 묶는다.
  assertEquals(head.text, first + "\n" + second.slice(0, 3999));
  assertEquals([...head.text].length, 12000);
  assertEquals(head.ranges, [{ start_line: 1, end_line: 2 }]);
  const tail = bodyChunk(lines, [1, 2], head.position, 12000);
  assertEquals(tail.complete, true);
  // 첫 조각(12000)과 이어 읽기(4001)가 겹침·누락 없이 전체에 닿는다.
  assertEquals(head.text + tail.text, first + "\n" + second);
  assertEquals(tail.text, second.slice(3999));
  assertEquals(tail.ranges, [{ start_line: 2, end_line: 2 }]);
});

Deno.test("documents/outline-and-search#R7: 한 줄짜리 긴 본문을 codepoint 위치로 이어 읽는다", () => {
  const single = "한줄".repeat(9000);
  const lines = [single];
  const head = bodyChunk(lines, [1], { line: 1, codepoint: 0 }, 12000);
  assertEquals(head.complete, false);
  assertEquals(head.ranges, [{ start_line: 1, end_line: 1 }]);
  assertEquals([...head.text].length, 12000);
  const tail = bodyChunk(lines, [1], head.position, 12000);
  assertEquals(tail.complete, true);
  assertEquals([...tail.text].length, [...single].length - 12000);
  // 첫 조각 + 이어 읽기 = 원문. 겹침도 누락도 없다.
  assertEquals(head.text + tail.text, single);
});

Deno.test("documents/outline-and-search#R7: 예산 안 본문은 complete=true 하나로 끝난다", () => {
  const lines = ["a", "b", "c"];
  const chunk = bodyChunk(lines, [1, 2, 3], { line: 1, codepoint: 0 }, 12000);
  assertEquals(chunk.complete, true);
  assertEquals(chunk.ranges, [{ start_line: 1, end_line: 3 }]);
  assertEquals(chunk.text, "a\nb\nc");
});

// 본문 cursor. 조건 mismatch는 invalid_input, 원문이 바뀌면 conflict다(R8).
Deno.test("documents/outline-and-search#R8: 같은 cursor는 처음 판을 유지하고 다른 판 cursor는 invalid_input이다", () => {
  const position = {
    ver: "ver_01arz3ndektsv4rrffq69g5fav",
    module_hash: "a".repeat(64),
    section: null,
    include_children: false,
    ranges: [],
    line: 3,
    codepoint: 10,
    text_hash: "b".repeat(64),
  };
  const cursor = encodeBodyCursor(position);
  const same = decodeBodyCursor(cursor, {
    ver: position.ver,
    module_hash: position.module_hash,
    section: null,
    include_children: false,
    ranges: [],
    text_hash: "b".repeat(64),
  });
  assertEquals(same.ok, true);
  assertEquals(same.ok && same.value, { line: 3, codepoint: 10 });
  // 다른 판의 cursor는 invalid_input이다. 같은 cursor로 새 판을 읽지 않는다.
  const other = decodeBodyCursor(cursor, {
    ver: "ver_01arz3ndektsv4rrffq69g5fb0",
    module_hash: position.module_hash,
    section: null,
    include_children: false,
    ranges: [],
    text_hash: "b".repeat(64),
  });
  assertEquals(other.ok, false);
  if (!other.ok) assertEquals(other.error.code, "invalid_input");
  // 같은 판의 원문이 바뀌면 conflict다. basis가 만료다.
  const changed = decodeBodyCursor(cursor, {
    ver: position.ver,
    module_hash: position.module_hash,
    section: null,
    include_children: false,
    ranges: [],
    text_hash: "c".repeat(64),
  });
  assertEquals(changed.ok, false);
  if (!changed.ok) assertEquals(changed.error.code, "conflict");
  // 다른 범위·자식 조건도 invalid_input이다.
  const otherRange = decodeBodyCursor(cursor, {
    ver: position.ver,
    module_hash: position.module_hash,
    section: null,
    include_children: true,
    ranges: [],
    text_hash: "b".repeat(64),
  });
  assertEquals(otherRange.ok, false);
  if (!otherRange.ok) assertEquals(otherRange.error.code, "invalid_input");
});

Deno.test("documents/outline-and-search#R8: 깨진 cursor는 invalid_input이다", () => {
  const broken = decodeBodyCursor("not-base64!!", {
    ver: "ver_01arz3ndektsv4rrffq69g5fav",
    module_hash: "a".repeat(64),
    section: null,
    include_children: false,
    ranges: [],
    text_hash: null,
  });
  assertEquals(broken.ok, false);
  if (!broken.ok) assertEquals(broken.error.code, "invalid_input");
});

// 목록 cursor. 조건 mismatch는 invalid_input, basis 만료는 conflict다(R9).
Deno.test("documents/outline-and-search#R9: 목록 cursor는 조건 mismatch에 invalid_input, basis 만료에 conflict를 낸다", () => {
  const basis = {
    topic: "outline.place",
    basis_seq: "5",
    sort: "updated_desc",
    conditions: { place: { kind: "project", id: "prj_01arz3ndektsv4rrffq69g5fav" } },
    versions: [{ document: "doc_01arz3ndektsv4rrffq69g5fav", version: "ver_01arz3ndektsv4rrffq69g5fav" }],
    credential: "current",
  };
  const cursor = encodeOutlineCursor(basis, 10);
  const same = decodeOutlineCursor(cursor, {
    topic: basis.topic,
    basis_seq: basis.basis_seq,
    sort: basis.sort,
    conditions: basis.conditions,
    credential: basis.credential,
  });
  assertEquals(same.ok, true);
  assertEquals(same.ok && same.value, { offset: 10 });
  // 다른 조건은 invalid_input이다.
  const other = decodeOutlineCursor(cursor, {
    topic: basis.topic,
    basis_seq: basis.basis_seq,
    sort: "title_asc",
    conditions: basis.conditions,
    credential: basis.credential,
  });
  assertEquals(other.ok, false);
  if (!other.ok) assertEquals(other.error.code, "invalid_input");
  // 다른 credential도 invalid_input이다.
  const otherCredential = decodeOutlineCursor(cursor, {
    topic: basis.topic,
    basis_seq: basis.basis_seq,
    sort: basis.sort,
    conditions: basis.conditions,
    credential: "other",
  });
  assertEquals(otherCredential.ok, false);
  if (!otherCredential.ok) assertEquals(otherCredential.error.code, "invalid_input");
  // basis_seq가 지나갔으면 conflict다. 안정 기준이 없다.
  const expired = decodeOutlineCursor(cursor, {
    topic: basis.topic,
    basis_seq: "6",
    sort: basis.sort,
    conditions: basis.conditions,
    credential: basis.credential,
  });
  assertEquals(expired.ok, false);
  if (!expired.ok) assertEquals(expired.error.code, "conflict");
  // 깨진 cursor는 invalid_input이다.
  const broken = decodeOutlineCursor("@@@", {
    topic: basis.topic,
    basis_seq: basis.basis_seq,
    sort: basis.sort,
    conditions: basis.conditions,
    credential: basis.credential,
  });
  assertEquals(broken.ok, false);
  if (!broken.ok) assertEquals(broken.error.code, "invalid_input");
});

// err 헬퍼가 Result 약속을 유지하는지 본다. cursor decode가 같은 약속이다.
Deno.test("documents/outline-and-search#R9: decode 약속은 Result err 코드 하나다", () => {
  const failure = err({ code: "conflict", message: "outline page basis advanced" });
  assertEquals(failure.ok, false);
  if (!failure.ok) assertEquals(failure.error.code, "conflict");
  // encode는 빈 version이어도 canonical JSON 하나라 통과한다. 형식 검사는 decode 몫이다.
  encodeOutlineCursor({
    topic: "outline.place",
    basis_seq: "5",
    sort: "updated_desc",
    conditions: {},
    versions: [{ document: "", version: "" }],
    credential: "current",
  }, 0);
});
