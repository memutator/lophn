import { assert, assertEquals, assertThrows } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { ok } from "../../base/mod.ts";
import type { Project } from "../../protocol/projects/mod.ts";
import { insertProject, loadProject } from "./store.ts";
import { projectFromRows } from "./rows.ts";
import { ids, projectFixture } from "./testing-fixture.ts";

const project: Project = {
  id: ids.project,
  name: "notes",
  title: "Notes",
  purpose: "keep notes",
  revision: "1",
  status: "active",
  folders: [
    { path: "/work/notes", description: "outer" },
    { path: "/work/notes/deep", description: "inner" },
  ],
  tracking: {
    enabled: false,
    patterns: [
      { effect: "include", glob: "**/*.md" },
      { effect: "exclude", glob: "private/**" },
    ],
    use_gitignore: true,
  },
};

function seed(fixture: ReturnType<typeof projectFixture>) {
  const stored = fixture.transaction((tx) => {
    insertProject(tx, project);
    return ok(undefined);
  });
  assert(stored.ok);
}

Deno.test("documents/projects#R2: WAL persists ordered folders and patterns on a new reader", () => {
  const fixture = projectFixture();
  try {
    assertEquals(
      fixture.db.prepare("PRAGMA journal_mode").get()?.journal_mode,
      "wal",
    );
    assertEquals(
      fixture.db.prepare("PRAGMA foreign_keys").get()?.foreign_keys,
      1,
    );
    assertEquals(
      fixture.db.prepare("PRAGMA recursive_triggers").get()?.recursive_triggers,
      1,
    );
    seed(fixture);
    const reader = new DatabaseSync(fixture.path, { readOnly: true });
    try {
      assertEquals(
        reader.prepare("SELECT name FROM projects").get()?.name,
        "notes",
      );
      assertEquals(
        reader.prepare("SELECT path FROM project_folders ORDER BY position")
          .all()
          .map((row) => row.path),
        ["/work/notes", "/work/notes/deep"],
      );
      assertEquals(
        reader.prepare(
          "SELECT effect, glob FROM project_tracking_patterns ORDER BY position",
        )
          .all().map((row) => ({ effect: row.effect, glob: row.glob })),
        project.tracking.patterns,
      );
      assertEquals(loadProject(fixture.sql, project.id), ok(project));
    } finally {
      reader.close();
    }
  } finally {
    fixture.close();
  }
});

Deno.test("documents/projects#R11: SQL cannot delete or replace a project identity", () => {
  const fixture = projectFixture();
  try {
    seed(fixture);
    const other = { ...project, id: ids.other, name: "other", folders: [] };
    assert(
      fixture.transaction((tx) => {
        insertProject(tx, other);
        return ok(undefined);
      }).ok,
    );
    for (const recursive of [0, 1]) {
      fixture.db.exec(`PRAGMA recursive_triggers=${recursive}`);
      const attempts = [
        ["DELETE FROM projects WHERE id = ?", [project.id]],
        ["UPDATE projects SET id = ? WHERE id = ?", [ids.third, project.id]],
        ["UPDATE OR REPLACE projects SET name = ? WHERE id = ?", [
          other.name,
          project.id,
        ]],
        [
          "REPLACE INTO projects VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [project.id, "replacement", "Replacement", "", 0, 0, "2", "active"],
        ],
        [
          "INSERT OR REPLACE INTO projects VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [ids.other, project.name, "Replacement", "", 0, 0, "2", "active"],
        ],
        [
          "INSERT INTO projects VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title = excluded.title",
          [project.id, project.name, "Replacement", "", 0, 0, "2", "active"],
        ],
      ] as const;
      for (const [statement, params] of attempts) {
        assertThrows(() => fixture.sql.run(statement, params));
        assertEquals(loadProject(fixture.sql, project.id), ok(project));
        assertEquals(loadProject(fixture.sql, other.id), ok(other));
      }
    }
    fixture.sql.run(
      "UPDATE projects SET status = 'archived', revision = '2' WHERE id = ?",
      [
        project.id,
      ],
    );
    const archived = loadProject(fixture.sql, project.id);
    assert(archived.ok && archived.value !== null);
    assertEquals(archived.value.status, "archived");
    assertEquals(archived.value.folders, project.folders);
    assertEquals(archived.value.tracking, project.tracking);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/projects#R1: schema rejects invalid flags, revision and orphan child rows", () => {
  const fixture = projectFixture();
  try {
    seed(fixture);
    for (
      const statement of [
        "UPDATE projects SET title = ''",
        "UPDATE projects SET tracking_enabled = 2",
        "UPDATE projects SET use_gitignore = -1",
        "UPDATE projects SET revision = '0'",
        "UPDATE projects SET revision = '01'",
        "UPDATE projects SET revision = '1a'",
        "UPDATE projects SET revision = '9223372036854775808'",
        "UPDATE projects SET revision = '10000000000000000000'",
        "UPDATE projects SET status = 'deleted'",
        "INSERT INTO project_folders VALUES ('missing', 0, '/missing', '')",
        "INSERT INTO project_folders VALUES ('missing', -1, '/missing', '')",
        "UPDATE project_tracking_patterns SET effect = 'other'",
        "UPDATE project_tracking_patterns SET glob = ''",
      ]
    ) {
      assertThrows(() => fixture.db.exec(statement));
    }
    assertEquals(loadProject(fixture.sql, project.id), ok(project));
  } finally {
    fixture.close();
  }
});

Deno.test("documents/projects#R2: row decode fails closed on gaps, aliases and invalid stored paths", () => {
  const row = {
    id: project.id,
    name: project.name,
    title: project.title,
    purpose: project.purpose,
    revision: project.revision,
    status: project.status,
    tracking_enabled: 0,
    use_gitignore: 1,
  };
  const folders = project.folders.map((folder, position) => ({
    ...folder,
    position,
  }));
  const patterns = project.tracking.patterns.map((pattern, position) => ({
    ...pattern,
    position,
  }));
  assertEquals(projectFromRows(row, folders, patterns), ok(project));
  const invalidRows = [
    projectFromRows({ ...row, tracking_enabled: 2 }, folders, patterns),
    projectFromRows(row, [{ ...folders[0]!, position: 1 }], patterns),
    projectFromRows(row, folders, [{ ...patterns[0]!, position: 1 }]),
    projectFromRows(row, [{ ...folders[0]!, path: "/work//notes" }], patterns),
    projectFromRows(row, [
      { position: 0, path: "C:\\Work", description: "" },
      { position: 1, path: "c:/work", description: "" },
    ], patterns),
  ];
  for (const result of invalidRows) {
    assert(!result.ok);
    assertEquals(result.error.code, "internal");
    assert(!result.error.message.includes("/work"));
  }
});
