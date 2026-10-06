// 업무 규칙(DB schema 0→1→2, 변경과 되돌림). 이 파일은 두 release 모두에서 돈다: schema 2가 더한 `due` 칸 test는
// migrations/1-2.sql이 있는 release에서만, 없는 release의 test는 그 반대로만 돈다.
import { assert, assertEquals, assertRejects } from "@std/assert";
import { CommandRejection, runWith } from "@lophn/cap-schedule";
import { openStore, type Store } from "@lophn/cap-store";
import {
  addTodoHandler,
  completeTodoHandler,
  listTodosHandler,
  revertTodoHandler,
} from "../src/commands.ts";
import type { Deps } from "../src/deps.ts";
import {
  DUE_SCHEMA,
  ensureSchema,
  getTodo,
  listTodos,
  migrations,
  revisionOf,
  schemaVersion,
} from "../src/todos.ts";
import { depsAt, NOW, type Place, withPlace } from "./support.ts";

const HAS_DUE = schemaVersion() >= DUE_SCHEMA;
const INVOCATIONS = [
  "inv_01h455vb4pex5v6nkc6gd5fdw1",
  "inv_01h455vb4pex5v6nkc6gd5fdw2",
  "inv_01h455vb4pex5v6nkc6gd5fdw3",
];

// handler를 한 invocation 안에서 부른다. 되돌림 근거에 들어가는 invocation이 이 값이다.
function inCall<T>(invocation: string, work: () => Promise<T>): Promise<T> {
  return runWith(
    { app: "app_a", release: "rel_a", mode: "test", invocation },
    work,
  );
}

type Evidence = {
  result: { id: number };
  revert?: { invocation: string; receipt: string; expected_revision: string };
};

function atPlace(place: Place): Store {
  return openStore({ host: { mode: "test", dataPath: place.data } });
}

// 업무 상태 전체. todo 칸·힌트·revision이 모두 같아야 같은 상태다.
function state(place: Place): unknown {
  const store = atPlace(place);
  try {
    return {
      todos: store.db.prepare("select * from todo order by id").all(),
      hints: store.db.prepare("select * from todo_hint order by id").all(),
      list: listTodos(store),
      revision: revisionOf(store),
    };
  } finally {
    store.close();
  }
}

Deno.test("apps/data#R3: 새 DB는 이 release의 마지막 migration까지 올라가고 실제 schema 번호와 마지막 결과를 가진다", async () => {
  await withPlace(async (place) => {
    const store = atPlace(place);
    assertEquals(store.schema(), 0);
    await ensureSchema(store);
    // 한 release의 schema는 migrations/의 마지막 단계 번호다(0→1 하나 또는 0→1→2 둘).
    assertEquals(store.schema(), schemaVersion());
    assertEquals(
      migrations().map((step) => `${step.from}-${step.to}`),
      HAS_DUE ? ["0-1", "1-2"] : ["0-1"],
    );
    const last = store.db
      .prepare("select data_schema, last_result from lophn_data_schema")
      .get();
    assertEquals(Number(last?.["data_schema"]), schemaVersion());
    assertEquals(last?.["last_result"], "applied");
    store.close();
  });
});

Deno.test({
  name:
    "apps/data#R6: schema 1 DB의 데이터는 1→2에서 그대로 남고 새 칸만 더해지며, 2단계가 중간에 실패하면 변경과 schema 번호가 함께 rollback된다",
  ignore: !HAS_DUE,
  fn: async () => {
    await withPlace(async (place) => {
      const store = atPlace(place);
      await store.migrate(migrations(), { target: 1 });
      store.db.prepare(
        "insert into todo (title, created_at, private_note) values (?, ?, ?)",
      ).run("Buy milk", NOW, "secret");
      assertEquals(store.schema(), 1);
      // 2단계가 끝에서 실패하면 앞의 SQL까지 되돌아간다.
      const [first, second] = migrations();
      await assertRejects(
        async () =>
          await store.migrate([
            first,
            {
              ...second,
              sql: `${second.sql}\nselect no_such_column from todo;`,
            },
          ]),
      );
      assertEquals(store.schema(), 1);
      const columns = store.db.prepare("pragma table_info(todo)").all().map((
        row,
      ) => row["name"]);
      assertEquals(columns.includes("due"), false);
      // 실제 1→2는 같은 행을 두고 칸 하나를 더한다.
      await ensureSchema(store);
      assertEquals(store.schema(), 2);
      assertEquals(listTodos(store).map((todo) => [todo.title, todo.due]), [
        ["Buy milk", null],
      ]);
      assertEquals(
        store.db.prepare("select private_note from todo").get()?.[
          "private_note"
        ],
        "secret",
      );
      store.close();
    });
  },
});

Deno.test({
  name:
    "apps/data#R3: schema 1 release는 due 칸 없이 동작하고 due 입력은 거절한다",
  ignore: HAS_DUE,
  fn: async () => {
    await withPlace(async (place) => {
      const deps = depsAt(place);
      await assertRejects(
        async () =>
          await addTodoHandler(deps)({
            title: "x",
            due: "2026-02-02T00:00:00Z",
          }),
        CommandRejection,
      );
      await addTodoHandler(deps)({ title: "plain" });
      const listed = await listTodosHandler(deps)();
      assertEquals(listed.rows.map((todo) => todo.due), [null]);
    });
  },
});

