import assert from "node:assert/strict";
import { test } from "node:test";
import { publicCommandsOf } from "./lookups.ts";

// 명함의 차이에 비공개 command가 보이면 부르는 agent가 못 부르는 것을 고른다.
test("명함의 command 차이는 비공개 command를 싣지 않는다", () => {
  const commands = [
    { name: "run", public: true },
    { name: "session usage", public: true },
    { name: "internal", public: false },
  ];
  assert.deepStrictEqual(publicCommandsOf("ops", commands), [
    { slug: "ops", name: "run" },
    { slug: "ops", name: "session usage" },
  ]);
});
