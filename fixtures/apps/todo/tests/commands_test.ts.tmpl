// command 하나하나의 동작: 읽기, Markdown 내보내기·가져오기(파일 편집·변환), 캘린더 앱 호출(app.call).
import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  CommandRejection,
  PAIR_PORT,
  type PairPort,
  runWith,
} from "@lophn/cap-schedule";
import {
  addToCalendarHandler,
  addTodoHandler,
  completeTodoHandler,
  exportMarkdownHandler,
  importMarkdownHandler,
  listTodosHandler,
} from "../src/commands.ts";
import {
  DUE_SCHEMA,
  parseMarkdown,
  schemaVersion,
  toMarkdown,
} from "../src/todos.ts";
import { ADD_EVENT, CALENDAR_APP } from "../src/places.ts";
import { depsAt, withPlace } from "./support.ts";

Deno.test("apps/blueprint#R5: list_todos는 coverage·freshness와 함께 읽기만 하고 업무 상태를 바꾸지 않는다", async () => {
  await withPlace(async (place) => {
    const deps = depsAt(place);
    await addTodoHandler(deps)({ title: "A" });
    const first = await listTodosHandler(deps)();
    const second = await listTodosHandler(deps)();
    assertEquals(first, second);
    assertEquals(first.coverage, "complete");
    assertEquals(first.freshness, "fresh");
    assertEquals(first.rows.map((todo) => todo.title), ["A"]);
    // 비공개 메모는 읽기 결과에 없다.
    assertEquals(JSON.stringify(first).includes("private_note"), false);
  });
});

Deno.test("apps/permissions#R5: Markdown 내보내기는 export 폴더 파일로, 가져오기는 import 폴더 파일에서만 하고 비공개 메모는 내보내지 않는다", async () => {
  await withPlace(async (place) => {
    const deps = depsAt(place);
    await addTodoHandler(deps)({ title: "Buy milk", private_note: "SECRET" });
    const bread = await addTodoHandler(deps)({
      title: "Bake bread",
    }) as unknown as {
      result: { id: number };
    };
    await completeTodoHandler(deps)({ id: bread.result.id });

    const exported = await exportMarkdownHandler(deps)({ file: "todos.md" });
    assertEquals(exported, { file: "todos.md", count: 2 });
    const text = await Deno.readTextFile(`${place.exports}/todos.md`);
    assertEquals(text, "# Todos\n\n- [ ] Buy milk\n- [x] Bake bread\n");
    assertEquals(text.includes("SECRET"), false);

    // 가져오기는 import 폴더만 읽는다. export 폴더의 파일은 읽지 않는다.
    await assertRejects(
      async () => await importMarkdownHandler(deps)({ file: "todos.md" }),
      CommandRejection,
      "does not exist",
    );
    await Deno.writeTextFile(
      `${place.imports}/in.md`,
      "# Plan\n\n- [ ] Buy milk\n- [x] Pay rent\n* [ ] Call mom\nnot an item\n",
    );
    const imported = await importMarkdownHandler(deps)({ file: "in.md" });
    // 같은 제목(Buy milk)은 건너뛴다.
    assertEquals(imported, { added: 2, skipped: 1 });
    const titles = (await listTodosHandler(deps)()).rows.map((todo) => [
      todo.title,
      todo.done,
    ]);
    assert(
      titles.some(([title, done]) => title === "Pay rent" && done === true),
    );
    assert(titles.some(([title]) => title === "Call mom"));
  });
});

Deno.test("apps/permissions#R5: 파일 이름은 폴더 밖을 가리킬 수 없다", async () => {
  await withPlace(async (place) => {
    const deps = depsAt(place);
    for (
      const file of [
        "../escape.md",
        "sub/dir.md",
        "/abs/x.md",
        ".hidden.md",
        "x.txt",
      ]
    ) {
      const error = await assertRejects(
        async () => await exportMarkdownHandler(deps)({ file }),
        CommandRejection,
      );
      assertEquals(error.code, "invalid_input");
    }
  });
});

Deno.test("apps/permissions#R5: Markdown 변환은 체크리스트 줄만 읽고 쓴 목록을 그대로 다시 읽는다", () => {
  const todos = [
    {
      id: 2,
      title: "B",
      done: true,
      created_at: "",
      completed_at: "",
      due: null,
      hints: [],
    },
    {
      id: 1,
      title: "A",
      done: false,
      created_at: "",
      completed_at: null,
      due: null,
      hints: [],
    },
  ];
  assertEquals(parseMarkdown(toMarkdown(todos)), [
    { title: "A", done: false },
    { title: "B", done: true },
  ]);
  assertEquals(parseMarkdown("- plain\n- [ ]\n  - [X] Nested\n"), [
    { title: "Nested", done: true },
  ]);
});

// ---- 캘린더 앱 호출(apps/connections#R1): lophn의 앱 사이 호출 통로를 흉내 내는 대역이다. ----

type ConnectRequest = Parameters<PairPort["connect"]>[0];
type Direct = { endpoint: string; body: unknown; authorization: string };

