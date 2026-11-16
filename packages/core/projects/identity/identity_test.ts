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
import { createFolderResolver } from "../registry/folder-resolver.ts";
import { folderResolverPort } from "../registry/ports.ts";
import {
  PROJECTS_IDENTITY_STEPS,
  projectsSchemaSteps,
} from "../registry/schema.ts";
import { createIdentityFs } from "./file.ts";
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
function setup() {
  const root = mkdtempSync(join(tmpdir(), "lophn-identity-"));
  const db = new DatabaseSync(":memory:");
  for (const step of [...projectsSchemaSteps, ...PROJECTS_IDENTITY_STEPS]) {
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
  const tx = { sql, port: (key: unknown) => ports.get(key) } as unknown as Tx;
  const commands = createProjectCommands();
  const git: GitReader = {
    topLevel: (dir) =>
      Promise.resolve(readdirSync(dir).includes(".git") ? dir : null),
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
  const ids = createIdSource({
    clock: manualClock(Date.parse("2026-11-16T00:00:00Z")),
    random: seededRandom(7),
  });
  const service = createIdentityService({
    git,
    fs: createIdentityFs(ids),
    ids,
    writer: () => writer,
    snapshot: (read) => read(sql),
    folders: createFolderResolver(),
    logger: silent,
  });
  const register = (folder: string | null) => {
    const done = commands.register.handle(
      tx,
      user,
      {
        id: PROJECT,
        name: "notes",
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
  return { root, service, register, close };
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
