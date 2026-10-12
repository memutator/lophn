// coding-agent#T15: 두 앱 fixture로 대상 앱 찾기가 scope를 넓히지 않고(connection#R11),
// 앱 source 밖으로 이어진 경로가 운영 data·다른 앱 source로 새지 않는지(connection#R10)
// 본다. 앱 하나 범위 문서 읽기는 packages/core/apps/connections/scope_test.ts가 실제 core로 본다.
import { assert, assertEquals } from "@std/assert";
import {
  copyFixture,
  removeFixtureCopy,
} from "../../../fixtures/projects/scenarios.ts";
import type { ConnectionScope } from "../../protocol/coding-agent/mod.ts";
import {
  resolveTargetApp,
  type TargetAppInputs,
  withinScope,
} from "./client/target-app.ts";
import { resolveSubmission } from "./submission.ts";

const APP_A = "app_01arz3ndektsv4rrffq69g5fav";
const APP_B = "app_01arz3ndektsv4rrffq69g5faw";

async function blueprintOf(folder: string): Promise<unknown> {
  return JSON.parse(await Deno.readTextFile(`${folder}/blueprint.json`));
}

Deno.test("coding-agent/connection#R11: 앱 폴더의 blueprint·환경 설정·명시 선택이 같은 앱을 찾는다", async () => {
  const root = await copyFixture("two-apps");
  try {
    const blueprintA = await blueprintOf(`${root}/app-a`);
    const blueprintB = await blueprintOf(`${root}/app-b`);
    const fromBlueprint = resolveTargetApp({ blueprintValue: blueprintA });
    assert(fromBlueprint.ok);
    assertEquals(fromBlueprint.value, { app: APP_A, source: "blueprint" });
    const fromEnv = resolveTargetApp({
      env: APP_A,
      blueprintValue: blueprintB,
    });
    assert(fromEnv.ok);
    assertEquals(fromEnv.value, { app: APP_A, source: "env" });
    const fromOption = resolveTargetApp({
      option: APP_A,
      env: APP_B,
      blueprintValue: blueprintB,
    });
    assert(fromOption.ok);
    assertEquals(fromOption.value, { app: APP_A, source: "option" });
  } finally {
    await removeFixtureCopy(root);
  }
});

Deno.test("coding-agent/connection#R11: 어떤 우선순위로 찾아도 앱 하나 연결의 scope를 넓히지 않고 범위 밖 앱은 같은 거절이다", async () => {
  const root = await copyFixture("two-apps");
  try {
    const blueprints: Record<string, unknown> = {
      A: await blueprintOf(`${root}/app-a`),
      B: await blueprintOf(`${root}/app-b`),
    };
    const apps: Record<string, string> = { A: APP_A, B: APP_B };
    const scopes: ConnectionScope[] = [
      { kind: "app", app: APP_A },
      { kind: "app", app: APP_B },
      { kind: "all", app: null },
    ];
    const marks = ["A", "B", undefined] as const;
    let rejected = 0;
    for (const option of marks) {
      for (const env of marks) {
        for (const blueprint of marks) {
          const inputs: TargetAppInputs = {
            ...(option === undefined ? {} : { option: apps[option] }),
            ...(env === undefined ? {} : { env: apps[env] }),
            ...(blueprint === undefined
              ? {}
              : { blueprintValue: blueprints[blueprint] }),
          };
          const found = resolveTargetApp(inputs);
          // 찾기는 가장 앞선 단서 하나만 쓴다. 뒤의 단서가 앞의 선택을 바꾸지 않는다.
          const first = option ?? env ?? blueprint;
          if (first === undefined) {
            assert(!found.ok);
            continue;
          }
          assert(found.ok);
          assertEquals(found.value.app, apps[first]);
          for (const scope of scopes) {
            const checked = withinScope(found.value, scope);
            if (scope.kind === "app" && scope.app !== found.value.app) {
              assert(!checked.ok);
              assertEquals(checked.error.code, "forbidden");
              rejected += 1;
              continue;
            }
            // 통과해도 찾은 앱 그대로다. 선택이 scope를 바꾸지 않는다.
            assert(checked.ok);
            assertEquals(checked.value.app, found.value.app);
          }
        }
      }
    }
    assert(rejected > 0);
  } finally {
    await removeFixtureCopy(root);
  }
});

Deno.test("coding-agent/connection#R10: 앱 source에서만 제출하고 data로 이어진 symlink·다른 앱 source·운영 data는 없는 파일과 같은 답으로 거절하며 경로가 새지 않는다", async () => {
  const root = await copyFixture("two-apps");
  const data = await Deno.makeTempDir({ prefix: "lophn-scope-data-" });
  try {
    await Deno.mkdir(`${data}/documents`, { recursive: true });
    await Deno.writeTextFile(`${data}/ledger.sqlite`, "SQLite format 3");
    await Deno.writeTextFile(`${data}/documents/secret.md`, "# 운영 문서\n");
    // 앱 source 안에 있지만 운영 data로 이어진 symlink(파일·폴더)와 다른 앱 source로 이어진 symlink.
    await Deno.symlink(`${data}/ledger.sqlite`, `${root}/app-a/docs/db.md`);
    await Deno.symlink(`${data}/documents`, `${root}/app-a/docs/data`);
    await Deno.symlink(`${root}/app-b/main.ts`, `${root}/app-a/docs/other.md`);
    const scope = {
      root: `${root}/app-a`,
      forbidden: [data, `${root}/app-b`],
    };
    const accepted = await resolveSubmission(
      [`${root}/app-a/docs/plan.md`],
      scope,
    );
    assert(accepted.ok);
    const missing = await resolveSubmission(
      [`${root}/app-a/docs/nothing.md`],
      scope,
    );
    assert(!missing.ok);
    for (
      const path of [
        `${root}/app-a/docs/db.md`,
        `${root}/app-a/docs/data/secret.md`,
        `${root}/app-a/docs/other.md`,
        `${root}/app-b/main.ts`,
        `${root}/app-b/docs/plan.md`,
        `${data}/ledger.sqlite`,
      ]
    ) {
      const denied = await resolveSubmission([path], scope);
      assert(!denied.ok, path);
      assertEquals(denied.error.code, missing.error.code);
      assertEquals(denied.error.message, missing.error.message);
      // 호출자가 준 경로만 돌아간다. 해석한 realpath와 금지 영역은 나오지 않는다.
      assertEquals(denied.error.details, { path });
      const text = JSON.stringify(denied.error);
      assert(!text.includes(data) || path.startsWith(data), path);
      assert(!text.includes("app-b") || path.includes("app-b"), path);
    }
  } finally {
    await removeFixtureCopy(root);
    await Deno.remove(data, { recursive: true });
  }
});