function installCalendar(options: {
  grant: boolean;
  lost?: boolean;
}): { connects: ConnectRequest[]; directs: Direct[] } {
  const seen = { connects: [] as ConnectRequest[], directs: [] as Direct[] };
  (globalThis as Record<symbol, unknown>)[PAIR_PORT] = {
    connect: (request: ConnectRequest) => {
      seen.connects.push(request);
      return Promise.resolve(
        options.grant
          ? {
            status: 200,
            body: {
              endpoint: "/run/lophn/calendar.sock",
              connection: {
                app: CALENDAR_APP,
                release: "rel_01h455vb4pex5v6nkc6gd5fdw2",
                commands: [ADD_EVENT],
              },
              signature: "S".repeat(86),
            },
          }
          : {
            status: 404,
            body: { error: { code: "not_found", message: "app not found" } },
          },
      );
    },
    direct: (
      endpoint: string,
      request: { body?: unknown; authorization: string },
    ) => {
      seen.directs.push({
        endpoint,
        body: request.body,
        authorization: request.authorization,
      });
      if (options.lost) return Promise.reject(new Error("socket closed"));
      return Promise.resolve({
        status: 200,
        body: {
          result: { result: { event: 7 } },
          invocation: "inv_01h455vb4pex5v6nkc6gd5fdw9",
          mode: "live",
        },
      });
    },
    confirmRequest: () => Promise.reject(new Error("not used")),
    confirmPoll: () => Promise.reject(new Error("not used")),
  } satisfies PairPort;
  return seen;
}

function uninstallCalendar() {
  delete (globalThis as Record<symbol, unknown>)[PAIR_PORT];
}

const PARENT = "inv_01h455vb4pex5v6nkc6gd5fdw1";

Deno.test("apps/connections#R1: add_to_calendar는 blueprint에 선언한 캘린더 앱의 add_event 하나만 부르고 현재 호출을 부모로 넘긴다", async () => {
  await withPlace(async (place) => {
    const deps = depsAt(place);
    const todo = await addTodoHandler(deps)({
      title: "Dentist",
      ...(schemaVersion() >= DUE_SCHEMA
        ? { due: "2026-03-01T09:00:00.000Z" }
        : {}),
    }) as unknown as { result: { id: number } };
    const seen = installCalendar({ grant: true });
    try {
      const outcome = await runWith(
        { app: "app_a", release: "rel_a", mode: "live", invocation: PARENT },
        () =>
          addToCalendarHandler(deps)({
            id: todo.result.id,
            starts_at: "2026-03-02T10:00:00.000Z",
          }),
      );
      assertEquals(outcome, { requested: true, event: { event: 7 } });
      // 연결 요청은 선언한 앱과 command 하나뿐이다.
      assertEquals(seen.connects, [{
        app: CALENDAR_APP,
        commands: [ADD_EVENT],
        parent_invocation: PARENT,
      }]);
      assertEquals(seen.directs.length, 1);
      assertEquals(seen.directs[0].endpoint, "/run/lophn/calendar.sock");
      assertEquals(
        (seen.directs[0].body as { command: string; input: unknown }).command,
        ADD_EVENT,
      );
      assertEquals(
        (seen.directs[0].body as { input: unknown }).input,
        { title: "Dentist", starts_at: "2026-03-02T10:00:00.000Z" },
      );
    } finally {
      uninstallCalendar();
    }
  });
});

Deno.test("apps/connections#R1: 허락 없는 캘린더 호출은 거절되고, 시작 시각이 없으면 연결도 시도하지 않으며, 응답을 모르면 결과 모름으로 알린다", async () => {
  await withPlace(async (place) => {
    const deps = depsAt(place);
    const todo = await addTodoHandler(deps)({
      title: "No time",
    }) as unknown as {
      result: { id: number };
    };
    // 시작 시각을 알 수 없으면 캘린더 앱을 부르지 않는다.
    const seen = installCalendar({ grant: true });
    try {
      const noTime = await assertRejects(
        async () => await addToCalendarHandler(deps)({ id: todo.result.id }),
        CommandRejection,
      );
      assertEquals(noTime.code, "invalid_input");
      assertEquals(seen.connects, []);
      const missing = await assertRejects(
        async () =>
          await addToCalendarHandler(deps)({
            id: 999,
            starts_at: "2026-03-01T00:00:00Z",
          }),
        CommandRejection,
      );
      assertEquals(missing.code, "invalid_input");
    } finally {
      uninstallCalendar();
    }

    // 사람이 이 앱 쌍을 허락하지 않았다.
    const refused = installCalendar({ grant: false });
    try {
      const forbidden = await assertRejects(
        async () =>
          await addToCalendarHandler(deps)({
            id: todo.result.id,
            starts_at: "2026-03-01T00:00:00Z",
          }),
        CommandRejection,
      );
      assertEquals(forbidden.code, "forbidden");
      assertEquals(refused.directs, []);
    } finally {
      uninstallCalendar();
    }

    // 보낸 뒤 연결이 끊기면 일정이 만들어졌는지 모른다. 거절이 아니라 일반 오류이고 다시 부르지 않는다.
    const lost = installCalendar({ grant: true, lost: true });
    try {
      const error = await assertRejects(
        async () =>
          await addToCalendarHandler(deps)({
            id: todo.result.id,
            starts_at: "2026-03-01T00:00:00Z",
          }),
      );
      assertEquals(error instanceof CommandRejection, false);
      assertEquals(lost.directs.length, 1);
    } finally {
      uninstallCalendar();
    }
  });
});
