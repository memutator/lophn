import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { err, ok } from "../../base/mod.ts";
import type { Document, DocumentRef } from "../../contracts/documents/mod.ts";
import type {
  PortKey,
  Sql,
  SqlRow,
  TargetAuthorizer,
  Tx,
} from "../../contracts/platform/mod.ts";
import { TargetAuthorization } from "../../contracts/platform/mod.ts";
import { initialTrackingProposal } from "./mod.ts";
import { createProjectReads, type ProjectReadDeps } from "./reads.ts";
import { createProjectCommands } from "./commands.ts";
import { ids, projectFixture, userContext } from "./testing-fixture.ts";
import { addressingSchemaSteps } from "../addressing/mod.ts";
import { projectsSchemaSteps } from "./schema.ts";
import {
  insertDocument,
  versionsSchemaSteps,
} from "../versions/mod.ts";

const commands = createProjectCommands();
const hidden = "doc_01arz3ndektsv4rrffq69g5faw";
const visibleDoc: DocumentRef = {
  document: ids.doc,
  version: ids.version,
  section: null,
};
const secretDoc: DocumentRef = {
  document: hidden,
  version: ids.version,
  section: null,
};

function authorizeFor(allowed: Set<string>): TargetAuthorizer {
  return (_ctx, _operation, target) =>
    typeof target.project === "string" && allowed.has(target.project)
      ? ok(undefined)
      : err({ code: "forbidden", message: "outside current scope" });
}

function deps(allowed: Set<string>): ProjectReadDeps {
  return {
    documents(_snapshot, project) {
      if (!allowed.has(project)) return ok([secretDoc]);
      return ok(project === ids.project ? [visibleDoc] : []);
    },
  };
}

function seed(fixture: ReturnType<typeof projectFixture>) {
  const created = fixture.transaction((tx) =>
    commands.create.handle(tx, userContext(), {
      id: ids.project,
      name: "notes",
      title: "Notes",
      purpose: "keep",
      folders: [
        { path: "/work/notes", description: "outer" },
        { path: "/work/notes/deep", description: "inner" },
      ],
      tracking: {
        enabled: false,
        patterns: [{ effect: "include", glob: "**/*.md" }],
        use_gitignore: true,
      },
    }, {})
  );
  if (!created.ok) throw new Error(created.error.code);
  const other = fixture.transaction((tx) =>
    commands.create.handle(tx, userContext(), {
      id: ids.other,
      name: "secret",
      title: "Secret",
      purpose: "hidden",
      folders: [{ path: "/secret", description: "do not leak" }],
      tracking: { enabled: false, patterns: [], use_gitignore: false },
    }, {})
  );
  if (!other.ok) throw new Error(other.error.code);
}

Deno.test("documents/projects#R8: user read returns folders, count and tracking", () => {
  const fixture = projectFixture();
  try {
    seed(fixture);
    fixture.use(authorizeFor(new Set([ids.project, ids.other])));
    const reads = createProjectReads(deps(new Set([ids.project, ids.other])));
    const got = reads.get.handle(
      fixture.snapshot(),
      userContext(),
      {
        project: ids.project,
      },
    );
    assert(got.ok);
    const project = got.value.project;
    assert("folders" in project);
    assertEquals(project.document_count, 1);
    assertEquals(project.folders.map((folder) => folder.description), [
      "outer",
      "inner",
    ]);
    assertEquals(project.tracking.use_gitignore, true);
    assertEquals(project.tracking.patterns[0]?.glob, "**/*.md");
    assertEquals(project.tracking.enabled, false);
    assertEquals(initialTrackingProposal, {
      enabled: true,
      patterns: [{ effect: "include", glob: "**/*.md" }],
      use_gitignore: true,
    });
    assert(
      JSON.stringify(project.tracking) !==
        JSON.stringify(initialTrackingProposal),
    );
  } finally {
    fixture.close();
  }
});

