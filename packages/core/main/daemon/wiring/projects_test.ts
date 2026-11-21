import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import {
  createIdSource,
  manualClock,
  seededRandom,
} from "../../../../base/mod.ts";
import {
  PROJECTS_IDENTITY_STEPS,
  projectsSchemaSteps,
} from "../../../projects/registry/schema.ts";
import { applyDataSteps } from "../../../storage/migration/mod.ts";
import { projectsWiring } from "./projects.ts";

const HAD = "pri_01aaaaaaaaaaaaaaaaaaaaaaaa";

type Row = {
  name: string;
  status: "active" | "archived";
  repo: "git" | "none" | null;
  identity: string | null;
  folder: "plain" | "git" | null;
};

// 이 판 전의 data root에 있을 수 있는 project 모양들. git은 id file이 없던 git project, none-git은 git이 답하지 않아 none으로
// 적혔지만 `.git`이 있는 것이다.
const ROWS: Row[] = [
  {
    name: "plain",
    status: "active",
    repo: "none",
    identity: null,
    folder: "plain",
  },
  {
    name: "folderless",
    status: "active",
    repo: null,
    identity: null,
    folder: null,
  },
  {
    name: "archived",
    status: "archived",
    repo: "none",
    identity: null,
    folder: "plain",
  },
  { name: "git", status: "active", repo: "git", identity: null, folder: "git" },
  {
    name: "none-git",
    status: "active",
    repo: "none",
    identity: null,
    folder: "git",
  },
  { name: "had", status: "active", repo: "none", identity: HAD, folder: null },
];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "lophn-projects-step-"));
  const db = new DatabaseSync(join(root, "lophn.db"));
  for (const step of [...projectsSchemaSteps, ...PROJECTS_IDENTITY_STEPS]) {
    db.exec(step.sql);
  }
  ROWS.forEach((row, n) => {
    const id = `prj_0000000000000000000000000${n}`;
    db.prepare(
      "INSERT INTO projects (id, name, title, purpose, revision, status, identity, repo) VALUES (?, ?, 'T', '', '1', ?, ?, ?)",
    ).run(id, row.name, row.status, row.identity, row.repo);
    if (row.folder === null) return;
    const path = join(root, "folders", row.name);
    mkdirSync(join(path, row.folder === "git" ? ".git" : ""), {
      recursive: true,
    });
    db.prepare(
      "INSERT INTO project_folders (project, position, path, description) VALUES (?, 0, ?, '')",
    ).run(id, path);
  });
  db.close();
  return root;
}

function rows(root: string): Record<string, Record<string, unknown>> {
  const db = new DatabaseSync(join(root, "lophn.db"));
  try {
    return Object.fromEntries(
      db
        .prepare("SELECT name, status, repo, identity FROM projects")
        .all()
        .map((row) => [String(row.name), { ...row }]),
    );
  } finally {
    db.close();
  }
}

const identityOf = (root: string) =>
  Object.fromEntries(
    Object.entries(rows(root)).map(([name, row]) => [name, row["identity"]]),
  );

test("projects wiring의 data step은 옛 data root(앞 step을 돌았든 아니든)에서 id가 없는 모든 project에 서로 다른 id를 주고 가진 id와 다른 칸은 두며, 다시 돌아도 같고 새 root에서는 돌지 않는다", async () => {
  const steps = projectsWiring().dataSteps ?? [];
  const deps = {
    ids: createIdSource({ clock: manualClock(0), random: seededRandom(3) }),
  };
  const old = makeRoot();
  // 앞 판이 `projects.born-identity`까지 돈 root. git project는 그때 id를 얻지 못했다.
  const bornDone = makeRoot();
  writeFileSync(
    join(bornDone, "data-migrations.json"),
    `${JSON.stringify({ applied: ["projects.born-identity"] })}\n`,
  );
  const fresh = makeRoot();
  try {
    for (const [root, ran] of [
      [old, 2],
      [bornDone, 1],
    ] as const) {
      const before = rows(root);
      assert.deepEqual(await applyDataSteps(root, steps, false, deps), {
        ok: true,
        value: ran,
      });
      const after = rows(root);
      const given = ROWS.filter((row) => row.identity === null).map(
        (row) => after[row.name]?.["identity"],
      );
      for (const identity of given) assert.match(String(identity), /^pri_/);
      assert.equal(new Set(given).size, given.length, "distinct");
      assert.equal(after["had"]?.["identity"], HAD);
      for (const row of ROWS) {
        const { identity: _a, ...was } = before[row.name]!;
        const { identity: _b, ...now } = after[row.name]!;
        assert.deepEqual(now, was, row.name);
      }
      assert.deepEqual(await applyDataSteps(root, steps, false, deps), {
        ok: true,
        value: 0,
      });
      assert.deepEqual(rows(root), after);
    }

    const before = identityOf(fresh);
    assert.deepEqual(await applyDataSteps(fresh, steps, true, deps), {
      ok: true,
      value: 0,
    });
    assert.deepEqual(identityOf(fresh), before);
  } finally {
    rmSync(old, { recursive: true, force: true });
    rmSync(bornDone, { recursive: true, force: true });
    rmSync(fresh, { recursive: true, force: true });
  }
});
