import assert from "node:assert/strict";
import { test } from "node:test";
import type { AppDeclaration } from "../declaration/mod.ts";
import { removedPublicOf } from "./public-tools.ts";

type Tool = AppDeclaration["commands"][number];

const tool = (name: string, pub: boolean, effect = "read"): Tool =>
  ({
    name,
    description: name,
    inputSchema: null,
    effect,
    public: pub,
  }) as Tool;

test("공개였다가 비공개가 된 tool도 지운 것이다", () => {
  const before = [tool("a", true), tool("b", true), tool("c", false)];
  const after = [tool("a", false), tool("b", true, "write"), tool("d", true)];
  assert.deepStrictEqual(removedPublicOf(before, after), ["a"]);
});
