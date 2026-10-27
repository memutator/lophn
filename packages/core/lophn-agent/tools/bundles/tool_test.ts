import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { ok } from "../../../../base/mod.ts";
import { defineTool } from "../define.ts";
import type { ToolContext } from "../tool-context.ts";
import { executeToolCall } from "../work.ts";
import { TOOL_TOOLS } from "./tool.ts";

// session 목록 밖 tool을 펼치면 role 목록과 할당이라는 권한 경계를 넘는다.
test("tool.load는 그 session의 숨긴 tool만 펼친다", async () => {
  const stub = (name: string) =>
    defineTool({
      name,
      description: name,
      effect: "read",
      input: z.strictObject({}),
      routes: [],
      handler: () =>
        Promise.resolve(
          ok({
            status: "success" as const,
            summary: name,
            content: null,
            complete: true,
            source: null,
            continuation: null,
            pending: [],
          }),
        ),
    });
  const ctx = {
    // 숨긴 것은 release.get, job.create, job.list, calendar_event_list다. job.extra와 file.read는 이미 실렸고
    // app.create는 이 session 목록에 없다.
    listed: [
      ...TOOL_TOOLS,
      ...["release.get", "job.create", "job.list", "calendar_event_list"].map(
        stub,
      ),
      ...["job.extra", "file.read"].map(stub),
    ],
    deferred: new Set([
      "release.get",
      "job.create",
      "job.list",
      "calendar_event_list",
    ]),
  } as unknown as ToolContext;
  const load = (names: string[]) =>
    executeToolCall(ctx, "tool_load", { names });
  const loaded = async (names: string[]) =>
    ((await load(names)).result.content as { tool_reference: string[] })
      .tool_reference;

  assert.deepStrictEqual(await loaded(["release_get"]), ["release_get"]);
  // 묶음은 숨긴 것만 펼친다. 같은 접두사의 job_extra는 이미 실렸다.
  assert.deepStrictEqual(await loaded(["job"]), ["job_create", "job_list"]);
  assert.deepStrictEqual(await loaded(["calendar", "job_list"]), [
    "calendar_event_list",
    "job_list",
  ]);
  assert.deepStrictEqual(
    (await load(["file_read"])).outcome.code,
    "invalid_input",
  );
  assert.deepStrictEqual(
    (await load(["job_extra"])).outcome.code,
    "invalid_input",
  );
  assert.deepStrictEqual(
    (await load(["tool_load"])).outcome.code,
    "invalid_input",
  );
  // 숨긴 것에 맞지 않는 묶음 이름과 session 목록 밖 tool은 not_found다.
  assert.deepStrictEqual((await load(["file"])).outcome.code, "not_found");
  assert.deepStrictEqual(
    (await load(["app_create"])).outcome.code,
    "not_found",
  );
  assert.deepStrictEqual((await load(["app"])).outcome.code, "not_found");
  // 하나라도 틀리면 전체가 실패한다.
  assert.deepStrictEqual(
    (await load(["release_get", "app_create"])).outcome.code,
    "not_found",
  );
});
