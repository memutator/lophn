import { assertEquals } from "@std/assert";
import type { Blueprint } from "../blueprint/mod.ts";
import { removedPublicOf } from "./public-tools.ts";

type Tool = Blueprint["tools"][number];

const tool = (
  name: string,
  pub: boolean,
  effect = "read",
  domain = "alpha",
): Tool => ({
  name,
  title: name,
  description: name,
  inputSchema: null,
  effect,
  public: pub,
  domain,
} as Tool);

Deno.test("공개였다가 비공개가 된 tool도 지운 것이다", () => {
  const before = [tool("a", true), tool("b", true), tool("c", false)];
  const after = [tool("a", false), tool("b", true, "write"), tool("d", true)];
  assertEquals(removedPublicOf(before, after), ["a"]);
});
