import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PLACE_KINDS,
  type PlaceKind,
  toWireToolName,
  WIRE_TOOL_NAME_PATTERN,
} from "../../protocol/lophn-agent/mod.ts";
import { placeToolNames } from "../../protocol/lophn-agent/tool-lists.ts";

// 이름이 겹치면 tool 실행이 다른 tool로 간다.
test("place kind tool wire names fit the provider rule and never collide", () => {
  for (const kind of PLACE_KINDS) {
    const names = placeToolNames(kind);
    const wire = names.map(toWireToolName);
    for (const name of wire) assert.ok(WIRE_TOOL_NAME_PATTERN.test(name), name);
    assert.deepStrictEqual(
      new Set(wire).size,
      wire.length,
      `${kind} has a collision`,
    );
    assert.deepStrictEqual(
      new Set(names).size,
      names.length,
      `${kind} lists twice`,
    );
  }
});

// `lophn` tool은 셋 다 받고, 작업 tool은 project와 app만 받는다.
test("each tool appears only in the place kinds that do its work", () => {
  const table: [string[], readonly PlaceKind[]][] = [
    [["lophn"], PLACE_KINDS],
    [
      ["file.write", "file.edit", "shell.run"],
      ["project", "app"],
    ],
  ];
  for (const [names, kinds] of table) {
    for (const kind of PLACE_KINDS) {
      for (const name of names) {
        assert.deepStrictEqual(
          placeToolNames(kind).includes(name),
          kinds.includes(kind),
          `${kind} ${name}`,
        );
      }
    }
  }
});
