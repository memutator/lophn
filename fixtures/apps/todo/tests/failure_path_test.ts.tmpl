// 선언한 problem code마다 실제 command의 실패 경로로 보고가 나가는지 본다. SDK 호출만 따로 부르는 test는
// 이 검사를 대신하지 못한다. 선언한 code를 더하면 그 code의 실패 경로 test를 여기에 하나 더한다.
import { assertEquals, assertRejects } from "@std/assert";
import { installProblemReporter } from "@lophn/cap-problem";
import { CommandRejection } from "@lophn/cap-schedule";
import {
  addTodoHandler,
  exportMarkdownHandler,
  importMarkdownHandler,
  listTodosHandler,
} from "../src/commands.ts";
import { defaults } from "../src/deps.ts";
import { depsAt, withPlace } from "./support.ts";

// 보고 통로는 진입점이 설치한다. test는 보고를 모으는 reporter를 같은 자리에 설치한다.
const reports: { code: string; details: unknown }[] = [];
installProblemReporter((code, details) => {
  reports.push({ code, details });
  return {
    report_id: "rpt_test",
    completion: Promise.resolve({
      status: "failed",
      reason: { code: "unavailable", message: "recorder" },
    }),
  };
});

// 열 수 없는 저장소. 원문 오류가 보고나 거절 문장에 새지 않는지도 본다.
const brokenStore = {
  ...defaults,
  openStore: () => {
    throw new Error("disk is on fire: /secret/path");
  },
  now: () => "2026-02-01T00:00:00.000Z",
};

// 읽고 쓸 수 없는 파일 접근(허락 문제가 아닌 실패).
const brokenFiles = {
  ...defaults,
  files: {
    readText: () => Promise.reject(new Error("io error: /secret/path")),
    writeText: () => Promise.reject(new Error("io error: /secret/path")),
  },
};

Deno.test("failure_path:store_unavailable list_todos reports the declared code when the store cannot be opened", async () => {
  reports.length = 0;
  const error = await assertRejects(
    async () => await listTodosHandler(brokenStore)(),
    CommandRejection,
  );
  assertEquals(error.code, "unavailable");
  assertEquals(error.message.includes("/secret/path"), false);
  assertEquals(reports, [{
    code: "store_unavailable",
    details: { command: "list_todos" },
  }]);
});

Deno.test("failure_path:store_unavailable add_todo reports the declared code when the store cannot be opened", async () => {
  reports.length = 0;
  await assertRejects(
    async () => await addTodoHandler(brokenStore)({ title: "x" }),
    CommandRejection,
  );
  assertEquals(reports, [{
    code: "store_unavailable",
    details: { command: "add_todo" },
  }]);
});

Deno.test("failure_path:file_unavailable export_markdown reports the declared code when the file cannot be written", async () => {
  await withPlace(async (place) => {
    reports.length = 0;
    const error = await assertRejects(
      async () =>
        await exportMarkdownHandler(
          depsAt(place, { files: brokenFiles.files }),
        )(
          { file: "todos.md" },
        ),
      CommandRejection,
    );
    assertEquals(error.code, "unavailable");
    assertEquals(error.message.includes("/secret/path"), false);
    assertEquals(reports, [{
      code: "file_unavailable",
      details: { command: "export_markdown" },
    }]);
  });
});

Deno.test("failure_path:file_unavailable import_markdown reports the declared code when the file cannot be read", async () => {
  reports.length = 0;
  const error = await assertRejects(
    async () => await importMarkdownHandler(brokenFiles)({ file: "todos.md" }),
    CommandRejection,
  );
  assertEquals(error.code, "unavailable");
  assertEquals(error.message.includes("/secret/path"), false);
  assertEquals(reports, [{
    code: "file_unavailable",
    details: { command: "import_markdown" },
  }]);
});
