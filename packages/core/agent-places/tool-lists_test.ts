import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PLACE_KINDS,
  type PlaceKind,
  toWireToolName,
  WIRE_TOOL_NAME_PATTERN,
} from "../../protocol/lophn-agent/mod.ts";
import { exposedToolNames, placeToolNames } from "./tool-lists.ts";

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
    // 목록에 없는 이름을 노출 정책에 두면 이름을 바꾼 tool이 말없이 숨는다.
    assert.deepStrictEqual(
      exposedToolNames(kind).filter((name) => !names.includes(name)),
      [],
      `${kind} exposes a tool it does not list`,
    );
  }
});

// 앱 진단 tool은 home과 app 종류가 받는다. `lophn` tool과 agent 정의 tool은 셋 다 받고, 작업 tool은 project와 app만,
// workflow.check는 project만, 앱 쓰기는 app만 받는다.
test("each tool appears only in the place kinds that do its work", () => {
  const table: [string[], readonly PlaceKind[]][] = [
    [
      ["app.tools", "app.status", "app.logs", "app.invocations"],
      ["home", "app"],
    ],
    [["lophn", "agent.create", "agent.update"], PLACE_KINDS],
    [
      ["file.write", "file.edit", "shell.run"],
      ["project", "app"],
    ],
    [
      ["kind.list", "kind.check"],
      ["project", "app"],
    ],
    [["workflow.check"], ["project"]],
    [
      [
        "app.link_source",
        "package.publish",
        "release.prepare",
        "release.activate",
        "preview.start",
        "preview.call",
        "preview.stop",
      ],
      ["app"],
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
