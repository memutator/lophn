// 관리 구간 갱신 시험이다(guides#R15, R16, T34). 관리 구간 안쪽만 바꾸는 시험이고
// HOME·project는 temp dir이다. 사람의 실제 설정 root는 열지 않는다.
import { assert, assertEquals, assertFalse } from "@std/assert";
import { err, ok } from "../../base/mod.ts";
import {
  GUIDE_BEGIN_MARKER,
  GUIDE_END_MARKER,
  guideRegionSpan,
  type ManagedFilesPort,
  updateGuideRegion,
} from "./managed-files.ts";

const PATH = "/app/AGENTS.md";

const BEFORE =
  "앞 사람 문장\n<!-- begin lophn-managed -->\n옛\n<!-- end lophn-managed -->\n뒤 사람 문장\n";

// bytes 그대로 쓰는 file 눈이다. read와 rename을 기록한다.
function eye(
  places: Map<string, Uint8Array>,
  reads: string[] = [],
  wrote: string[] = [],
): ManagedFilesPort {
  return {
    async readBytes(path) {
      await Promise.resolve();
      reads.push(path);
      const place = places.get(path);
      return place === undefined
        ? err({ code: "unavailable", message: "파일이 없다" })
        : ok(place);
    },
    async writeBytesAtomic(path, bytes) {
      await Promise.resolve();
      wrote.push(path);
      places.set(path, bytes);
      return ok(null);
    },
  };
}

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function textOf(place: Uint8Array): string {
  return new TextDecoder().decode(place);
}

Deno.test("coding-agent/guides#R15: 갱신은 짝이 맞는 관리 구간 하나의 내부만 바꾸고 앞뒤 사람 문장을 바이트 그대로 둔다", async () => {
  const places = new Map([[PATH, bytesOf(BEFORE)]]);
  const done = await updateGuideRegion(
    { guide: "새 안내", guidePath: PATH, guideOriginalBytes: bytesOf(BEFORE) },
    eye(places),
  );
  assert(done.ok);
  const whole = textOf(places.get(PATH)!);
  assertEquals(
    whole,
    "앞 사람 문장\n<!-- begin lophn-managed -->\n새 안내\n<!-- end lophn-managed -->\n뒤 사람 문장\n",
  );
  assertEquals(whole.split(GUIDE_BEGIN_MARKER).length - 1, 1);
  assertEquals(whole.split(GUIDE_END_MARKER).length - 1, 1);
});

Deno.test("coding-agent/guides#R15: 두 번 갱신해도 앞뒤 사람 문장이 동일하고 각 경계 오류에서 파일이 바뀌지 않는다", async () => {
  const places = new Map([[PATH, bytesOf(BEFORE)]]);
  const once = eye(places);
  const first = await updateGuideRegion(
    { guide: "첫 안내", guidePath: PATH, guideOriginalBytes: bytesOf(BEFORE) },
    once,
  );
  assert(first.ok);
  const afterFirst = textOf(places.get(PATH)!);
  const second = await updateGuideRegion(
    {
      guide: "둘째 안내",
      guidePath: PATH,
      guideOriginalBytes: bytesOf(afterFirst),
    },
    once,
  );
  assert(second.ok);
  const whole = textOf(places.get(PATH)!);
  assertEquals(whole.split(GUIDE_BEGIN_MARKER)[0], "앞 사람 문장\n");
  assertEquals(whole.split(GUIDE_END_MARKER)[1], "\n뒤 사람 문장\n");
  assert(whole.includes("둘째 안내"));
});

Deno.test("coding-agent/guides#R15: 불완전 경계(열리는 marker만)에서 파일이 바뀌지 않는다", async () => {
  const before = "앞\n<!-- begin lophn-managed -->\n뒤\n";
  const places = new Map([[PATH, bytesOf(before)]]);
  const wrote: string[] = [];
  const done = await updateGuideRegion(
    { guide: "새 안내", guidePath: PATH, guideOriginalBytes: bytesOf(before) },
    eye(places, [], wrote),
  );
  assertFalse(done.ok);
  assertEquals(wrote.length, 0);
  assertEquals(done.error.kind, "unterminated");
  assertEquals(textOf(places.get(PATH)!), before);
});

Deno.test("coding-agent/guides#R15: 닫는 marker만 있는 경계에서도 파일이 바뀌지 않는다", async () => {
  const before = "앞\n<!-- end lophn-managed -->\n뒤\n";
  const places = new Map([[PATH, bytesOf(before)]]);
  const wrote: string[] = [];
  const done = await updateGuideRegion(
    { guide: "새 안내", guidePath: PATH, guideOriginalBytes: bytesOf(before) },
    eye(places, [], wrote),
  );
  assertFalse(done.ok);
  assertEquals(wrote.length, 0);
  assertEquals(done.error.kind, "unterminated");
});

