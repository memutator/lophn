import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { domainsRetireStep, domainsSchemaSteps } from "./domains-retire.ts";
import {
  createIdSource,
  manualClock,
  seededRandom,
} from "../../../../base/mod.ts";

// 이 step은 ids를 쓰지 않지만 DataStep은 deps를 늘 받는다.
const stepDeps = {
  ids: createIdSource({ clock: manualClock(0), random: seededRandom(1) }),
};

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

async function setup(root: string) {
  const db = new DatabaseSync(join(root, "lophn.db"));
  for (const step of domainsSchemaSteps) db.exec(step.sql);
  db.close();
  await mkdir(join(root, "derived"), { recursive: true });
  await writeFile(join(root, "derived/kinds.sqlite"), "x");
}

const hasDomainsTable = (root: string) => {
  const db = new DatabaseSync(join(root, "lophn.db"));
  const found = db
    .prepare("select 1 from sqlite_master where name = 'domains'")
    .get();
  db.close();
  return found !== undefined;
};

// 사용자 file을 잃으면 안 된다: 옮기지 못해 남은 artifact와 skill이 든 폴더는 지우지 않는다.
test("domains.retire는 file이 남은 domains 폴더를 지우지 않고 표와 kinds.sqlite는 거둔다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-domains-retire-"));
  try {
    await setup(root);
    const stranded = join(root, "domains/dom_a/artifacts/report/index.html");
    await mkdir(join(stranded, ".."), { recursive: true });
    await writeFile(stranded, "mine");
    await mkdir(join(root, "domains/dom_b/skills"), { recursive: true });

    assert.deepStrictEqual(await domainsRetireStep.run(root, stepDeps), {
      ok: true,
      value: undefined,
    });

    assert.deepStrictEqual(await readFile(stranded, "utf8"), "mine");
    assert.deepStrictEqual(hasDomainsTable(root), false);
    assert.deepStrictEqual(
      await exists(join(root, "derived/kinds.sqlite")),
      false,
    );
    // 다시 돌아도 같다.
    assert.deepStrictEqual(
      (await domainsRetireStep.run(root, stepDeps)).ok,
      true,
    );
    assert.deepStrictEqual(await readFile(stranded, "utf8"), "mine");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