Deno.test("documents/projects#R9: nonuser output hides paths and outside projects", () => {
  const fixture = projectFixture();
  try {
    seed(fixture);
    const allowed = new Set([ids.project]);
    fixture.use(authorizeFor(allowed));
    const reads = createProjectReads(deps(allowed));
    const agent = "agent:asg_01arz3ndektsv4rrffq69g5fav";
    const listed = reads.list.handle(
      fixture.snapshot(),
      userContext(agent),
      {},
    );
    assert(listed.ok);
    const body = JSON.stringify(listed.value);
    assert(!body.includes("/work"));
    assert(!body.includes("/secret"));
    assert(!body.includes("folders"));
    assert(!body.includes(hidden));
    assert(!body.includes("file_tree"));
    assertEquals(listed.value.projects.map((project) => project.id), [
      ids.project,
    ]);
    const first = listed.value.projects[0];
    assert(first && !("folders" in first) && !("document_count" in first));
    assertEquals(first.documents, [visibleDoc]);
    const denied = reads.get.handle(fixture.snapshot(), userContext(agent), {
      project: ids.other,
    });
    assert(!denied.ok && denied.error.code === "not_found");
    const paged = reads.list.handle(fixture.snapshot(), userContext(), {
      limit: 1,
    });
    assert(paged.ok && paged.value.projects.length === 1);
    assertEquals(paged.value.next_cursor, null);
    assertEquals(paged.value.projects[0]?.id, ids.project);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/projects#R9: dependency failures stay visible", () => {
  const fixture = projectFixture();
  try {
    seed(fixture);
    const unavailable = createProjectReads({
      documents: () => ok([]),
    });
    const deniedCredential = fixture.snapshot();
    deniedCredential.port = (() => () =>
      err({
        code: "unavailable",
        message: "credential",
      })) as typeof deniedCredential.port;
    const failed = unavailable.list.handle(
      deniedCredential,
      userContext(),
      {},
    );
    assert(!failed.ok && failed.error.code === "unavailable");
    const broken = createProjectReads({
      documents: () => err({ code: "internal", message: "document refs" }),
    });
    const internal = broken.get.handle(fixture.snapshot(), userContext(), {
      project: ids.project,
    });
    assert(!internal.ok && internal.error.code === "internal");
  } finally {
    fixture.close();
  }
});

Deno.test("documents/projects#R10: resolve uses the deepest root and links nothing", () => {
  const fixture = projectFixture();
  try {
    seed(fixture);
    const allowed = new Set([ids.project, ids.other]);
    fixture.use(authorizeFor(allowed));
    const reads = createProjectReads(deps(allowed));
    const resolved = reads.resolve.handle(fixture.snapshot(), userContext(), {
      path: "/work/notes/deep/file.md",
    });
    assert(resolved.ok);
    assertEquals(resolved.value.folder_path, "/work/notes/deep");
    assertEquals(resolved.value.project.id, ids.project);
    assertEquals(
      fixture.sql.all("SELECT name FROM sqlite_master WHERE type = 'table'", [])
        .map((row) => row.name).sort(),
      [
        "document_names",
        "place_names",
        "project_folders",
        "project_tracking_patterns",
        "projects",
      ],
    );
    const unknown = reads.resolve.handle(fixture.snapshot(), userContext(), {
      path: "/missing/file.md",
    });
    assert(!unknown.ok && unknown.error.code === "not_found");
    const agent = reads.resolve.handle(
      fixture.snapshot(),
      userContext("coding_agent:cac_01arz3ndektsv4rrffq69g5fav"),
      { path: "/work/notes/deep/file.md" },
    );
    assert(!agent.ok && agent.error.code === "forbidden");
  } finally {
    fixture.close();
  }
});

Deno.test("documents/projects#R8: project.get and project.list return real document count and refs", () => {
  // Create a fixture with both projects and versions schemas for real document reads.
  const directory = Deno.makeTempDirSync({
    prefix: "projects-with-docs-test-",
  });
  const db = new DatabaseSync(`${directory}/ledger.sqlite`);
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON;",
  );

  // Initialize all necessary schemas.
  for (
    const step of [
      ...addressingSchemaSteps,
      ...projectsSchemaSteps,
      ...versionsSchemaSteps,
    ]
  ) {
    db.exec(step.sql);
  }

  try {
    let seq = 0n;
    const allowAll = () => ok(undefined);
    const sqlOf = (active: () => void): Sql => ({
      run: (statement, params) => {
        active();
        return db.prepare(statement).run(...params);
      },
      get: (statement, params) => {
        active();
        return db.prepare(statement).get(...params) as SqlRow | undefined;
      },
      all: (statement, params) => {
        active();
        return db.prepare(statement).all(...params) as SqlRow[];
      },
    });
    const base = sqlOf(() => {});

    // Helper to create a transaction context.
    // deno-lint-ignore no-explicit-any
    const transaction = (handle: (tx: Tx) => any) => {
      let open = true;
      const guard = () => {
        if (!open) throw new Error("transaction is closed");
      };
      db.exec("BEGIN IMMEDIATE");
      const tx = {
        sql: sqlOf(guard),
        emit(
          _event: { type: string },
          _subject: string | null,
          _payload: unknown,
        ) {
          guard();
          seq += 1n;
          return seq.toString();
        },
        now: () => "2026-10-04T00:00:00.000Z",
        newId: (_prefix: string) => {
          guard();
          throw new Error("should not mint ids in this test");
        },
        port<T>(key: PortKey<T>): T {
          guard();
          if (!Object.is(key, TargetAuthorization)) {
            throw new Error("unregistered port");
          }
          return allowAll as unknown as T;
        },
        registerBlobRef: () => {
          throw new Error("unused");
        },
        advanceSubscriberCursor: () => {
          throw new Error("unused");
        },
        useApproval: () => {
          throw new Error("unused");
        },
        call: () => {
          throw new Error("unused");
        },
      } as Tx;
      try {
        const result = handle(tx);
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      } finally {
        open = false;
      }
    };

    // Create a project.
    const createProjectCmd = createProjectCommands();
    const projCreated = transaction((tx) =>
      createProjectCmd.create.handle(tx, userContext(), {
        id: ids.project,
        name: "test-project",
        title: "Test Project",
        purpose: "testing",
        folders: [{ path: "/test/project", description: "test" }],
        tracking: {
          enabled: false,
          patterns: [],
          use_gitignore: false,
        },
      }, {})
    );
    assert(
      projCreated.ok,
      `failed to create project: ${projCreated.error?.code}`,
    );

    // Insert active documents and an archived document.
    const doc1: Document = {
      id: "doc_01arz3ndektsv4rrffq69g5fab",
      place: { kind: "project", id: ids.project },
      name: "doc1",
      title: "Document 1",
      file_source: {
        kind: "project_file",
        project: ids.project,
        path: "file1.md",
      },
      latest_version: "ver_01arz3ndektsv4rrffq69g5fab",
      revision: "1",
      status: "active",
    };

    const doc2: Document = {
      id: "doc_01arz3ndektsv4rrffq69g5fac",
      place: { kind: "project", id: ids.project },
      name: "doc2",
      title: "Document 2",
      file_source: {
        kind: "project_file",
        project: ids.project,
        path: "file2.md",
      },
      latest_version: "ver_01arz3ndektsv4rrffq69g5fac",
      revision: "1",
      status: "active",
    };

    const archivedDoc: Document = {
      id: "doc_01arz3ndektsv4rrffq69g5fad",
      place: { kind: "project", id: ids.project },
      name: "archived",
      title: "Archived Document",
      file_source: {
        kind: "project_file",
        project: ids.project,
        path: "archived.md",
      },
      latest_version: "ver_01arz3ndektsv4rrffq69g5fad",
      revision: "1",
      status: "archived",
    };

    transaction((tx) => {
      insertDocument(tx, doc1);
      insertDocument(tx, doc2);
      insertDocument(tx, archivedDoc);
      return ok(undefined);
    });

    // Create a snapshot to read.
    const snapshot = {
      sql: base,
      as_of_seq: seq.toString(),
      port<T>(key: PortKey<T>): T {
        if (!Object.is(key, TargetAuthorization)) {
          throw new Error("unregistered port");
        }
        return allowAll as unknown as T;
      },
    };

    // Create the real documents dependency function.
    const realDocumentsDep: ProjectReadDeps = {
      documents(snap, projectId: string) {
        const result = snap.sql.all(
          `SELECT id, latest_version FROM documents
           WHERE place_kind = 'project' AND place_id = ? AND status = 'active'`,
          [projectId],
        ) as Array<{ id: string; latest_version: string }>;
        return ok(result.map((doc) => ({
          document: doc.id,
          version: doc.latest_version,
          section: null,
        })));
      },
    };

    // Test project.get
    const reads = createProjectReads(realDocumentsDep);
    const got = reads.get.handle(snapshot, userContext(), {
      project: ids.project,
    });
    if (!got.ok) {
      throw new Error("project.get failed");
    }
    const project = got.value.project;
    assert("document_count" in project, "user should get document_count");
    // deno-lint-ignore no-explicit-any
    const userProject = project as any;
    assertEquals(
      userProject.document_count,
      2,
      "should count only active documents",
    );
    assertEquals(
      userProject.documents.length,
      2,
      "should return 2 document refs",
    );
    assertEquals(
      userProject.documents
        // deno-lint-ignore no-explicit-any
        .map((d: any) => d.document)
        .sort(),
      [doc1.id, doc2.id].sort(),
      "should return refs for active documents only",
    );

    // Test project.list
    const listed = reads.list.handle(snapshot, userContext(), {});
    if (!listed.ok) {
      throw new Error("project.list failed");
    }
    const listedProject = listed.value.projects[0];
    assert(listedProject, "should have at least one project");
    // deno-lint-ignore no-explicit-any
    const listedUserProject = listedProject as any;
    assertEquals(
      listedUserProject.document_count,
      2,
      "list should also show correct count",
    );
    assertEquals(
      listedUserProject.documents.length,
      2,
      "list should return document refs",
    );
  } finally {
    db.close();
    Deno.removeSync(directory, { recursive: true });
  }
});
