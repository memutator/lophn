import { assertEquals } from "@std/assert";
import type { MaterialKind } from "../types.ts";
import type { Material } from "./manifest.ts";
import { relations } from "./save.ts";

const material = (
  ref: string,
  kind: MaterialKind,
  ids: Record<string, string>,
  needs: string[] = [],
): Material => ({
  ref,
  files: [],
  manifest: {
    kind,
    ids,
    needs,
    parent: null,
    content_hash: "",
    produced_by: null,
  },
});

// 자식 재료는 parent를 되살리지 않는다. parent의 needs가 빠지면 저장한 재료를 혼자 풀 때 앱이 빠진다.
Deno.test("부모가 있는 저장 재료는 부모의 needs를 가진다", () => {
  const parent = material("a@2", "active_app", { a: "app_a" }, ["pkg@1"]);
  const result = relations(
    [parent, material("b@1", "active_app", { b: "app_b" })],
    { a: "app_a" },
  );
  assertEquals(result, { parent: "a@2", needs: ["pkg@1", "b@1"] });
});
