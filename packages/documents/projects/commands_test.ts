import { assert, assertEquals, assertThrows } from "@std/assert";
import { ok, type Result } from "../../base/mod.ts";
import type { RequestContext } from "../../contracts/platform/mod.ts";
import { createProjectCommands } from "./mod.ts";
import { ids, projectFixture, userContext } from "./testing-fixture.ts";

const commands = createProjectCommands({ authorize: () => ok(undefined) });
const folders = [
  { path: "/work/notes", description: "notes" },
  { path: "/work/other", description: "" },
];
const tracking = {
  enabled: false as const,
  patterns: [],
  use_gitignore: false,
};

function code(result: Result<unknown>, expected: string) {
  assert(!result.ok);
  assertEquals(result.error.code, expected);
}

function create(
  fixture: ReturnType<typeof projectFixture>,
  actor: RequestContext = userContext(),
) {
  return fixture.transaction((tx) =>
    commands.create.handle(tx, actor, {
      id: ids.project,
      name: "notes",
      title: "Notes",
      purpose: "keep notes",
      folders,
      tracking,
    }, {})
  );
}

Deno.test("documents/projects#R1: nonuser actors cannot register or change a project", () => {
  const actors = [
    "coding_agent:cac_01arz3ndektsv4rrffq69g5fav",
    "agent:asg_01arz3ndektsv4rrffq69g5fav",
    "app:app_01arz3ndektsv4rrffq69g5fav",
    "machine",
  ];
  for (const actor of actors) {
    const fixture = projectFixture();
    try {
      code(create(fixture, userContext(actor)), "forbidden");
      assertEquals(fixture.sql.all("SELECT * FROM projects", []), []);
      assertEquals(fixture.emitted, []);
    } finally {
      fixture.close();
    }
  }
});

