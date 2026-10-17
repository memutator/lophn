import { assertEquals } from "@std/assert";
import { appSourceScope } from "./place-data.ts";

Deno.test("앱 place의 Operator는 앱 source 폴더를 읽기만 하고 쓰지 못한다", () => {
  const source = "/work/app";
  assertEquals(appSourceScope("operator", source), {
    read: [source],
    write: [],
  });
  assertEquals(appSourceScope("app_engineer", source), {
    read: [source],
    write: [source],
  });
});
