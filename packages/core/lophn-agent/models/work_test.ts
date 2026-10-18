import { assert, assertEquals } from "@std/assert";
import type {
  ReadSnapshot,
  RequestContext,
} from "../../../protocol/server/mod.ts";
import { bundledSnapshot } from "./snapshot-catalog.ts";
import { createCatalogRead } from "./work.ts";

// derived 파일이 없거나 깨진 새 data root에서도 catalog 읽기가 snapshot으로 답한다.
// 오래 늘 unavailable이었는데 아무도 몰랐고, 그동안 모든 model 선택 칸이 비어 있었다.
for (
  const [name, derived] of [
    ["없을 때", null],
    ["깨졌을 때", "{not json"],
  ] as const
) {
  Deno.test(`derived catalog 파일이 ${name} snapshot의 model과 축을 돌려준다`, () => {
    const read = createCatalogRead({
      readDerived: () => derived,
      snapshot: bundledSnapshot,
    });
    const result = read.handle(
      { sql: {}, as_of_seq: 1 } as unknown as ReadSnapshot,
      { actor: "user" } as RequestContext,
      { provider_definition: "anthropic" },
    );
    assert(result.ok);
    const entry = result.value.entries.find((e) =>
      e.model_name === "claude-sonnet-4-5"
    );
    assert(entry !== undefined);
    assert(entry.options?.some((axis) => axis.id === "effort"));
    assertEquals(result.value.state.snapshot_hash, bundledSnapshot.hash);
  });
}

// 전체 catalog는 read 응답 한도(500 row)를 넘는다. page로 이으면 항목이 빠지거나 겹치지 않고 모두 온다.
Deno.test("catalog를 cursor로 이어 읽으면 snapshot 전체가 한도 안의 page로 온다", () => {
  const read = createCatalogRead({
    readDerived: () => null,
    snapshot: bundledSnapshot,
  });
  const names: string[] = [];
  let cursor: string | undefined;
  do {
    const result = read.handle(
      { sql: {}, as_of_seq: 1 } as unknown as ReadSnapshot,
      { actor: "user" } as RequestContext,
      cursor === undefined ? {} : { cursor },
    );
    assert(result.ok);
    assert(JSON.stringify(result.value).length < 1024 * 1024);
    names.push(
      ...result.value.entries.map((e) =>
        `${e.provider_definition}/${e.model_name}`
      ),
    );
    cursor = result.value.next_cursor ?? undefined;
  } while (cursor !== undefined);
  assertEquals(
    names,
    bundledSnapshot.entries.map((e) =>
      `${e.provider_definition}/${e.model_name}`
    ),
  );
});
