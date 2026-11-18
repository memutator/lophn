import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";

import {
  createIdSource,
  manualClock,
  ok,
  seededRandom,
} from "../../../base/mod.ts";
import {
  PROJECT_IDENTITY_FILE,
  serializeIdentityFile,
} from "../../../protocol/projects/mod.ts";
import {
  type RequestContext,
  type Sql,
  TargetAuthorization,
  type Tx,
} from "../../../protocol/server/mod.ts";
import type { Writer } from "../../storage/ledger/mod.ts";
import { createProjectCommands } from "../registry/commands.ts";
import { assignBornIdentities, loadProject } from "../registry/store.ts";
import { createFolderResolver } from "../registry/folder-resolver.ts";
import { folderResolverPort } from "../registry/ports.ts";
import {
  PROJECTS_FORMER_IDENTITY_STEPS,
  PROJECTS_IDENTITY_STEPS,
  projectsSchemaSteps,
} from "../registry/schema.ts";
import { createIdentityFs, hasGitAbove } from "./file.ts";
import type { GitReader } from "./git.ts";
import { createIdentityService } from "./service.ts";

const user: RequestContext = {
  principal: "user",
  actor: "user",
  scope: { operations: [], targets: {} },
  conditions: {},
  credential_ref: "user",
};
const PROJECT = "prj_00000000000000000000000001";
const LOW = "pri_01aaaaaaaaaaaaaaaaaaaaaaaa";
const HIGH = "pri_01zzzzzzzzzzzzzzzzzzzzzzzz";

const silent = {
  log() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
  flush: () => Promise.resolve(),
};

// 실제 project 표와 command, 실제 임시 폴더. git은 가짜다: `.git`이 있는 폴더를 work tree로 본다.
function setup(answers: "git" | "fails" = "git") {
  const root = mkdtempSync(join(tmpdir(), "lophn-identity-"));
  const db = new DatabaseSync(":memory:");
  for (const step of [
    ...projectsSchemaSteps,
    ...PROJECTS_IDENTITY_STEPS,
    ...PROJECTS_FORMER_IDENTITY_STEPS,
  ]) {
    db.exec(step.sql);
  }
  const sql: Sql = {
    run: (query, params) => db.prepare(query).run(...params),
    get: (query, params) => db.prepare(query).get(...params) as never,
    all: (query, params) => db.prepare(query).all(...params) as never,
  };
  const ports = new Map<unknown, unknown>([
    [TargetAuthorization, () => ok(undefined)],
    [folderResolverPort, createFolderResolver()],
  ]);
  const ids = createIdSource({
    clock: manualClock(Date.parse("2026-11-16T00:00:00Z")),
    random: seededRandom(7),
  });
  const tx = {
    sql,
    port: (key: unknown) => ports.get(key),
    newId: (prefix: string) => ids.newId(prefix),
  } as unknown as Tx;
  const commands = createProjectCommands();
  const git: GitReader = {
    topLevel: (dir) =>
      Promise.resolve(
        answers === "git" && readdirSync(dir).includes(".git") ? dir : null,
      ),
    remotes: () => Promise.resolve([]),
    fileState: () => Promise.resolve("untracked"),
  };
  const writer = {
    command: (ctx, envelope) => {
      const done = commands.recordIdentity.handle(
        tx,
        ctx as RequestContext,
        envelope.input as never,
        {},
      );
      return Promise.resolve(
        done.ok ? ok({ result: done.value, replayed: false }) : done,
      );
    },
  } as Writer;
  const service = createIdentityService({
    git,
    fs: createIdentityFs(ids),
    ids,
    writer: () => writer,
    snapshot: (read) => read(sql),
    folders: createFolderResolver(),
    logger: silent,
  });
  const register = (folder: string | null, id = PROJECT) => {
    const done = commands.register.handle(
      tx,
      user,
      {
        id,
        name: `notes-${id.slice(-4)}`,
        title: "Notes",
        purpose: "",
        folders: folder === null ? [] : [{ path: folder, description: "" }],
      } as never,
      {},
    );
    assert.ok(done.ok);
  };
  const close = () => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  };
  return { root, sql, ids, service, register, close };
}

// 폴더 안 file 이름과 byte. `.git`은 가짜 표지라 뺀다.
function contents(folder: string): Record<string, string> {
  return Object.fromEntries(
    readdirSync(folder)
      .filter((name) => name !== ".git")
      .sort()
      .map((name) => [name, readFileSync(join(folder, name), "utf8")]),
  );
}

