import { assertEquals } from "@std/assert";
import { z } from "zod";
import { ok } from "../../../../base/mod.ts";
import { defineTool } from "../define.ts";
import type { ToolContext } from "../tool-context.ts";
import { executeToolCall } from "../work.ts";
import { TOOL_TOOLS } from "./tool.ts";

// session 목록 밖 tool을 펼치면 role 목록과 할당이라는 권한 경계를 넘는다.
Deno.test("tool.load는 그 session의 숨긴 목록 밖 이름을 불러오지 못한다", async () => {
  const stub = (name: string) =>
    defineTool({
      name,
      description: name,
      effect: "read",
      input: z.strictObject({}),
      routes: [],
      handler: () =>
        Promise.resolve(ok({
          status: "success" as const,
          summary: name,
          content: null,
          complete: true,
          source: null,
          continuation: null,
          pending: [],
        })),
    });
  const ctx = {
    // release.get만 숨겼다. file.read는 이미 실렸고 app.create는 이 session 목록에 없다.
    listed: [...TOOL_TOOLS, stub("release.get"), stub("file.read")],
    deferred: new Set(["release.get"]),
  } as unknown as ToolContext;
  const load = (names: string[]) =>
    executeToolCall(ctx, "tool_load", { names });

  assertEquals((await load(["release_get"])).outcome.code, "ok");
  assertEquals((await load(["file_read"])).outcome.code, "invalid_input");
  assertEquals((await load(["app_create"])).outcome.code, "not_found");
  // 하나라도 틀리면 전체가 실패한다.
  assertEquals(
    (await load(["release_get", "app_create"])).outcome.code,
    "not_found",
  );
  assertEquals((await load(["tool_load"])).outcome.code, "invalid_input");
});
