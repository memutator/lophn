import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
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

// 이 판 전의 data root에 있을 수 있는 project 모양들. none-git은 git이 답하지 않아 none으로 적혔지만 `.git`이 있는 것이다.
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

function identities(root: string): Record<string, unknown> {
  const db = new DatabaseSync(join(root, "lophn.db"));
  try {
    return Object.fromEntries(
      db
        .prepare("SELECT name, identity FROM projects")
        .all()
        .map((row) => [row.name, row.identity]),
    );
  } finally {
    db.close();
  }
}

test("projects wiring의 data step은 옛 data root에서 git이 아닌 것·폴더 없는 것·보관한 것에만 id를 주고, 다시 돌아도 같으며 새 root에서는 돌지 않는다", async () => {
  const steps = projectsWiring().dataSteps ?? [];
  const deps = {
    ids: createIdSource({ clock: manualClock(0), random: seededRandom(3) }),
  };
  const old = makeRoot();
  const fresh = makeRoot();
  try {
    assert.deepEqual(await applyDataSteps(old, steps, false, deps), {
      ok: true,
      value: 1,
    });
    const after = identities(old);
    for (const name of ["plain", "folderless", "archived"]) {
      assert.match(String(after[name]), /^pri_/, name);
    }
    assert.equal(
      new Set([after["plain"], after["folderless"], after["archived"]]).size,
      3,
    );
    assert.equal(after["git"], null);
    assert.equal(after["none-git"], null);
    assert.equal(after["had"], HAD);

    assert.deepEqual(await applyDataSteps(old, steps, false, deps), {
      ok: true,
      value: 0,
    });
    assert.deepEqual(identities(old), after);

    const before = identities(fresh);
    assert.deepEqual(await applyDataSteps(fresh, steps, true, deps), {
      ok: true,
      value: 0,
    });
    assert.deepEqual(identities(fresh), before);
  } finally {
    rmSync(old, { recursive: true, force: true });
    rmSync(fresh, { recursive: true, force: true });
  }
});