function gitFolder(root: string, name: string, files: Record<string, string>) {
  const folder = join(root, name);
  mkdirSync(join(folder, ".git"), { recursive: true });
  for (const [file, text] of Object.entries(files)) {
    writeFileSync(join(folder, file), text);
  }
  return folder;
}

test("create는 폴더에 .lophn-project.json 하나만 더하고 다른 file은 byte 그대로이며, file이 있으면(읽을 수 있든 없든) 그 byte를 바꾸지 않는다", async () => {
  const cases: { name: string; file: string | null; code?: string }[] = [
    { name: "absent", file: null },
    { name: "readable", file: serializeIdentityFile(HIGH) },
    {
      name: "newer",
      file: '{ "lophn_project": 2, "id": "x" }\n',
      code: "conflict",
    },
    { name: "garbage", file: "not json", code: "conflict" },
    { name: "empty", file: "", code: "conflict" },
  ];
  for (const one of cases) {
    const { root, service, register, close } = setup();
    try {
      const others = { "README.md": "# notes\n", "a.txt": "keep\r\nme" };
      const folder = gitFolder(root, one.name, {
        ...others,
        ...(one.file === null ? {} : { [PROJECT_IDENTITY_FILE]: one.file }),
      });
      register(folder);
      const done = await service.create(PROJECT);
      if (one.code === undefined) assert.ok(done.ok, one.name);
      else assert.equal(!done.ok && done.error.code, one.code, one.name);
      const after = contents(folder);
      const { [PROJECT_IDENTITY_FILE]: written, ...rest } = after;
      assert.deepEqual(rest, others, one.name);
      if (one.file === null) {
        assert.ok(done.ok);
        assert.equal(written, serializeIdentityFile(done.value.identity!));
      } else {
        assert.equal(written, one.file, one.name);
      }
    } finally {
      close();
    }
  }
});

test("renew와 충돌의 create만 file을 덮고, 충돌 file은 양쪽 순서와 상관없이 작은 id로 쓰인다", async () => {
  const side = (id: string) =>
    serializeIdentityFile(id).trim().split("\n").slice(1, -1).join("\n");
  const conflict = (ours: string, theirs: string) =>
    `{\n<<<<<<< HEAD\n${side(ours)}\n=======\n${side(theirs)}\n>>>>>>> other\n}\n`;
  for (const [name, text] of [
    ["low-first", conflict(LOW, HIGH)],
    ["high-first", conflict(HIGH, LOW)],
  ] as const) {
    const { root, service, register, close } = setup();
    try {
      const folder = gitFolder(root, name, { [PROJECT_IDENTITY_FILE]: text });
      register(folder);
      const read = await service.status(PROJECT);
      assert.ok(read.ok);
      assert.equal(read.value.file, "conflict");
      assert.equal(
        readFileSync(join(folder, PROJECT_IDENTITY_FILE), "utf8"),
        text,
      );
      const done = await service.create(PROJECT);
      assert.ok(done.ok, name);
      assert.equal(done.value.identity, LOW, name);
      assert.equal(
        readFileSync(join(folder, PROJECT_IDENTITY_FILE), "utf8"),
        serializeIdentityFile(LOW),
        name,
      );
    } finally {
      close();
    }
  }

  const { root, service, register, close } = setup();
  try {
    const folder = gitFolder(root, "renew", {
      [PROJECT_IDENTITY_FILE]: serializeIdentityFile(LOW),
    });
    register(folder);
    const renewed = await service.renew(PROJECT);
    assert.ok(renewed.ok);
    assert.notEqual(renewed.value.identity, LOW);
    assert.deepEqual(contents(folder), {
      [PROJECT_IDENTITY_FILE]: serializeIdentityFile(renewed.value.identity!),
    });
  } finally {
    close();
  }
});

test("폴더가 없거나 git이 아닌 폴더에서 create는 아무 file도 만들지 않는다", async () => {
  for (const name of ["missing", "plain", "none"] as const) {
    const { root, service, register, close } = setup();
    try {
      const folder = join(root, name);
      if (name === "plain") {
        mkdirSync(folder);
        writeFileSync(join(folder, "note.md"), "hi");
      }
      register(name === "none" ? null : folder);
      const done = await service.create(PROJECT);
      assert.equal(
        !done.ok && done.error.code,
        name === "plain" ? "invalid_input" : "not_found",
        name,
      );
      assert.deepEqual(
        readdirSync(root).sort(),
        name === "plain" ? ["plain"] : [],
      );
      if (name === "plain")
        assert.deepEqual(contents(folder), { "note.md": "hi" });
    } finally {
      close();
    }
  }
});

