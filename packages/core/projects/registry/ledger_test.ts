import { assert, assertEquals } from "@std/assert";
import type { Result } from "../../../base/mod.ts";
import type {
  AuthenticatedContext,
  SqlRow,
} from "../../../protocol/server/mod.ts";

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
  setCredential(ctx: AuthenticatedContext): Promise<Result<void>>;
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
  "../register.ts",
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
  "project.resolve_cwd",
  "project.tracking_roots",
  "project.set_tracking",
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

const codingAgent = "coding_agent:cac_01arz3ndektsv4rrffq69g5fav";

Deno.test("documents/projects#R9: resolve_cwd returns only the project id from the fixed cwd", async () => {
  const agent = credential(codingAgent);
  const opened = await harness([user, agent]);
  try {
    commandResult(await create(opened));
    const fixed = {
      ...agent,
      credential_ref: `${agent.credential_ref}:cwd`,
      conditions: { cwd: "/work/notes/deep/file.md" },
    };
    value(await opened.setCredential(fixed));
    const resolved = value(
      await opened.read(
        { resource: "projects", method: "resolve_cwd" },
        fixed,
        {},
      ),
    ) as { project: string };
    assertEquals(resolved.project, project);
    assertEquals("folder_path" in resolved, false);
    code(
      await opened.read(
        { resource: "projects", method: "resolve_cwd" },
        user,
        {},
      ),
      "forbidden",
    );
  } finally {
    await opened.close();
  }
});

Deno.test("documents/projects#R9: resolve_cwd fails closed without a fixed cwd", async () => {
  const agent = credential(codingAgent);
  const opened = await harness([user, agent]);
  try {
    commandResult(await create(opened));
    code(
      await opened.read(
        { resource: "projects", method: "resolve_cwd" },
        agent,
        {},
      ),
      "not_found",
    );
    code(
      await opened.read(
        { resource: "projects", method: "resolve_cwd" },
        agent,
        { path: "/work/notes/file.md" },
      ),
      "invalid_input",
    );
  } finally {
    await opened.close();
  }
});

Deno.test("documents/projects#R7: tracking_roots lists only active enabled roots", async () => {
  const machine = credential("machine");
  const opened = await harness([user, machine]);
  try {
    commandResult(await create(opened));
    const listed = value(
      await opened.read(
        { resource: "projects", method: "tracking_roots" },
        machine,
        {},
      ),
    ) as { roots: unknown[]; as_of_seq: string };
    // create는 tracking.enabled=false만 받는다. 켜진 root가 없으면 빈 목록이다.
    assertEquals(listed.roots, []);
    assert(listed.as_of_seq.length > 0);
    code(
      await opened.read(
        { resource: "projects", method: "tracking_roots" },
        user,
        {},
      ),
      "forbidden",
    );
    code(
      await opened.read(
        { resource: "projects", method: "tracking_roots" },
        machine,
        { project },
      ),
      "invalid_input",
    );
  } finally {
    await opened.close();
  }
});

Deno.test("documents/projects#R8: user read carries the proposal apart from stored tracking", async () => {
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
        tracking: { enabled: boolean };
        initial_tracking_proposal: { enabled: boolean; patterns: unknown[] };
      };
    };
    assertEquals(got.project.tracking.enabled, false);
    assertEquals(got.project.initial_tracking_proposal.enabled, true);
    assertEquals(
      got.project.initial_tracking_proposal.patterns.length > 0,
      true,
    );
  } finally {
    await opened.close();
  }
});

Deno.test("documents/projects#R10: list rejects a cursor whose snapshot no longer matches", async () => {
  const opened = await harness();
  try {
    commandResult(await create(opened));
    commandResult(
      await opened.command(
        user,
        envelope("project.create", "create-second", {
          id: other,
          name: "second",
          title: "Second",
          purpose: "",
          folders: [],
          tracking: { enabled: false, patterns: [], use_gitignore: false },
        }),
      ),
    );
    const page = value(
      await opened.read(
        { resource: "projects", method: "list" },
        user,
        { limit: 1 },
      ),
    ) as { next_cursor: string | null };
    assert(page.next_cursor !== null);
    commandResult(
      await opened.command(
        user,
        envelope("project.create", "create-third", {
          id: "prj_01arz3ndektsv4rrffq69g5fax",
          name: "third",
          title: "Third",
          purpose: "",
          folders: [],
          tracking: { enabled: false, patterns: [], use_gitignore: false },
        }),
      ),
    );
    code(
      await opened.read(
        { resource: "projects", method: "list" },
        user,
        { limit: 1, cursor: page.next_cursor },
      ),
      "conflict",
    );
  } finally {
    await opened.close();
  }
});

