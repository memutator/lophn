import { assert, assertEquals } from "@std/assert";
import type { Result } from "../../base/mod.ts";
import type {
  AuthenticatedContext,
  SqlRow,
} from "../../contracts/platform/mod.ts";

// harness 값 타입만 선언한다. platform ledger 모듈을 type-check하지 않기 위해서다.
type CommandEnvelope = {
  command: string;
  input: unknown;
  idempotency_key: string;
  compare: unknown;
  prepared: readonly string[];
};
type CommandSuccess = { result: unknown; replayed: boolean };
type LedgerHarness = {
  command(
    ctx: AuthenticatedContext,
    envelope: CommandEnvelope,
  ): Promise<Result<CommandSuccess>>;
  read(
    route: { resource: string; method: string },
    ctx: AuthenticatedContext,
    input: unknown,
  ): Promise<Result<unknown>>;
  inspect(
    query: string,
    params?: readonly unknown[],
  ): Promise<Result<SqlRow[]>>;
  revokeCredential(credentialRef: string): Promise<Result<void>>;
  close(): Promise<void>;
};
async function createLedgerHarness(options: {
  registrationModules: readonly URL[];
  credentials: readonly AuthenticatedContext[];
}): Promise<Result<LedgerHarness>> {
  const specifier = "../../../apps/core/testing/ledger.ts";
  const harness = await import(specifier);
  return harness.createLedgerHarness(options);
}

const registration = new URL(
  "../../../apps/core/documents/projects.ts",
  import.meta.url,
);
const project = "prj_01arz3ndektsv4rrffq69g5fav";
const other = "prj_01arz3ndektsv4rrffq69g5faw";
const operations = [
  "project.create",
  "project.update",
  "project.archive",
  "project.unarchive",
  "project.list",
  "project.get",
  "project.resolve",
  "CommandResult",
];

function credential(actor = "user"): AuthenticatedContext {
  return {
    actor,
    principal: "test-user",
    credential_ref: `test:test-user:${actor}`,
    scope: { operations, targets: {} },
    conditions: {},
  };
}

const user = credential();
const tracking = {
  enabled: false,
  patterns: [{ effect: "include", glob: "**/*.md" }],
  use_gitignore: true,
};
const folders = [
  { path: "/work/notes", description: "outer" },
  { path: "/work/notes/deep", description: "inner" },
];

function value<T>(result: Result<T>): T {
  assert(result.ok, result.ok ? undefined : JSON.stringify(result.error));
  return result.value;
}

function commandResult(result: Result<CommandSuccess>): CommandSuccess {
  return value(result);
}

function rows(result: Result<SqlRow[]>): SqlRow[] {
  return value(result);
}

function code(result: Result<unknown>, expected: string) {
  assert(!result.ok);
  assertEquals(result.error.code, expected);
}

function envelope(
  command: string,
  key: string,
  input: unknown,
  compare: unknown = {},
): CommandEnvelope {
  return {
    command,
    input,
    compare,
    idempotency_key: key,
    prepared: [],
  };
}

async function harness(
  credentials: readonly AuthenticatedContext[] = [user],
): Promise<LedgerHarness> {
  return value(
    await createLedgerHarness({
      registrationModules: [registration],
      credentials,
    }),
  );
}

async function create(opened: LedgerHarness, id = project, name = "notes") {
  return await opened.command(
    user,
    envelope("project.create", `create-${id}`, {
      id,
      name,
      title: "Notes",
      purpose: "keep notes",
      folders,
      tracking,
    }),
  );
}

Deno.test("documents/projects#R1: public command path rejects nonuser actors", async () => {
  const opened = await harness([
    user,
    credential("agent:asg_01arz3ndektsv4rrffq69g5fav"),
    credential("app:app_01arz3ndektsv4rrffq69g5fav"),
    credential("machine"),
  ]);
  try {
    for (
      const actor of [
        "agent:asg_01arz3ndektsv4rrffq69g5fav",
        "app:app_01arz3ndektsv4rrffq69g5fav",
        "machine",
      ]
    ) {
      code(
        await opened.command(
          credential(actor),
          envelope("project.create", `create-${actor}`, {
            id: project,
            name: "notes",
            title: "Notes",
            purpose: "keep notes",
            folders: [],
            tracking: { enabled: false, patterns: [], use_gitignore: false },
          }),
        ),
        "forbidden",
      );
    }
    assertEquals(
      rows(await opened.inspect("select id from projects", [])),
      [],
    );
  } finally {
    await opened.close();
  }
});

Deno.test("documents/projects#R1: current credential scope gates the command", async () => {
  const narrow = {
    ...user,
    credential_ref: "test:test-user:narrow",
    scope: { operations: ["project.list"], targets: {} },
  };
  const opened = await harness([user, narrow]);
  try {
    code(
      await opened.command(
        narrow,
        envelope("project.create", "narrow-create", {
          id: project,
          name: "notes",
          title: "Notes",
          purpose: "keep notes",
          folders: [],
          tracking: { enabled: false, patterns: [], use_gitignore: false },
        }),
      ),
      "forbidden",
    );
    const created = commandResult(await create(opened));
    assertEquals(created.replayed, false);
    const replayed = commandResult(await create(opened));
    assertEquals(replayed.replayed, true);
    assertEquals(replayed.result, created.result);
  } finally {
    await opened.close();
  }
});

