import assert from "node:assert/strict";
import { test } from "node:test";
import { exampleMatches } from "./match.ts";

test("예시 비교는 core의 examples와 같은 규칙이다: 객체는 expect의 key만 보고 배열은 길이와 순서까지 같아야 한다", () => {
  const table: [string, unknown, unknown, boolean][] = [
    ["객체의 나머지 key는 무시", { a: 1 }, { a: 1, b: 2 }, true],
    ["expect의 key가 없음", { a: 1, c: 3 }, { a: 1 }, false],
    ["값이 다름", { a: 1 }, { a: 2 }, false],
    ["안쪽 객체도 같은 규칙", { a: { b: 1 } }, { a: { b: 1, c: 2 } }, true],
    ["배열은 길이가 같아야 함", [1], [1, 2], false],
    ["배열은 순서까지 같아야 함", [1, 2], [2, 1], false],
    ["배열 원소는 객체 규칙", [{ a: 1 }], [{ a: 1, b: 2 }], true],
    ["배열과 객체는 다름", { a: 1 }, [{ a: 1 }], false],
    ["null은 객체가 아님", { a: 1 }, null, false],
    ["원시 값은 ===", "1", 1, false],
  ];
  for (const [name, expect, actual, want] of table) {
    assert.ok(exampleMatches(expect, actual) === want, name);
  }
});
