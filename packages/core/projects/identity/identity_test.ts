import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
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
  type RequestContext,
  type Sql,
  TargetAuthorization,
  type Tx,
} from "../../../protocol/server/mod.ts";
import type { Writer } from "../../storage/ledger/mod.ts";
import { createProjectCommands } from "../registry/commands.ts";
import { PROJECT_CLONE_CONTEXT } from "../registry/contexts.ts";
import { loadProject } from "../registry/store.ts";
import { createFolderResolver } from "../registry/folder-resolver.ts";
import { folderResolverPort } from "../registry/ports.ts";
import {
  PROJECTS_FORMER_IDENTITY_STEPS,
  PROJECTS_IDENTITY_STEPS,
  PROJECTS_SEPARATED_STEPS,
  projectsSchemaSteps,
} from "../registry/schema.ts";
import type { GitReader } from "./git.ts";
import { nodeFolderProbe } from "./inspect.ts";
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

const silent = {
  log() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
  flush: () => Promise.resolve(),
};

// 실제 project 표와 command, 실제 임시 폴더. git은 가짜다: `.git`이 있는 폴더를 work tree로 본다.
function setup(
  answers: "git" | "fails" = "git",
  options: { isPrivate?: (project: string) => boolean } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "lophn-identity-"));
  const db = new DatabaseSync(":memory:");
  for (const step of [
    ...projectsSchemaSteps,
    ...PROJECTS_IDENTITY_STEPS,
    ...PROJECTS_FORMER_IDENTITY_STEPS,
    ...PROJECTS_SEPARATED_STEPS,
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
    remotes: () =>
      Promise.resolve([{ name: "origin", url: "git@github.com:me/notes.git" }]),
    head: () => Promise.resolve({ branch: null, commit: null }),
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
    fs: nodeFolderProbe,
    isPrivate: options.isPrivate ?? (() => false),
    ids,
    writer: () => writer,
    snapshot: (read) => read(sql),
    folders: createFolderResolver(),
    logger: silent,
  });
  const create = (
    folder: string | null,
    id = PROJECT,
    as: { ctx: RequestContext; identity?: string } = { ctx: user },
  ) =>
    commands.register.handle(
      tx,
      as.ctx,
      {
        id,
        name: `notes-${id.slice(-4)}`,
        title: "Notes",
        purpose: "",
        folders: folder === null ? [] : [{ path: folder, description: "" }],
        ...(as.identity === undefined ? {} : { identity: as.identity }),
      } as never,
      {},
    );
  const register = (folder: string | null, id = PROJECT) => {
    assert.ok(create(folder, id).ok);
  };
  const close = () => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  };
  return { root, sql, ids, service, create, register, close };
}

function gitFolder(root: string, name: string) {
  const folder = join(root, name);
  mkdirSync(join(folder, ".git"), { recursive: true });
  return folder;
}

test("등록은 새 id를 주고, clone 자격만 다른 기계의 id를 들고 오며, 이 기계의 다른 project가 지금이나 옛 identity로 가진 id는 받지 않는다", () => {
  const { root, sql, create, close } = setup();
  try {
    const project = (n: number) => `prj_0000000000000000000000000${n}`;
    const first = create(join(root, "a"), project(1));
    assert.ok(first.ok);
    assert.match(first.value.identity, /^pri_/);

    const brought = create(join(root, "b"), project(2), {
      ctx: PROJECT_CLONE_CONTEXT,
      identity: LOW,
    });
    assert.ok(brought.ok);
    assert.equal(brought.value.identity, LOW);

    const byPerson = create(join(root, "c"), project(3), {
      ctx: user,
      identity: "pri_01bbbbbbbbbbbbbbbbbbbbbbbb",
    });
    assert.equal(!byPerson.ok && byPerson.error.code, "invalid_input");

    const taken = create(join(root, "d"), project(4), {
      ctx: PROJECT_CLONE_CONTEXT,
      identity: LOW,
    });
    assert.equal(
      !taken.ok && taken.error.details?.["reason"],
      "identity_in_use",
    );

    // 옛 identity로 가진 id도 받지 않는다(사람이 나눈 project의 옛 id).
    sql.run("UPDATE projects SET former_identities = ? WHERE id = ?", [
      JSON.stringify(["pri_01cccccccccccccccccccccccc"]),
      project(1),
    ]);
    const former = create(join(root, "e"), project(5), {
      ctx: PROJECT_CLONE_CONTEXT,
      identity: "pri_01cccccccccccccccccccccccc",
    });
    assert.equal(
      !former.ok && former.error.details?.["reason"],
      "identity_in_use",
    );
    assert.equal(sql.get("SELECT count(*) AS n FROM projects", [])?.["n"], 2);
  } finally {
    close();
  }
});

test("git이 답하지 않는 project는 폴더에 `.git`이 있으면 unavailable이고 ledger를 바꾸지 않으며, `.git`이 없는 폴더만 git이 아닌 것으로 적힌다", async () => {
  for (const name of ["repo", "inside", "plain"] as const) {
    const { root, sql, service, register, close } = setup("fails");
    try {
      // inside: monorepo의 project 폴더처럼 `.git`이 위 폴더에만 있다.
      const folder =
        name === "repo"
          ? gitFolder(root, name)
          : name === "inside"
            ? join(gitFolder(root, "mono"), "app")
            : join(root, name);
      mkdirSync(folder, { recursive: true });
      register(folder);
      const project = loadProject(sql, PROJECT);
      assert.ok(project.ok && project.value !== null);
      const done = await service.reconcile(project.value);
      const row = sql.get("SELECT identity, repo FROM projects WHERE id = ?", [
        PROJECT,
      ]);
      assert.equal(row?.identity, project.value.identity, name);
      if (name === "plain") {
        assert.ok(done.ok, name);
        assert.equal(row?.repo, "none", name);
      } else {
        assert.equal(!done.ok && done.error.code, "unavailable", name);
        assert.equal(row?.repo, null, name);
      }
    } finally {
      close();
    }
  }
});

test("같은 저장소의 다른 project는 자동 match에 드는 것(active, git, 나누지 않음, private 아님)만 same_repository로 알린다", async () => {
  const COPY = "prj_00000000000000000000000002";
  for (const copyIsPrivate of [false, true]) {
    const { root, service, register, close } = setup("git", {
      isPrivate: (project) => copyIsPrivate && project === COPY,
    });
    try {
      register(gitFolder(root, "notes"));
      register(gitFolder(root, "copy"), COPY);
      const copy = await service.status(COPY);
      assert.ok(copy.ok);
      const status = await service.status(PROJECT);
      assert.ok(status.ok);
      assert.equal(
        status.value.same_repository,
        copyIsPrivate ? null : COPY,
        `copy private: ${copyIsPrivate}`,
      );
    } finally {
      close();
    }
  }
});