Deno.test("documents/projects#R2: zero or several folders, and no default project", () => {
  const fixture = projectFixture();
  try {
    assertEquals(fixture.sql.all("SELECT * FROM projects", []), []);
    assert(create(fixture).ok);
    const empty = fixture.transaction((tx) =>
      commands.create.handle(tx, userContext(), {
        id: ids.other,
        name: "empty",
        title: "Empty",
        purpose: "",
        folders: [],
        tracking,
      }, {})
    );
    assert(empty.ok && empty.value.folders.length === 0);
    const stored = fixture.sql.all(
      "SELECT path, description, position FROM project_folders WHERE project = ? ORDER BY position",
      [ids.project],
    );
    assertEquals(stored.map((row) => row.path), ["/work/notes", "/work/other"]);
    assertEquals(stored[0]?.position, 0);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/projects#R3: create rejects enabled tracking", () => {
  const fixture = projectFixture();
  try {
    const rejected = fixture.transaction((tx) =>
      commands.create.handle(tx, userContext(), {
        id: ids.project,
        name: "notes",
        title: "Notes",
        purpose: "",
        folders: [],
        tracking: {
          enabled: true as unknown as false,
          patterns: [],
          use_gitignore: true,
        },
      }, {})
    );
    code(rejected, "invalid_input");
    assert(create(fixture).ok);
    const row = fixture.sql.get(
      "SELECT tracking_enabled, use_gitignore FROM projects",
      [],
    );
    assertEquals(row, { tracking_enabled: 0, use_gitignore: 0 });
  } finally {
    fixture.close();
  }
});

Deno.test("documents/projects#R11: rename reserves and archive keeps documents", () => {
  const fixture = projectFixture();
  try {
    const created = create(fixture);
    assert(created.ok);
    fixture.sql.run(
      "CREATE TABLE documents (id TEXT PRIMARY KEY, place TEXT NOT NULL)",
      [],
    );
    fixture.sql.run("INSERT INTO documents (id, place) VALUES (?, ?)", [
      ids.doc,
      ids.project,
    ]);
    const renamed = fixture.transaction((tx) =>
      commands.update.handle(tx, userContext(), {
        project: ids.project,
        name: "renamed",
      }, { base_revision: created.value.revision })
    );
    assert(renamed.ok && renamed.value.name === "renamed");
    assertEquals(
      fixture.sql.get("SELECT target FROM place_names WHERE slug = ?", [
        "notes",
      ])?.target,
      ids.project,
    );
    assertEquals(
      fixture.sql.get(
        "SELECT target, reserved_seq FROM place_names WHERE slug = ?",
        ["renamed"],
      ),
      { target: ids.project, reserved_seq: renamed.value.revision },
    );
    const archived = fixture.transaction((tx) =>
      commands.archive.handle(tx, userContext(), { project: ids.project }, {
        base_revision: renamed.value.revision,
      })
    );
    assert(archived.ok && archived.value.status === "archived");
    assertEquals(fixture.sql.get("SELECT id FROM documents", [])?.id, ids.doc);
    assertEquals(
      fixture.sql.all("SELECT slug FROM place_names ORDER BY slug", []).length,
      2,
    );
    code(
      fixture.transaction((tx) =>
        commands.archive.handle(tx, userContext(), { project: ids.project }, {
          base_revision: archived.value.revision,
        })
      ),
      "conflict",
    );
  } finally {
    fixture.close();
  }
});

Deno.test("documents/projects#R7: unarchive conflicts on an enabled ancestor and rolls back", () => {
  const fixture = projectFixture();
  try {
    const created = create(fixture);
    assert(created.ok);
    const other = fixture.transaction((tx) =>
      commands.create.handle(tx, userContext(), {
        id: ids.other,
        name: "parent",
        title: "Parent",
        purpose: "",
        folders: [{ path: "/work", description: "" }],
        tracking: {
          enabled: false,
          patterns: [{ effect: "include", glob: "**/*.md" }],
          use_gitignore: true,
        },
      }, {})
    );
    assert(other.ok);
    fixture.sql.run("UPDATE projects SET tracking_enabled = 1 WHERE id = ?", [
      ids.other,
    ]);
    const archived = fixture.transaction((tx) =>
      commands.archive.handle(tx, userContext(), { project: ids.project }, {
        base_revision: created.value.revision,
      })
    );
    assert(archived.ok);
    fixture.sql.run("UPDATE projects SET tracking_enabled = 1 WHERE id = ?", [
      ids.project,
    ]);
    const before = fixture.sql.get(
      "SELECT status, revision FROM projects WHERE id = ?",
      [ids.project],
    );
    code(
      fixture.transaction((tx) =>
        commands.unarchive.handle(tx, userContext(), { project: ids.project }, {
          base_revision: archived.value.revision,
        })
      ),
      "conflict",
    );
    assertEquals(
      fixture.sql.get("SELECT status, revision FROM projects WHERE id = ?", [
        ids.project,
      ]),
      before,
    );
    const sibling = fixture.transaction((tx) => {
      fixture.db.exec(
        "UPDATE projects SET tracking_enabled = 0 WHERE id = '" + ids.other +
          "'",
      );
      return commands.unarchive.handle(tx, userContext(), {
        project: ids.project,
      }, {
        base_revision: archived.value.revision,
      });
    });
    assert(sibling.ok);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/projects#R1: stale CAS, conflicts and thrown SQL roll back", () => {
  const fixture = projectFixture();
  try {
    const created = create(fixture);
    assert(created.ok);
    code(
      fixture.transaction((tx) =>
        commands.update.handle(tx, userContext(), {
          project: ids.project,
          title: "Next",
        }, {
          base_revision: "9",
        })
      ),
      "conflict",
    );
    code(
      fixture.transaction((tx) =>
        commands.update.handle(tx, userContext(), {
          project: ids.other,
          title: "Missing",
        }, {
          base_revision: "1",
        })
      ),
      "not_found",
    );
    code(
      fixture.transaction((tx) =>
        commands.create.handle(tx, userContext(), {
          id: ids.other,
          name: "notes",
          title: "Duplicate",
          purpose: "",
          folders: [],
          tracking,
        }, {})
      ),
      "conflict",
    );
    code(
      fixture.transaction((tx) =>
        commands.update.handle(tx, userContext(), {
          project: ids.project,
          folders: [],
        }, {
          base_revision: created.value.revision,
        })
      ),
      "invalid_input",
    );
    assertThrows(() =>
      fixture.transaction((tx) => {
        tx.sql.run("DROP TABLE projects", []);
        return commands.update.handle(tx, userContext(), {
          project: ids.project,
          title: "Broken",
        }, { base_revision: created.value.revision });
      })
    );
    assertEquals(
      fixture.sql.get("SELECT title FROM projects", [])?.title,
      "Notes",
    );
    assertEquals(fixture.emitted.at(-1)?.type, "ProjectCreated");
  } finally {
    fixture.close();
  }
});

Deno.test("documents/projects#R11: metadata update emits the same seq as the new revision", () => {
  const fixture = projectFixture();
  try {
    const created = create(fixture);
    assert(created.ok);
    const updated = fixture.transaction((tx) =>
      commands.update.handle(tx, userContext(), {
        project: ids.project,
        title: "Renamed title",
        purpose: "next",
      }, { base_revision: created.value.revision })
    );
    assert(updated.ok);
    assertEquals(updated.value.revision, fixture.emitted.at(-1)?.seq);
    assertEquals(fixture.emitted.at(-1)?.payload, {
      before: { title: "Notes", purpose: "keep notes" },
      after: { title: "Renamed title", purpose: "next" },
    });
    assertEquals(updated.value.folders, folders);
  } finally {
    fixture.close();
  }
});
