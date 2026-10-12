import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  CapabilityError,
  openStore,
  type RuntimeMode,
} from "../../../packages/sdk/cap-store/mod.ts";
import { openAppDatabase } from "../../../packages/core/apps/data/worker/db.ts";

const MOD =
  new URL("../../../packages/sdk/cap-store/mod.ts", import.meta.url).href;

const STEP_1 = {
  from: 0,
  to: 1,
  sql: "create table todo (id integer primary key, title text not null)",
};
const STEP_2 = {
  from: 1,
  to: 2,
  sql: "alter table todo add column done integer not null default 0",
};

async function withData<T>(work: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = await Deno.makeTempDir({ prefix: "cap-store-" });
  try {
    return await work(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

function hostAt(dataPath: string, mode: RuntimeMode = "preview") {
  return { mode, dataPath };
}

Deno.test("apps/sdk#R24: cap-store opens the app's own database in the data area and reads and writes it", async () => {
  await withData((dir) => {
    const store = openStore({ host: hostAt(dir) });
    store.db.exec("create table note (id integer primary key, body text)");
    store.db.prepare("insert into note (body) values (?)").run("hello");
    assertEquals(
      store.db.prepare("select body from note").get()?.["body"],
      "hello",
    );
    assertEquals(store.schema(), 0);
    store.close();
    assert(Deno.statSync(`${dir}/app.sqlite`).isFile);
  });
});

Deno.test("apps/sdk#R24: cap-store migration helper applies the continuous path in order and records the schema like the data worker", async () => {
  await withData(async (dir) => {
    const store = openStore({
      host: hostAt(dir),
      now: () => "2026-10-06T00:00:00.000Z",
    });
    // 순서를 섞어 줘도 현재 schema에서 이어지는 순서로 적용한다.
    assertEquals(await store.migrate([STEP_2, STEP_1]), 2);
    assertEquals(store.schema(), 2);
    store.db.prepare("insert into todo (title) values (?)").run("a");
    assertEquals(await store.migrate([STEP_1, STEP_2]), 2);
    store.close();
    // data worker가 같은 파일을 열어 같은 schema 번호와 마지막 결과를 본다.
    const opened = openAppDatabase(`${dir}/app.sqlite`);
    assert(opened.ok);
    const state = opened.value.schemaState();
    assertEquals(state.dataSchema, 2);
    assertEquals(state.lastResult, "applied");
    assert(state.scriptHash?.startsWith("sha256:"));
    opened.value.close();
  });
});

Deno.test("apps/sdk#R24: cap-store rolls back a failed migration step and keeps the earlier schema", async () => {
  await withData(async (dir) => {
    const store = openStore({ host: hostAt(dir) });
    await assertRejects(
      () =>
        store.migrate([STEP_1, {
          from: 1,
          to: 2,
          sql: "create table half (id integer); select * from nowhere",
        }]),
      CapabilityError,
    );
    assertEquals(store.schema(), 1);
    assertEquals(
      store.db.prepare(
        "select name from sqlite_master where name = 'half'",
      ).get(),
      undefined,
    );
    store.close();
  });
});

Deno.test("apps/sdk#R24: cap-store refuses a broken path, a backward target and a running app's schema change", async () => {
  await withData(async (dir) => {
    const store = openStore({ host: hostAt(dir) });
    await assertRejects(() => store.migrate([STEP_2]), CapabilityError);
    await store.migrate([STEP_1, STEP_2]);
    await assertRejects(
      () => store.migrate([STEP_1, STEP_2], { target: 1 }),
      CapabilityError,
    );
    await assertRejects(
      () => store.migrate([STEP_1, { ...STEP_1, to: 3 }]),
      CapabilityError,
    );
    store.close();

    const live = openStore({
      host: hostAt(dir, "live"),
      path: `${dir}/live.sqlite`,
    });
    // 이미 목표 schema이거나 바꿀 것이 없으면 아무 일도 하지 않는다.
    assertEquals(await live.migrate([]), 0);
    const refused = await assertRejects(
      () => live.migrate([STEP_1]),
      CapabilityError,
    );
    assertEquals(refused.code, "forbidden");
    assertEquals(live.schema(), 0);
    live.close();
  });
});

Deno.test("apps/sdk#R24: cap-store transaction commits on return and rolls back on throw or async work", async () => {
  await withData((dir) => {
    const store = openStore({ host: hostAt(dir) });
    store.db.exec("create table n (v integer)");
    store.transaction((db) => db.prepare("insert into n values (1)").run());
    assertThrows(() =>
      store.transaction((db) => {
        db.prepare("insert into n values (2)").run();
        throw new Error("stop");
      })
    );
    assertThrows(
      () =>
        store.transaction(
          ((db: { exec(sql: string): void }) => {
            db.exec("insert into n values (3)");
            return Promise.resolve();
          }) as never,
        ),
      CapabilityError,
    );
    assertEquals(
      store.db.prepare("select count(*) as c from n").get()?.["c"],
      1,
    );
    store.close();
  });
});

Deno.test("apps/sdk#R22 apps/sdk#R23: cap-store only reaches the data area the process was given", async () => {
  const data = await Deno.makeTempDir({ prefix: "cap-store-data-" });
  const other = await Deno.makeTempDir({ prefix: "cap-store-other-" });
  try {
    const script = `${data}/probe.ts`;
    // 자식 프로세스는 자기 data 영역에만 flag가 있다(실제 앱과 같은 방식).
    await Deno.writeTextFile(
      script,
      `import { openStore } from ${JSON.stringify(MOD)};
const out: Record<string, unknown> = {};
for (const [name, path] of [["own", ${
        JSON.stringify(`${data}/app.sqlite`)
      }], ["other", ${JSON.stringify(`${other}/app.sqlite`)}]]) {
  try { openStore({ path }).close(); out[name] = "opened"; }
  catch (error) {
    const e = error as { code?: string; permission?: string; scope?: unknown };
    out[name] = { code: e.code, permission: e.permission, scope: e.scope };
  }
}
console.log(JSON.stringify(out));`,
    );
    const output = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--no-prompt",
        "--no-config",
        "--no-lock",
        "--quiet",
        `--allow-read=${data}`,
        `--allow-write=${data}`,
        script,
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assert(output.success, new TextDecoder().decode(output.stderr));
    const result = JSON.parse(new TextDecoder().decode(output.stdout));
    assertEquals(result.own, "opened");
    assertEquals(result.other, {
      code: "forbidden",
      permission: "fs.write",
      scope: { path: `${other}/app.sqlite`, recursive: false },
    });
  } finally {
    await Deno.remove(data, { recursive: true });
    await Deno.remove(other, { recursive: true });
  }
});

Deno.test("apps/sdk#R22: cap-store without a host or path opens nothing", () => {
  const error = assertThrows(() => openStore(), CapabilityError);
  assertEquals(error.code, "unavailable");
});
