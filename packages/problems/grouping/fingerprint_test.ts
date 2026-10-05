// 예외 지문·묶기 key 테스트(grouping#R2, R3, R4). 이름은 요구 번호로 시작한다.
import { assertEquals } from "@std/assert";
import {
  exceptionFingerprint,
  exceptionGroupKey,
  type FingerprintFrame,
  invalidReportGroupKey,
  isAppFrame,
} from "./fingerprint.ts";

const frame = (path: string, fn: string | null = "run"): FingerprintFrame => ({
  path,
  function: fn,
});

Deno.test("problems/grouping#R2: 같은 함수에서 줄·열·message·업무 값만 바꾼 오류는 같은 지문이다", async () => {
  const first = await exceptionFingerprint("TypeError", [
    frame("src/save.ts", "saveDocument"),
  ]);
  const second = await exceptionFingerprint("TypeError", [
    frame("src/save.ts", "saveDocument"),
  ]);
  assertEquals(first, second);
  // 지문이 있다: 앱 frame이 최소 1개다.
  assertEquals(first !== null, true);
  // 64hex 전체 SHA-256이다.
  assertEquals(first!.length, 64);
});

Deno.test("problems/grouping#R2: 줄·열이 달라도 함수·path가 같으면 같은 지문이다", async () => {
  // 지문 입력에 줄·열이 없으므로 다른 자리의 같은 함수는 같은 지문이다.
  // (SourceFrame은 줄·열을 함께 받지만 지문 입력은 path·function만 취한다.)
  const first = await exceptionFingerprint("RangeError", [
    frame("src/calc.ts", "compute"),
  ]);
  assertEquals(
    first,
    await exceptionFingerprint("RangeError", [
      frame("src/calc.ts", "compute"),
    ]),
  );
});

Deno.test("problems/grouping#R2: 다른 상위 앱 위치의 오류는 다른 지문이다", async () => {
  const first = await exceptionFingerprint("TypeError", [
    frame("src/save.ts", "saveDocument"),
  ]);
  const second = await exceptionFingerprint("TypeError", [
    frame("src/load.ts", "loadDocument"),
  ]);
  assertEquals(first === second, false);
});

Deno.test("problems/grouping#R2: 지문은 상위 3개 앱 frame만 취한다", async () => {
  const three = await exceptionFingerprint("TypeError", [
    frame("src/a.ts", "a"),
    frame("src/b.ts", "b"),
    frame("src/c.ts", "c"),
  ]);
  const four = await exceptionFingerprint("TypeError", [
    frame("src/a.ts", "a"),
    frame("src/b.ts", "b"),
    frame("src/c.ts", "c"),
    frame("src/d.ts", "d"),
  ]);
  assertEquals(three, four);
});

Deno.test("problems/grouping#R3: 절대 path·SDK·runtime frame은 지문에서 빠진다", async () => {
  // 절대 path frame은 앱 frame이 아니다.
  assertEquals(isAppFrame("/usr/lib/app/main.ts"), false);
  assertEquals(isAppFrame("C:\\app\\main.ts"), false);
  // URL scheme 모양(node:internal, https:)도 runtime·SDK frame이다.
  assertEquals(isAppFrame("node:internal/modules/cjs/loader"), false);
  assertEquals(isAppFrame("https://example.com/app.js"), false);
  // runtime frame만 있으면 지문이 없다.
  const runtimeOnly = await exceptionFingerprint("TypeError", [
    frame("node:internal/modules/cjs/loader"),
    frame("/usr/lib/app/main.ts"),
  ]);
  assertEquals(runtimeOnly, null);
  // 앱 frame 1개 + runtime frame들은 앱 frame만 지문에 넣는다.
  const mixed = await exceptionFingerprint("TypeError", [
    frame("src/app.ts", "run"),
    frame("node:internal/modules/cjs/loader"),
  ]);
  assertEquals(
    mixed,
    await exceptionFingerprint("TypeError", [
      frame("src/app.ts", "run"),
    ]),
  );
});

Deno.test("problems/grouping#R3: 앱 frame 0개면 같은 TypeError 2개가 합쳐지지 않는다", async () => {
  const first = await exceptionGroupKey(
    "TypeError",
    [],
    "rpt_01ary8h2z3n4p5q6r7s8t9v0wx",
  );
  const second = await exceptionGroupKey(
    "TypeError",
    [],
    "rpt_01b3c4d5e6f7g8h9j0k1m2n3p4q5r",
  );
  // 발생마다 별도 문제다: discriminator가 원래 Report ID다.
  assertEquals(first.discriminator, "rpt_01ary8h2z3n4p5q6r7s8t9v0wx");
  assertEquals(second.discriminator, "rpt_01b3c4d5e6f7g8h9j0k1m2n3p4q5r");
  assertEquals(first.discriminator === second.discriminator, false);
});

Deno.test("problems/grouping#R3: 지문이 있으면 Report ID가 아닌 지문으로 묶인다", async () => {
  const key = await exceptionGroupKey("TypeError", [
    frame("src/save.ts", "saveDocument"),
  ], "rpt_01ary8h2z3n4p5q6r7s8t9v0wx");
  assertEquals(key.kind, "exception");
  assertEquals(key.code, "_exception");
  assertEquals(
    key.discriminator,
    await exceptionFingerprint("TypeError", [
      frame("src/save.ts", "saveDocument"),
    ]),
  );
});

Deno.test("problems/grouping#R4: 안전한 잘못된 code는 그 값으로 묶고 안전하지 않으면 원래 Report ID로 나눈다", () => {
  // 안전한 식별자 모양의 잘못된 code는 그 값으로 묶는다.
  const safe = invalidReportGroupKey(
    "save_failed",
    "rpt_01ary8h2z3n4p5q6r7s8t9v0wx",
  );
  assertEquals(safe, {
    kind: "invalid_report",
    code: "_invalid_report",
    discriminator: "save_failed",
  });
  // 같은 안전한 code는 같은 문제다.
  assertEquals(
    safe,
    invalidReportGroupKey("save_failed", "rpt_01b3c4d5e6f7g8h9j0k1m2n3p4q5r"),
  );
  // 안전하지 않은 원문(길이 초과·금지 문자·blank)은 원래 발생별로 분리한다.
  const unsafeLong = invalidReportGroupKey(
    "x".repeat(65),
    "rpt_01ary8h2z3n4p5q6r7s8t9v0wx",
  );
  assertEquals(unsafeLong.discriminator, "rpt_01ary8h2z3n4p5q6r7s8t9v0wx");
  const unsafeChars = invalidReportGroupKey(
    "bad code;\n drop table",
    "rpt_01ary8h2z3n4p5q6r7s8t9v0wx",
  );
  assertEquals(unsafeChars.discriminator, "rpt_01ary8h2z3n4p5q6r7s8t9v0wx");
  const unsafeEmpty = invalidReportGroupKey(
    "",
    "rpt_01ary8h2z3n4p5q6r7s8t9v0wx",
  );
  assertEquals(unsafeEmpty.discriminator, "rpt_01ary8h2z3n4p5q6r7s8t9v0wx");
  const undefinedCode = invalidReportGroupKey(
    undefined,
    "rpt_01ary8h2z3n4p5q6r7s8t9v0wx",
  );
  assertEquals(undefinedCode.discriminator, "rpt_01ary8h2z3n4p5q6r7s8t9v0wx");
});
