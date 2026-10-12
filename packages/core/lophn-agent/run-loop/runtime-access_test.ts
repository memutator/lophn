import { assert, assertEquals } from "@std/assert";
import {
  contextContractRoute,
  contextGetRoute,
  contextListRoute,
  contextOverviewRoute,
  glossaryListRoute,
} from "../../../protocol/projects/mod.ts";
import { roleOperations } from "./runtime-access.ts";

const ROLES = ["lophn", "app_engineer", "context_engineer", "operator"];
const MATERIAL_READS = [
  contextListRoute,
  contextGetRoute,
  contextContractRoute,
  contextOverviewRoute,
  glossaryListRoute,
].map((route) => route.name);

Deno.test("lophn-agent/harness/prompt-assemble#R4 [ctx-I55b]: 네 역할의 operation 상한은 context 자료를 읽는 route를 한 번씩 읽기로 가진다", () => {
  for (const role of ROLES) {
    const operations = roleOperations(role);
    for (const name of MATERIAL_READS) {
      assertEquals(
        operations.filter((operation) => operation === name).length,
        1,
        `${role} ${name}`,
      );
    }
    // 자료 읽기만 더한다: 용어집 쓰기는 이 목록으로 열리지 않는다(Context Engineer는 자기 tool이 소유한다).
    if (role !== "context_engineer") {
      assert(!operations.includes("glossary.set"), role);
    }
  }
  assertEquals(roleOperations("unknown_role"), []);
});