Deno.test("documents/projects#R2: public create keeps zero folders and no default project", async () => {
  const opened = await harness();
  try {
    assertEquals(
      rows(await opened.inspect("select id from projects", [])),
      [],
    );
    commandResult(await create(opened));
    const empty = commandResult(
      await opened.command(
        user,
        envelope("project.create", "create-empty", {
          id: other,
          name: "empty",
          title: "Empty",
          purpose: "",
          folders: [],
          tracking: { enabled: false, patterns: [], use_gitignore: false },
        }),
      ),
    );
    const result = empty.result as { folders: unknown[] };
    assertEquals(result.folders, []);
    const stored = rows(
      await opened.inspect(
        "select path, position from project_folders where project = ? order by position",
        [project],
      ),
    );
    assertEquals(stored.map((row) => row.path), [
      "/work/notes",
      "/work/notes/deep",
    ]);
    assertEquals(Number(stored[0]?.position), 0);
  } finally {
    await opened.close();
  }
});

Deno.test("documents/projects#R3: create only accepts disabled tracking", async () => {
  const opened = await harness();
  try {
    code(
      await opened.command(
        user,
        envelope("project.create", "enabled-create", {
          id: project,
          name: "notes",
          title: "Notes",
          purpose: "keep notes",
          folders,
          tracking: { ...tracking, enabled: true },
        }),
      ),
      "invalid_input",
    );
  } finally {
    await opened.close();
  }
});

Deno.test("documents/projects#R7: rename reserves the place in the same transaction", async () => {
  const opened = await harness();
  try {
    const created = commandResult(await create(opened));
    const revision = (created.result as { revision: string }).revision;
    const renamed = commandResult(
      await opened.command(
        user,
        envelope("project.update", "rename", { project, name: "renamed" }, {
          base_revision: revision,
        }),
      ),
    );
    const next = (renamed.result as { revision: string }).revision;
    const names = rows(
      await opened.inspect(
        "select slug, target, reserved_seq from place_names order by slug",
        [],
      ),
    );
    assertEquals(names.map((row) => row.slug), ["notes", "renamed"]);
    assertEquals(names.every((row) => row.target === project), true);
    assertEquals(
      names.find((row) => row.slug === "renamed")?.reserved_seq,
      next,
    );
  } finally {
    await opened.close();
  }
});

Deno.test("documents/projects#R9: archive keeps rows and a reader sees the archived status", async () => {
  const opened = await harness();
  try {
    const created = commandResult(await create(opened));
    const revision = (created.result as { revision: string }).revision;
    const archived = commandResult(
      await opened.command(
        user,
        envelope("project.archive", "archive", { project }, {
          base_revision: revision,
        }),
      ),
    );
    assertEquals((archived.result as { status: string }).status, "archived");
    assertEquals(
      rows(await opened.inspect("select id, status from projects", [])),
      [{ id: project, status: "archived" }],
    );
    const got = value(
      await opened.read(
        { resource: "projects", method: "get" },
        user,
        { project },
      ),
    ) as { project: { status: string; folders: unknown[] } };
    assertEquals(got.project.status, "archived");
    assertEquals(got.project.folders.length, 2);
  } finally {
    await opened.close();
  }
});

Deno.test("documents/projects#R8: user get returns folders, count and tracking", async () => {
  const opened = await harness();
  try {
    commandResult(await create(opened));
    const got = value(
      await opened.read(
        { resource: "projects", method: "get" },
        user,
        { project },
      ),
    ) as {
      project: {
        folders: { path: string }[];
        document_count: number;
        tracking: { patterns: unknown[]; use_gitignore: boolean };
      };
    };
    assertEquals(got.project.folders.map((folder) => folder.path), [
      "/work/notes",
      "/work/notes/deep",
    ]);
    assertEquals(got.project.document_count, 0);
    assertEquals(got.project.tracking.use_gitignore, true);
    assertEquals(got.project.tracking.patterns.length, 1);
  } finally {
    await opened.close();
  }
});

Deno.test("documents/projects#R10: agent get hides paths and returns document refs", async () => {
  const agent = credential("agent:asg_01arz3ndektsv4rrffq69g5fav");
  const opened = await harness([user, agent]);
  try {
    commandResult(await create(opened));
    const got = value(
      await opened.read(
        { resource: "projects", method: "get" },
        agent,
        { project },
      ),
    ) as { project: Record<string, unknown> };
    assertEquals("folders" in got.project, false);
    assertEquals(got.project.documents, []);
    assertEquals(got.project.name, "notes");
  } finally {
    await opened.close();
  }
});

Deno.test("documents/projects#R11: resolve returns the deepest registered root", async () => {
  const opened = await harness();
  try {
    value(await create(opened));
    const resolved = value(
      await opened.read(
        { resource: "projects", method: "resolve" },
        user,
        { path: "/work/notes/deep/file.md" },
      ),
    ) as { project: { id: string }; folder_path: string };
    assertEquals(resolved.project.id, project);
    assertEquals(resolved.folder_path, "/work/notes/deep");
    code(
      await opened.read(
        { resource: "projects", method: "resolve" },
        credential("agent:asg_01arz3ndektsv4rrffq69g5fav"),
        { path: "/work/notes/deep/file.md" },
      ),
      "unauthorized",
    );
  } finally {
    await opened.close();
  }
});

Deno.test("documents/projects#R1: revoked credential cannot read the project", async () => {
  const opened = await harness();
  try {
    value(await create(opened));
    value(await opened.revokeCredential(user.credential_ref));
    code(
      await opened.read({ resource: "projects", method: "list" }, user, {}),
      "unauthorized",
    );
  } finally {
    await opened.close();
  }
});