Deno.test("documents/projects#R3 R6 R7: set_tracking applies the preview and tracking_roots lists enabled roots", async () => {
  const machine = credential("machine");
  const opened = await harness([user, machine]);
  try {
    const created = commandResult(await create(opened));
    const revision = (created.result as { revision: string }).revision;
    const enabledFolders = [
      { path: "/work/notes", description: "outer" },
      { path: "/work/other", description: "side" },
    ];
    const proposal = {
      enabled: true,
      patterns: [{ effect: "include", glob: "**/*.md" }],
      use_gitignore: true,
    };
    const preview = {
      project,
      base_revision: revision,
      folders: enabledFolders,
      tracking: proposal,
      observed_at: "2026-10-04T00:00:00.000Z",
      entries: [],
      complete: true,
      next_cursor: null,
    };
    code(
      await opened.command(
        user,
        envelope("project.set_tracking", "mismatch", {
          project,
          folders: enabledFolders,
          tracking: { ...proposal, use_gitignore: false },
          preview,
        }, { base_revision: revision }),
      ),
      "invalid_input",
    );
    const applied = commandResult(
      await opened.command(
        user,
        envelope("project.set_tracking", "apply", {
          project,
          folders: enabledFolders,
          tracking: proposal,
          preview,
        }, { base_revision: revision }),
      ),
    );
    assertEquals(
      (applied.result as { tracking: { enabled: boolean } }).tracking.enabled,
      true,
    );
    const listed = value(
      await opened.read(
        { resource: "projects", method: "tracking_roots" },
        machine,
        {},
      ),
    ) as { roots: { project: string; path: string }[] };
    assertEquals(listed.roots.map((root) => root.path), [
      "/work/notes",
      "/work/other",
    ]);
    const child = commandResult(
      await opened.command(
        user,
        envelope("project.create", "create-child", {
          id: other,
          name: "child",
          title: "Child",
          purpose: "",
          folders: [{ path: "/work/notes/deep/inner", description: "" }],
          tracking: { enabled: false, patterns: [], use_gitignore: false },
        }),
      ),
    );
    const childRevision = (child.result as { revision: string }).revision;
    const childFolders = [{ path: "/work/notes/deep/inner", description: "" }];
    code(
      await opened.command(
        user,
        envelope("project.set_tracking", "overlap", {
          project: other,
          folders: childFolders,
          tracking: proposal,
          preview: {
            ...preview,
            project: other,
            base_revision: childRevision,
            folders: childFolders,
          },
        }, { base_revision: childRevision }),
      ),
      "conflict",
    );
  } finally {
    await opened.close();
  }
});

Deno.test("documents/projects#R1 documents/projects#R9: scope.targets가 가리키는 Project만 command와 read를 통과한다", async () => {
  const matched = {
    ...user,
    credential_ref: "test:test-user:matched",
    scope: {
      operations,
      targets: { project: project, before_project: project },
    },
  };
  const matchedRead = {
    ...matched,
    credential_ref: "test:test-user:matched-read",
    scope: { operations, targets: { project } },
  };
  const otherProject = {
    ...user,
    credential_ref: "test:test-user:other-project",
    scope: { operations, targets: { project: other } },
  };
  const opened = await harness([user, matched, matchedRead, otherProject]);
  try {
    code(
      await opened.command(
        otherProject,
        envelope("project.create", "other-target-create", {
          id: project,
          name: "notes",
          title: "Notes",
          purpose: "keep notes",
          folders,
          tracking,
        }),
      ),
      "forbidden",
    );
    const created = commandResult(await create(opened));
    const revision = (created.result as { revision: string }).revision;
    code(
      await opened.command(
        otherProject,
        envelope("project.update", "other-target-update", {
          project,
          title: "Changed",
        }, { base_revision: revision }),
      ),
      "forbidden",
    );
    const updated = commandResult(
      await opened.command(
        matched,
        envelope("project.update", "matched-update", {
          project,
          title: "Changed",
        }, { base_revision: revision }),
      ),
    );
    assertEquals(
      (updated.result as { title: string }).title,
      "Changed",
    );
    code(
      await opened.read(
        { resource: "projects", method: "get" },
        otherProject,
        { project },
      ),
      "not_found",
    );
    const got = value(
      await opened.read(
        { resource: "projects", method: "get" },
        matchedRead,
        { project },
      ),
    ) as { project: { id: string; title: string } };
    assertEquals(got.project.id, project);
    assertEquals(got.project.title, "Changed");
    const hidden = value(
      await opened.read(
        { resource: "projects", method: "list" },
        otherProject,
        {},
      ),
    ) as { projects: { id: string }[] };
    assertEquals(hidden.projects.map((item) => item.id), []);
    const listed = value(
      await opened.read(
        { resource: "projects", method: "list" },
        matchedRead,
        {},
      ),
    ) as { projects: { id: string }[]; omitted?: unknown };
    assertEquals(listed.projects.map((item) => item.id), [project]);
    assertEquals("omitted" in listed, false);
  } finally {
    await opened.close();
  }
});