Deno.test("apps/blueprint#R21: add_todo는 되돌림 근거를 돌려주고 revert_todo가 변경 전 업무 상태로 되돌린다", async () => {
  await withPlace(async (place) => {
    const deps = depsAt(place);
    await addTodoHandler(deps)({ title: "Keep" });
    const before = state(place);
    const added = await inCall(
      INVOCATIONS[0],
      async () =>
        await addTodoHandler(deps)({ title: "Temp", private_note: "n" }),
    ) as unknown as Evidence;
    assert(added.revert);
    assertEquals(added.revert.invocation, INVOCATIONS[0]);
    assertEquals(added.revert.receipt, "change:2");
    // 변경 직후 revision이 근거의 expected_revision이다.
    assertEquals(
      added.revert.expected_revision,
      String(revisionOf(
        atPlace(place),
      )),
    );
    assertEquals((state(place) as { list: unknown[] }).list.length, 2);

    await revertTodoHandler(deps)(added.revert);
    assertEquals(state(place), before);
  });
});

Deno.test("apps/blueprint#R21: complete_todo도 되돌리면 같은 상태이고, 같은 근거를 두 번 쓰거나 뒤에 다른 변경이 있으면 거절하며 상태를 바꾸지 않는다", async () => {
  await withPlace(async (place) => {
    const deps = depsAt(place);
    const first = await inCall(
      INVOCATIONS[0],
      async () => await addTodoHandler(deps)({ title: "A" }),
    ) as unknown as Evidence;
    const afterAdd = state(place);
    const done = await inCall(
      INVOCATIONS[1],
      async () => await completeTodoHandler(deps)({ id: first.result.id }),
    ) as unknown as Evidence;
    assert(done.revert && first.revert);
    assertEquals(
      (state(place) as { list: { done: boolean }[] }).list[0].done,
      true,
    );

    // 뒤에 다른 변경(complete)이 있는 add는 되돌릴 수 없다.
    const stale = await assertRejects(
      async () => await revertTodoHandler(deps)(first.revert!),
      CommandRejection,
    );
    assertEquals(stale.code, "conflict");

    await revertTodoHandler(deps)(done.revert);
    assertEquals(state(place), afterAdd);

    // 같은 근거를 다시 쓰면 거절하고 상태는 그대로다.
    const settled = state(place);
    const twice = await assertRejects(
      async () => await revertTodoHandler(deps)(done.revert!),
      CommandRejection,
    );
    assertEquals(twice.code, "conflict");
    assertEquals(state(place), settled);

    // 알려 준 invocation·receipt와 다른 근거는 알 수 없는 근거다.
    for (
      const wrong of [
        { ...first.revert, invocation: INVOCATIONS[2] },
        { ...first.revert, receipt: "change:99" },
        { ...first.revert, receipt: "x" },
      ]
    ) {
      const error = await assertRejects(
        async () => await revertTodoHandler(deps)(wrong),
        CommandRejection,
      );
      assertEquals(error.code, "invalid_input");
    }
    // 이미 되돌린 변경 뒤이므로 첫 add는 이제 되돌릴 수 있다(원래 호출의 역순).
    await revertTodoHandler(deps)(first.revert);
    assertEquals((state(place) as { list: unknown[] }).list, []);
  });
});

Deno.test("apps/blueprint#R21: 한 번에 여러 변경을 호출 역순으로 되돌리면 처음 상태가 된다", async () => {
  await withPlace(async (place) => {
    const deps: Deps = depsAt(place);
    // 읽기가 DB를 이 release의 schema로 올린다. 그 빈 상태가 처음 상태다.
    await listTodosHandler(deps)();
    const initial = state(place);
    const calls: Evidence[] = [];
    for (const [index, title] of ["A", "B"].entries()) {
      calls.push(
        await inCall(
          INVOCATIONS[index],
          async () => await addTodoHandler(deps)({ title }),
        ) as unknown as Evidence,
      );
    }
    const done = await inCall(
      INVOCATIONS[2],
      async () => await completeTodoHandler(deps)({ id: calls[0].result.id }),
    ) as unknown as Evidence;
    for (const evidence of [done, calls[1], calls[0]]) {
      await revertTodoHandler(deps)(evidence.revert!);
    }
    assertEquals(state(place), initial);
    assertEquals(getTodo(atPlace(place), calls[0].result.id), undefined);
  });
});

Deno.test("apps/blueprint#R21: invocation이 없는 실행(release 없는 preview)은 되돌림 근거를 꾸미지 않는다", async () => {
  await withPlace(async (place) => {
    const added = await addTodoHandler(depsAt(place))({
      title: "x",
    }) as unknown as Evidence;
    assertEquals(added.revert, undefined);
    assertEquals(added.result.id, 1);
  });
});
