import { assertEquals } from "@std/assert";
import { err, sha256Hex } from "../../../base/mod.ts";
import {
  bodyChunk,
  type ComparedVersion,
  compareSectionKey,
  compareSections,
  decodeBodyCursor,
  decodeOutlineCursor,
  encodeBodyCursor,
  encodeOutlineCursor,
  estimatedTokens,
  sectionChangeStatus,
  sectionHistory,
  type SectionSide,
  type SectionSnapshot,
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
    conditions: {
      place: { kind: "project", id: "prj_01arz3ndektsv4rrffq69g5fav" },
    },
    versions: [{
      document: "doc_01arz3ndektsv4rrffq69g5fav",
      version: "ver_01arz3ndektsv4rrffq69g5fav",
    }],
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
  if (!otherCredential.ok) {
    assertEquals(otherCredential.error.code, "invalid_input");
  }
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
  const failure = err({
    code: "conflict",
    message: "outline page basis advanced",
  });
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

// section-comparison 시험의 입력. body_hash는 본문의 실제 sha256이다.
const MODULE = "a".repeat(64);
async function side(
  key: string,
  position: number,
  body: string,
  title = key,
): Promise<SectionSide> {
  return { key, title, position, body_hash: await sha256Hex(body) };
}

function snapshot(
  sections: SectionSide[],
  module_hash = MODULE,
): SectionSnapshot {
  return { module_hash, sections };
}

Deno.test("documents/outline-and-search#R19: 같은 key는 변경 없음·본문 수정을, 한쪽에만 있는 key는 추가·소실을 낸다", async () => {
  const before = snapshot([
    await side("개요", 0, "그대로"),
    await side("계획", 1, "옛 계획"),
    await side("메모", 2, "곧 사라진다"),
  ]);
  const after = snapshot([
    await side("개요", 0, "그대로"),
    await side("계획", 1, "새 계획"),
    await side("부록", 2, "새로 생겼다"),
  ]);
  const compared = compareSections(before, after);
  assertEquals(compared.comparable, true);
  if (!compared.comparable) return;
  assertEquals(
    compared.changes.map((change) => [change.key, change.status]),
    [
      ["개요", "unchanged"],
      ["계획", "modified"],
      ["부록", "added"],
      ["메모", "missing"],
    ],
  );
  assertEquals(sectionChangeStatus(null, null), null);
  assertEquals(sectionChangeStatus("x", "x"), "unchanged");
});

Deno.test("documents/outline-and-search#R19: 이름이 바뀌면 옛 key 소실과 새 key 추가고 같은 본문이어도 대응하지 않는다", async () => {
  const body = "같은 본문 한 줄";
  const before = snapshot([await side("옛 이름", 0, body)]);
  const after = snapshot([await side("새 이름", 0, body, "새 이름")]);
  const compared = compareSections(before, after);
  assertEquals(compared.comparable, true);
  if (!compared.comparable) return;
  assertEquals(
    compared.changes.map((change) => [change.key, change.status]),
    [["새 이름", "added"], ["옛 이름", "missing"]],
  );
  // 같은 hash인 두 key를 짝짓거나 제목·유사도로 이름 변경을 추측하지 않는다.
  assertEquals(compared.changes[0].before, null);
  assertEquals(compared.changes[1].after, null);
  const single = compareSectionKey(before, after, "새 이름");
  assertEquals(single.comparable && single.change?.status, "added");
});

Deno.test("documents/outline-and-search#R19: 첫 판은 모든 section이 추가고 module이 다르면 비교하지 않는다", async () => {
  const first = compareSections(
    null,
    snapshot([await side("a", 0, "1"), await side("b", 1, "2")]),
  );
  assertEquals(first.comparable, true);
  if (first.comparable) {
    assertEquals(first.changes.map((change) => change.status), [
      "added",
      "added",
    ]);
  }
  const other = compareSections(
    snapshot([await side("a", 0, "1")]),
    snapshot([await side("a", 0, "1")], "b".repeat(64)),
  );
  assertEquals(other, { comparable: false, reason: "module_changed" });
});

Deno.test("documents/outline-and-search#R20: 소실 행은 살아 있는 행들 뒤에 모이고 앞 판의 순서를 따른다", async () => {
  const before = snapshot([
    await side("a", 0, "1"),
    await side("gone-1", 1, "2"),
    await side("b", 2, "3"),
    await side("gone-2", 3, "4"),
  ]);
  const after = snapshot([
    await side("n", 0, "5"),
    await side("a", 1, "1"),
    await side("b", 2, "changed"),
  ]);
  const compared = compareSections(before, after);
  assertEquals(compared.comparable, true);
  if (!compared.comparable) return;
  assertEquals(
    compared.changes.map((change) => [change.key, change.status]),
    [
      ["n", "added"],
      ["a", "unchanged"],
      ["b", "modified"],
      ["gone-1", "missing"],
      ["gone-2", "missing"],
    ],
  );
});

async function chainOf(
  bodies: (string | null)[],
): Promise<ComparedVersion<string>[]> {
  const chain: ComparedVersion<string>[] = [];
  for (let index = 0; index < bodies.length; index++) {
    const body = bodies[index];
    chain.push({
      version: `v${index + 1}`,
      format: "document",
      state: {
        kind: "ready",
        snapshot: snapshot(
          body === null ? [] : [await side("계획", 0, body)],
        ),
      },
    });
  }
  return chain;
}

Deno.test("documents/outline-and-search#R19: 한 key의 이력은 판마다 추가·수정·변경 없음·소실이고 둘 다 없는 판은 행이 없다", async () => {
  const chain = await chainOf([
    null,
    "처음",
    "처음",
    "고침",
    null,
    null,
    "다시",
  ]);
  const history = sectionHistory(chain, 0, "계획");
  assertEquals(
    history.rows.map((row) => [row.version, row.status]),
    [
      ["v2", "added"],
      ["v3", "unchanged"],
      ["v4", "modified"],
      ["v5", "missing"],
      ["v7", "added"],
    ],
  );
  assertEquals(history.omissions, []);
  const modified = history.rows[2];
  assertEquals(modified.before?.version, "v3");
  assertEquals(modified.after.version, "v4");
  const missing = history.rows[3];
  assertEquals(missing.before?.version, "v4");
  assertEquals(missing.after.side, null);
});

Deno.test("documents/outline-and-search#R20: 중간 판부터 잘라도 첫 행은 직전 판과 비교해 추가로 오판하지 않는다", async () => {
  const chain = await chainOf(["처음", "처음", "고침", "고침"]);
  // v3부터 보인다: chain[1]은 직전 판이고 행은 v3, v4만이다.
  const cropped = sectionHistory(chain.slice(1), 1, "계획");
  assertEquals(
    cropped.rows.map((row) => [row.version, row.status, row.before?.version]),
    [["v3", "modified", "v2"], ["v4", "unchanged", "v3"]],
  );
  // 직전 판 없이 첫 판으로 보면(잘못된 자름) 모두 추가로 오판한다는 대조.
  const naive = sectionHistory(chain.slice(2), 0, "계획");
  assertEquals(naive.rows[0].status, "added");
});

Deno.test("documents/outline-and-search#R22: 확인하지 못한 판은 행을 만들지 않고 그 판의 누락으로 남긴다", async () => {
  const chain = await chainOf(["처음", "처음", "고침"]);
  chain[1] = {
    ...chain[1],
    state: { kind: "unknown", reason: "extraction unverified" },
  };
  const history = sectionHistory(chain, 0, "계획");
  assertEquals(history.rows.map((row) => [row.version, row.status]), [[
    "v1",
    "added",
  ]]);
  assertEquals(history.omissions, [{
    version: "v2",
    reason: "extraction unverified",
  }]);
  // module이 바뀐 판 사이도 비교하지 않는다.
  const moved = await chainOf(["처음", "고침"]);
  moved[1] = {
    ...moved[1],
    state: {
      kind: "ready",
      snapshot: snapshot([await side("계획", 0, "고침")], "c".repeat(64)),
    },
  };
  const crossed = sectionHistory(moved, 1, "계획");
  assertEquals(crossed.rows, []);
  assertEquals(crossed.omissions, [{
    version: "v2",
    reason: "format module changed",
  }]);
});
