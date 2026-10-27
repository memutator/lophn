import assert from "node:assert/strict";
import { test } from "node:test";
import { ok } from "../../../base/mod.ts";
import type { ToolContext } from "../../lophn-agent/tools/spi.ts";
import { KIND_TOOLS } from "./kind.ts";

const MINE = "dom_01hzzzzzzzzzzzzzzzzzzzzzza";
const ALSO = "dom_01hzzzzzzzzzzzzzzzzzzzzzzb";
const OTHER = "dom_01hzzzzzzzzzzzzzzzzzzzzzzc";

// 자기 domain이 아닌 곳은 core를 부르지 않고 거절한다. 둘 이상인데 생략해도 거절이다.
test("kind tools refuse a domain outside ctx.domains without calling core", async () => {
  const calls: unknown[] = [];
  const ctxOf = (domains: string[]) =>
    ({
      domains,
      core: (route: unknown, input: unknown) => {
        calls.push([route, input]);
        return Promise.resolve(ok({}));
      },
    }) as unknown as ToolContext;
  const refused: [string[], string | undefined][] = [
    [[MINE, ALSO], OTHER],
    [[MINE, ALSO], undefined],
    [[], undefined],
  ];
  for (const [domains, domain] of refused) {
    for (const tool of KIND_TOOLS) {
      const base = tool.name === "kind.list" ? { kind: "receipt" } : {};
      const input = domain === undefined ? base : { ...base, domain };
      const result = await tool.handler!(input, ctxOf(domains));
      assert.deepStrictEqual(
        result.ok ? null : result.error.code,
        "invalid_input",
      );
    }
  }
  assert.deepStrictEqual(calls, []);
});
