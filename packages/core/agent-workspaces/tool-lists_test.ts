import assert from "node:assert/strict";
import { test } from "node:test";
import {
  WORKSPACE_KINDS,
  type WorkspaceKind,
  toWireToolName,
  WIRE_TOOL_NAME_PATTERN,
} from "../../protocol/lophn-agent/mod.ts";
import { workspaceToolNames } from "../../protocol/lophn-agent/tool-lists.ts";

// 이름이 겹치면 tool 실행이 다른 tool로 간다.
test("workspace kind tool wire names fit the provider rule and never collide", () => {
  for (const kind of WORKSPACE_KINDS) {
    const names = workspaceToolNames(kind);
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

// `lophn`·`shell.run`과 파일 쓰기 tool(`file.write`·`file.edit`)은 세 workspace 종류가 모두 받는다(home 쓰기 범위는 workspaceScope가 가둔다).
test("each tool appears only in the workspace kinds that do its work", () => {
  const table: [string[], readonly WorkspaceKind[]][] = [
    [["lophn", "shell.run", "file.write", "file.edit"], WORKSPACE_KINDS],
  ];
  for (const [names, kinds] of table) {
    for (const kind of WORKSPACE_KINDS) {
      for (const name of names) {
        assert.deepStrictEqual(
          workspaceToolNames(kind).includes(name),
          kinds.includes(kind),
          `${kind} ${name}`,
        );
      }
    }
  }
});