Deno.test("coding-agent/guides#R15: marker 중복에서 파일이 바뀌지 않는다", async () => {
  const before = BEFORE + BEFORE;
  const places = new Map([[PATH, bytesOf(before)]]);
  const wrote: string[] = [];
  const done = await updateGuideRegion(
    { guide: "새 안내", guidePath: PATH, guideOriginalBytes: bytesOf(before) },
    eye(places, [], wrote),
  );
  assertFalse(done.ok);
  assertEquals(wrote.length, 0);
  assertEquals(done.error.kind, "duplicate");
  assertEquals(textOf(places.get(PATH)!), before);
});

Deno.test("coding-agent/guides#R15: marker 순서가 맞지 않으면(짝 불일치) 파일이 바뀌지 않는다", async () => {
  const before =
    "앞\n<!-- end lophn-managed -->\n옛\n<!-- begin lophn-managed -->\n뒤\n";
  const places = new Map([[PATH, bytesOf(before)]]);
  const wrote: string[] = [];
  const done = await updateGuideRegion(
    { guide: "새 안내", guidePath: PATH, guideOriginalBytes: bytesOf(before) },
    eye(places, [], wrote),
  );
  assertFalse(done.ok);
  assertEquals(wrote.length, 0);
  assertEquals(done.error.kind, "pair_mismatch");
});

Deno.test("coding-agent/guides#R15: marker 없음에서는 복구 안내가 남고 파일이 바뀌지 않는다", async () => {
  const before = "# mine\n";
  const places = new Map([[PATH, bytesOf(before)]]);
  const wrote: string[] = [];
  const done = await updateGuideRegion(
    { guide: "새 안내", guidePath: PATH, guideOriginalBytes: bytesOf(before) },
    eye(places, [], wrote),
  );
  assertFalse(done.ok);
  assertEquals(wrote.length, 0);
  assertEquals(done.error.kind, "no_region");
  assert(done.error.message.includes("marker"));
});

Deno.test("coding-agent/guides#R16: 읽은 파일과 현재 파일이 다르면 충돌 안내와 무변경이 나온다", async () => {
  const before = BEFORE;
  const places = new Map([[PATH, bytesOf(BEFORE)]]);
  const wrote: string[] = [];
  // 사람이 읽기 븒에 변경을 넣은 현재 파일이다.
  const now = BEFORE + "사람이 추가했다\n";
  places.set(PATH, bytesOf(now));
  const done = await updateGuideRegion(
    { guide: "새 안내", guidePath: PATH, guideOriginalBytes: bytesOf(before) },
    eye(places, [], wrote),
  );
  assertFalse(done.ok);
  assertEquals(wrote.length, 0);
  assertEquals(textOf(places.get(PATH)!), now);
});

Deno.test("coding-agent/guides#R16: 교체 중단 뒤 불완전 본문이 남지 않는다(쓰기 실패는 무변경이다)", async () => {
  const places = new Map([[PATH, bytesOf(BEFORE)]]);
  const fails: ManagedFilesPort = {
    async readBytes(path) {
      await Promise.resolve();
      const place = places.get(path);
      return place === undefined
        ? err({ code: "unavailable", message: "파일이 없다" })
        : ok(place);
    },
    async writeBytesAtomic() {
      await Promise.resolve();
      return err({ code: "unavailable", message: "쓰기에 실패했다" });
    },
  };
  const done = await updateGuideRegion(
    { guide: "새 안내", guidePath: PATH, guideOriginalBytes: bytesOf(BEFORE) },
    fails,
  );
  assertFalse(done.ok);
  // 부분 본문이 남지 않는다: 원본이 그대로다.
  assertEquals(textOf(places.get(PATH)!), BEFORE);
});

Deno.test("coding-agent/guides#R16: 위치 탐색은 bytes 그대로 본다", () => {
  const span = guideRegionSpan(bytesOf(BEFORE));
  assert(span.ok);
  if (!span.ok) return;
  // UTF-8 멀티바이트 때문에 위치는 text 인덱스가 아니라 byte 인덱스다.
  assertEquals(
    span.span.begin,
    bytesOf(BEFORE.slice(0, BEFORE.indexOf(GUIDE_BEGIN_MARKER))).length,
  );
  assertEquals(
    span.span.end,
    bytesOf(
      BEFORE.slice(
        0,
        BEFORE.indexOf(GUIDE_END_MARKER) + GUIDE_END_MARKER.length,
      ),
    ).length,
  );
  const empty = guideRegionSpan(
    bytesOf("앞\n<!-- begin lophn-managed --><!-- end lophn-managed -->\n뒤\n"),
  );
  assert(empty.ok);
});