test("git이 아닌 폴더와 폴더 없는 project는 읽을 때 ledger에서 id를 얻고 다시 읽어도 그대로이며, git 폴더는 file 없이 id를 얻지 않는다", async () => {
  for (const name of ["plain", "folderless", "git"] as const) {
    const { root, service, register, close } = setup();
    try {
      const folder = join(root, name);
      if (name === "plain") mkdirSync(folder);
      if (name === "git") gitFolder(root, name, {});
      register(name === "folderless" ? null : folder);
      const first = await service.status(PROJECT);
      const again = await service.status(PROJECT);
      assert.ok(first.ok && again.ok, name);
      if (name === "git") {
        assert.equal(first.value.identity, null);
        assert.equal(first.value.file, "none");
      } else {
        assert.match(first.value.identity ?? "", /^pri_/, name);
        assert.equal(again.value.identity, first.value.identity, name);
        assert.equal(first.value.repo, "none", name);
        assert.equal(first.value.file, "none", name);
      }
      assert.deepEqual(
        readdirSync(root).sort(),
        name === "folderless" ? [] : [name],
      );
    } finally {
      close();
    }
  }
});

test("migration은 이전 판의 git이 아닌 project와 폴더 없는 project에만 서로 다른 id를 주고 git·`.git`이 있는 none·아직 읽지 않은 project와 이미 가진 id는 두며, 다시 돌아도 같다", () => {
  const { root, sql, ids, register, close } = setup();
  try {
    const project = (n: number) => `prj_0000000000000000000000000${n}`;
    const folder = (n: number) => {
      const path = join(root, `p${n}`);
      mkdirSync(path);
      return path;
    };
    // 1 git이 아님, 2 폴더 없음, 3 git(file 없음), 4 아직 읽지 않음, 5 git이 아니고 이미 id가 있음, 6 폴더 없고 보관됨,
    // 7 git이 답하지 않아 none으로 적혔지만 `.git`이 있음
    register(folder(1), project(1));
    register(null, project(2));
    register(folder(3), project(3));
    register(folder(4), project(4));
    register(folder(5), project(5));
    register(null, project(6));
    register(gitFolder(root, "p7", {}), project(7));
    const set = (n: number, column: string, value: string) =>
      sql.run(`UPDATE projects SET ${column} = ? WHERE id = ?`, [
        value,
        project(n),
      ]);
    set(1, "repo", "none");
    set(3, "repo", "git");
    set(5, "repo", "none");
    set(5, "identity", LOW);
    set(6, "status", "archived");
    set(7, "repo", "none");
    const identities = () =>
      Object.fromEntries(
        sql
          .all("SELECT id, identity FROM projects ORDER BY id", [])
          .map((row) => [row.id, row.identity]),
      );

    assert.equal(assignBornIdentities(sql, ids, hasGitAbove), 3);
    const after = identities();
    for (const n of [1, 2, 6]) {
      assert.match(String(after[project(n)]), /^pri_/, `project ${n}`);
    }
    assert.equal(
      new Set([1, 2, 6].map((n) => after[project(n)])).size,
      3,
      "distinct",
    );
    assert.equal(after[project(3)], null);
    assert.equal(after[project(4)], null);
    assert.equal(after[project(7)], null);
    assert.equal(after[project(5)], LOW);

    assert.equal(assignBornIdentities(sql, ids, hasGitAbove), 0);
    assert.deepEqual(identities(), after);
  } finally {
    close();
  }
});

test("git이 답하지 않는 project는 폴더에 `.git`이 있으면 unavailable이고 ledger를 바꾸지 않으며, `.git`이 없는 폴더만 git이 아닌 것으로 id를 얻는다", async () => {
  for (const name of ["repo", "inside", "plain"] as const) {
    const { root, sql, service, register, close } = setup("fails");
    try {
      // inside: monorepo의 project 폴더처럼 `.git`이 위 폴더에만 있다.
      const folder =
        name === "repo"
          ? gitFolder(root, name, {})
          : name === "inside"
            ? join(gitFolder(root, "mono", {}), "app")
            : join(root, name);
      mkdirSync(folder, { recursive: true });
      register(folder);
      const project = loadProject(sql, PROJECT);
      assert.ok(project.ok && project.value !== null);
      const done = await service.reconcile(project.value);
      const row = sql.get("SELECT identity, repo FROM projects WHERE id = ?", [
        PROJECT,
      ]);
      if (name === "plain") {
        assert.ok(done.ok, name);
        assert.match(String(row?.identity), /^pri_/, name);
        assert.equal(row?.repo, "none", name);
      } else {
        assert.equal(!done.ok && done.error.code, "unavailable", name);
        assert.deepEqual({ ...row }, { identity: null, repo: null }, name);
      }
    } finally {
      close();
    }
  }
});
