import { assert, assertEquals } from "@std/assert";
import { err, ok } from "../../base/mod.ts";
import type { DocumentRef } from "../../contracts/documents/mod.ts";
import { initialTrackingProposal } from "./mod.ts";
import { createProjectReads, type ProjectReadDeps } from "./reads.ts";
import { createProjectCommands } from "./commands.ts";
import { ids, projectFixture, userContext } from "./testing-fixture.ts";

const commands = createProjectCommands({ authorize: () => ok(undefined) });
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

function deps(allowed: Set<string>): ProjectReadDeps {
  return {
    authorize(_ctx, _operation, target) {
      return allowed.has(
          target.kind === "command" ? target.after.id : target.project.id,
        )
        ? ok(undefined)
        : err({ code: "forbidden", message: "outside current scope" });
    },
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
    const reads = createProjectReads(deps(new Set([ids.project, ids.other])));
    const got = reads.get.handle(fixture.snapshot(), userContext(), {
      project: ids.project,
    });
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
    const reads = createProjectReads(deps(new Set([ids.project])));
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
      authorize: () => err({ code: "unavailable", message: "credential" }),
      documents: () => ok([]),
    });
    const failed = unavailable.list.handle(
      fixture.snapshot(),
      userContext(),
      {},
    );
    assert(!failed.ok && failed.error.code === "unavailable");
    const broken = createProjectReads({
      authorize: () => ok(undefined),
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
    const reads = createProjectReads(deps(new Set([ids.project, ids.other])));
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
