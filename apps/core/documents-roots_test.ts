import { assertEquals } from "@std/assert";
import { workerSpecs } from "./documents.ts";

Deno.test("documents/file-tracking#R3: launch spec의 읽기·쓰기는 활성 root로 한정된다", () => {
  const specs = workerSpecs("/data/lophn", ["/work/notes", "/work/other"]);
  const coordinator = specs.find((spec) => spec.kind === "documents/worker");
  const preparation = specs.find((spec) =>
    spec.kind === "documents/preparation"
  );
  assertEquals(coordinator?.allow_read, [
    "/data/lophn",
    "/work/notes",
    "/work/other",
  ]);
  assertEquals(coordinator?.allow_write.includes("/work/notes"), true);
  assertEquals(preparation?.allow_read.includes("/work/other"), true);
  assertEquals(coordinator?.allow_net, []);
  assertEquals(preparation?.allow_net, []);
});

Deno.test("documents/file-tracking#R3: 활성 root가 없으면 data root만 허용한다", () => {
  const specs = workerSpecs("/data/lophn");
  const coordinator = specs.find((spec) => spec.kind === "documents/worker");
  assertEquals(coordinator?.allow_read, ["/data/lophn"]);
  assertEquals(
    coordinator?.allow_write.some((path) => path.startsWith("/work")),
    false,
  );
});
