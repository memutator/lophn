import { assert, assertEquals } from "@std/assert";
import { err, ok, type Result } from "../../base/mod.ts";
import type { Project } from "../../contracts/documents/mod.ts";
import type { RequestContext, Tx } from "../../contracts/platform/mod.ts";
import type { ProjectAuthorizer } from "./authorization.ts";
import { createProjectCommands } from "./commands.ts";
import { ids, keep, projectFixture, userContext } from "./testing-fixture.ts";

const input = {
  id: ids.project,
  name: "notes",
  title: "Notes",
  purpose: "keep",
  folders: [{ path: "/work/notes", description: "notes" }],
  tracking: { enabled: false as const, patterns: [], use_gitignore: false },
};
const commands = createProjectCommands({ authorize: () => ok(undefined) });
function code(result: Result<unknown>, expected: string) {
  assert(!result.ok);
  assertEquals(result.error.code, expected);
}
function seed(fixture: ReturnType<typeof projectFixture>): Project {
  return keep(
    fixture.transaction((tx) =>
      commands.create.handle(tx, userContext(), input, {})
    ),
  );
}
function noWrites(tx: Tx): Tx {
  return {
    ...tx,
    sql: {
      ...tx.sql,
      run: () => {
        throw new Error("unauthorized SQL write");
      },
    },
    emit: () => {
      throw new Error("unauthorized event");
    },
  };
}
function mutations(authorize: ProjectAuthorizer, project: Project) {
  const handlers = createProjectCommands({ authorize });
  return [
    (tx: Tx, ctx: RequestContext) =>
      handlers.create.handle(tx, ctx, {
        ...input,
        id: ids.other,
        name: "other",
      }, {}),
    (tx: Tx, ctx: RequestContext) =>
      handlers.update.handle(tx, ctx, {
        project: project.id,
        name: "renamed",
        title: "Next",
        purpose: "next",
      }, { base_revision: project.revision }),
    (tx: Tx, ctx: RequestContext) =>
      handlers.archive.handle(tx, ctx, {
        project: project.id,
      }, { base_revision: project.revision }),
    (tx: Tx, ctx: RequestContext) =>
      handlers.unarchive.handle(tx, ctx, {
        project: project.id,
      }, { base_revision: project.revision }),
  ];
}

