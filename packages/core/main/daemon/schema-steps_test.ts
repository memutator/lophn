import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { sha256Hex } from "../../../base/mod.ts";
import { ROUTES } from "../../../protocol/registry.ts";
import {
  REMOTE_ALLOWED_ROUTES,
  REMOTE_COMPUTER_CORE_ROUTES,
  REMOTE_PERSON_ROUTES,
} from "../../../protocol/remote/mod.ts";
import { RouteRegistry, WORKSPACE_MEMORY_ROUTES } from "../../server/mod.ts";
import { TEAMS, WIRINGS } from "./assembly.ts";
import { stepContent } from "../../storage/migration/mod.ts";
import { assemble } from "./registration.ts";

// 낸 schema step의 id·순서·SQL hash를 schema-steps.lock.json에 얼려 둔다. 실제 data root(~/.lophn)는
// 적용된 step의 hash가 다르면 기동을 거절하므로, 낸 step을 고치면 사람의 ledger가 열리지 않는다.
//
// lock 갱신: step을 새로 더하는 같은 변경에서 lock 끝에 {id, sha256}을 덧붙인다(lock 앞쪽 줄은 고치지 않는다).
// 등록된 목록과 lock은 길이까지 같아야 한다. 덧붙이지 않으면 새 step의 hash가 얼지 않아 낸 뒤 고쳐도 모른다.
// sha256은 step.sql의 UTF-8 byte의 SHA-256 hex다. 이 test가 쓰는 목록(core.ts와 같은 순서)에서 뽑는다:
//   node --input-type=module -e 'import {createHash} from "node:crypto"; import {TEAMS,WIRINGS} from "./packages/core/main/daemon/assembly.ts"; import {assemble} from "./packages/core/main/daemon/registration.ts"; const w=WIRINGS.map(f=>f()); const a=assemble(TEAMS,{}); const s=[...w.flatMap(x=>x.schemaSteps??[]),...a.value.schemaSteps,...w.flatMap(x=>x.schemaStepsAfterTeams??[])]; for (const x of s) console.log(x.id, createHash("sha256").update(x.foreignKeys==="off"?"-- foreign_keys=off\n"+x.sql:x.sql).digest("hex"))'
const RULE =
  "낸 step은 고치지 말고 새 step을 더한다. 새 step의 {id, sha256}은 schema-steps.lock.json 끝에 덧붙인다.";

type Locked = { id: string; sha256: string };

// 팀 등록의 schemaSteps는 환경을 읽지 않으므로 빈 환경으로 조립해도 core 기동과 같은 목록이다.
async function registeredSteps(): Promise<Locked[]> {
  const wirings = WIRINGS.map((make) => make());
  const assembled = assemble(TEAMS, {});
  assert.ok(assembled.ok);
  const steps = [
    ...wirings.flatMap((wiring) => wiring.schemaSteps ?? []),
    ...assembled.value.schemaSteps,
    ...wirings.flatMap((wiring) => wiring.schemaStepsAfterTeams ?? []),
  ];
  return Promise.all(
    steps.map(async (step) => ({
      id: step.id,
      sha256: await sha256Hex(stepContent(step)),
    })),
  );
}

test("낸 schema step의 id·순서·hash는 lock과 같고 새 step은 끝에만 붙는다", async () => {
  const locked: Locked[] = JSON.parse(
    await readFile(
      new URL(
        "../../storage/migration/schema-steps.lock.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const registered = await registeredSteps();
  locked.forEach((entry, index) => {
    assert.deepStrictEqual(
      registered[index],
      entry,
      `${index}번째 step이 lock과 다르다(${entry.id}): 낸 step이 바뀌었다. ${RULE}`,
    );
  });
  assert.deepStrictEqual(
    registered.slice(locked.length).map((step) => step.id),
    [],
    `lock에 없는 새 step이 있다. ${RULE}`,
  );
});

// sandbox에서 core 기동 시험을 건너뛰어도 route 중복과 remote 허용 목록의 미등록 route를 check에서 바로 잡는다.
test("조립된 전체 route는 중복이 없고 remote 허용 목록의 모든 route를 포함한다", () => {
  const wirings = WIRINGS.map((make) => make());
  const env = Object.assign(
    {},
    ...wirings.map((wiring) =>
      wiring.environment?.({ root: { path: "/tmp" } } as never),
    ),
  );
  const assembled = assemble(TEAMS, env);
  assert.ok(assembled.ok);
  const allRoutes = [
    ...ROUTES,
    ...WORKSPACE_MEMORY_ROUTES,
    ...assembled.value.routes,
  ];
  assert.doesNotThrow(() => new RouteRegistry(allRoutes));
  const registered = new Set(
    allRoutes.map((route) => `${route.resource}/${route.method}`),
  );
  const missing = [
    ...REMOTE_ALLOWED_ROUTES,
    ...REMOTE_PERSON_ROUTES,
    ...REMOTE_COMPUTER_CORE_ROUTES,
  ]
    .map((route) => `${route.resource}/${route.method}`)
    .filter((key) => !registered.has(key));
  assert.deepStrictEqual(missing, []);
});