Deno.test("documents/projects#R1: all mutations reject nonusers before authorization or writes", () => {
  const fixture = projectFixture();
  try {
    const project = seed(fixture);
    const reject: ProjectAuthorizer = () => {
      throw new Error("must not authorize nonuser");
    };
    for (
      const actor of [
        "machine",
        "unknown",
        "agent:asg_01arz3ndektsv4rrffq69g5fav",
        "coding_agent:cac_01arz3ndektsv4rrffq69g5fav",
        "app:app_01arz3ndektsv4rrffq69g5fav",
      ]
    ) {
      for (const mutation of mutations(reject, project)) {
        code(
          fixture.transaction((tx) =>
            mutation(noWrites(tx), userContext(actor))
          ),
          "forbidden",
        );
      }
    }
    assertEquals(fixture.emitted.length, 1);
    assertEquals(fixture.sql.all("SELECT slug FROM place_names", []).length, 1);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/projects#R1: scoped mutation decisions receive full before and candidate before any write", () => {
  const fixture = projectFixture();
  try {
    let project = seed(fixture);
    const seen: string[] = [];
    const reject: ProjectAuthorizer = (ctx, operation, target) => {
      assertEquals(ctx.credential_ref, "current");
      assertEquals(target.kind, "command");
      assert(target.kind === "command");
      assertEquals(Object.keys(target.after).sort(), [
        "folders",
        "id",
        "name",
        "purpose",
        "status",
        "title",
        "tracking",
      ]);
      assertEquals(target.after.folders, input.folders);
      assertEquals(target.after.tracking, input.tracking);
      if (operation === "project.create") {
        assertEquals(target.before, null);
        assertEquals(target.after.id, ids.other);
      } else {
        assertEquals(target.before, project);
        assertEquals(target.after.id, project.id);
        if (operation === "project.update") {
          assertEquals(target.after.name, "renamed");
          assertEquals(target.after.purpose, "next");
          assertEquals(target.after.title, "Next");
        }
      }
      seen.push(operation);
      return err({ code: "forbidden", message: "outside current scope" });
    };
    for (const mutation of mutations(reject, project).slice(0, 3)) {
      code(
        fixture.transaction((tx) => mutation(noWrites(tx), userContext())),
        "forbidden",
      );
    }
    assertEquals(fixture.emitted.length, 1);
    assertEquals(fixture.sql.all("SELECT slug FROM place_names", []).length, 1);
    project = keep(
      fixture.transaction((tx) =>
        commands.archive.handle(tx, userContext(), { project: project.id }, {
          base_revision: project.revision,
        })
      ),
    );
    const unarchive = mutations(reject, project)[3]!;
    code(
      fixture.transaction((tx) => unarchive(noWrites(tx), userContext())),
      "forbidden",
    );
    assertEquals(seen, [
      "project.create",
      "project.update",
      "project.archive",
      "project.unarchive",
    ]);
    assertEquals(fixture.emitted.length, 2);
    assertEquals(
      fixture.sql.get("SELECT status FROM projects", [])?.status,
      "archived",
    );
  } finally {
    fixture.close();
  }
});

Deno.test("documents/projects#R1: owner denial precedes CAS state and tracking overlap checks", () => {
  const fixture = projectFixture();
  try {
    let project = seed(fixture);
    const seen: string[] = [];
    const denied = createProjectCommands({
      authorize(_ctx, operation, target) {
        assert(target.kind === "command");
        assertEquals(target.before, project);
        seen.push(operation);
        return err({ code: "forbidden", message: "outside current scope" });
      },
    });
    const stale = { base_revision: "999" };
    code(
      fixture.transaction((tx) =>
        denied.update.handle(noWrites(tx), userContext(), {
          project: project.id,
          title: "Next",
        }, stale)
      ),
      "forbidden",
    );
    code(
      fixture.transaction((tx) =>
        denied.update.handle(noWrites(tx), userContext(), {
          project: project.id,
          title: project.title,
        }, { base_revision: project.revision })
      ),
      "forbidden",
    );
    code(
      fixture.transaction((tx) =>
        denied.archive.handle(noWrites(tx), userContext(), {
          project: project.id,
        }, stale)
      ),
      "forbidden",
    );
    code(
      fixture.transaction((tx) =>
        denied.unarchive.handle(noWrites(tx), userContext(), {
          project: project.id,
        }, { base_revision: project.revision })
      ),
      "forbidden",
    );
    keep(fixture.transaction((tx) =>
      commands.create.handle(tx, userContext(), {
        ...input,
        id: ids.other,
        name: "parent",
        folders: [{ path: "/work", description: "" }],
      }, {})
    ));
    project = keep(
      fixture.transaction((tx) =>
        commands.archive.handle(tx, userContext(), { project: project.id }, {
          base_revision: project.revision,
        })
      ),
    );
    fixture.sql.run("UPDATE projects SET tracking_enabled = 1", []);
    project = { ...project, tracking: { ...project.tracking, enabled: true } };
    code(
      fixture.transaction((tx) =>
        denied.unarchive.handle(noWrites(tx), userContext(), {
          project: project.id,
        }, { base_revision: project.revision })
      ),
      "forbidden",
    );
    code(
      fixture.transaction((tx) =>
        commands.unarchive.handle(noWrites(tx), userContext(), {
          project: project.id,
        }, { base_revision: project.revision })
      ),
      "conflict",
    );
    assertEquals(seen, [
      "project.update",
      "project.update",
      "project.archive",
      "project.unarchive",
      "project.unarchive",
    ]);
    assertEquals(fixture.emitted.length, 3);
    assertEquals(fixture.sql.all("SELECT slug FROM place_names", []).length, 2);
  } finally {
    fixture.close();
  }
});

const malformed = [
  undefined,
  () => true,
  () => ({ ok: true }),
  () => ok(true),
  () => ({ ok: false, error: { code: "unknown", message: "bad" } }),
  async () => await ok(undefined),
  () => {
    throw new Error("private detail");
  },
] as unknown as (ProjectAuthorizer | undefined)[];

Deno.test("documents/projects#R1: missing async and malformed mutation authorizers fail closed", () => {
  const fixture = projectFixture();
  try {
    let project = seed(fixture);
    for (const authorize of malformed) {
      for (
        const mutation of mutations(authorize as ProjectAuthorizer, project)
          .slice(0, 3)
      ) {
        code(
          fixture.transaction((tx) => mutation(noWrites(tx), userContext())),
          "unavailable",
        );
      }
    }
    project = keep(
      fixture.transaction((tx) =>
        commands.archive.handle(tx, userContext(), { project: project.id }, {
          base_revision: project.revision,
        })
      ),
    );
    for (const authorize of malformed) {
      code(
        fixture.transaction((tx) =>
          mutations(authorize as ProjectAuthorizer, project)[3]!(
            noWrites(tx),
            userContext(),
          )
        ),
        "unavailable",
      );
    }
  } finally {
    fixture.close();
  }
});
