import { assert, assertEquals } from "@std/assert";
import { err, ok, type Result } from "../../base/mod.ts";
import type { Project } from "../../protocol/projects/mod.ts";
import type { RequestContext, Tx } from "../../protocol/platform/mod.ts";
import type { TargetAuthorizer } from "../../protocol/platform/mod.ts";
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
const commands = createProjectCommands();
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
function mutations(project: Project) {
  const handlers = createProjectCommands();
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
    let authorized = false;
    fixture.use(() => {
      authorized = true;
      throw new Error("must not authorize nonuser");
    });
    for (
      const actor of [
        "machine",
        "unknown",
        "agent:asg_01arz3ndektsv4rrffq69g5fav",
        "coding_agent:cac_01arz3ndektsv4rrffq69g5fav",
        "app:app_01arz3ndektsv4rrffq69g5fav",
      ]
    ) {
      for (const mutation of mutations(project)) {
        code(
          fixture.transaction((tx) =>
            mutation(noWrites(tx), userContext(actor))
          ),
          "forbidden",
        );
      }
    }
    assertEquals(authorized, false);
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
    const reject: TargetAuthorizer = (ctx, operation, target) => {
      assertEquals(ctx.credential_ref, "current");
      if (operation === "project.create") {
        assertEquals(target, { project: ids.other });
      } else {
        assertEquals(target, {
          project: project.id,
          before_project: project.id,
        });
      }
      seen.push(operation);
      return err({ code: "forbidden", message: "outside current scope" });
    };
    fixture.use(reject);
    for (const mutation of mutations(project).slice(0, 3)) {
      code(
        fixture.transaction((tx) => mutation(noWrites(tx), userContext())),
        "forbidden",
      );
    }
    assertEquals(fixture.emitted.length, 1);
    assertEquals(fixture.sql.all("SELECT slug FROM place_names", []).length, 1);
    fixture.use(() => ok(undefined));
    project = keep(
      fixture.transaction((tx) =>
        commands.archive.handle(tx, userContext(), { project: project.id }, {
          base_revision: project.revision,
        })
      ),
    );
    fixture.use(reject);
    const unarchive = mutations(project)[3]!;
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
    const denied = createProjectCommands();
    const deny: TargetAuthorizer = (_ctx, operation, target) => {
      assertEquals(target.before_project, project.id);
      assertEquals(target.project, project.id);
      seen.push(operation);
      return err({ code: "forbidden", message: "outside current scope" });
    };
    fixture.use(deny);
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
    fixture.use(() => ok(undefined));
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
    fixture.use(deny);
    code(
      fixture.transaction((tx) =>
        denied.unarchive.handle(noWrites(tx), userContext(), {
          project: project.id,
        }, { base_revision: project.revision })
      ),
      "forbidden",
    );
    fixture.use(() => ok(undefined));
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
] as unknown as (TargetAuthorizer | undefined)[];

function missingPort(tx: Tx): Tx {
  return {
    ...tx,
    port: (() => {
      throw new Error("unregistered project port");
    }) as Tx["port"],
  };
}

Deno.test("documents/projects#R1: missing async and malformed mutation authorizers fail closed", () => {
  const fixture = projectFixture();
  try {
    let project = seed(fixture);
    for (const authorize of malformed) {
      fixture.use(authorize as TargetAuthorizer);
      for (const mutation of mutations(project).slice(0, 3)) {
        code(
          fixture.transaction((tx) => mutation(noWrites(tx), userContext())),
          "unavailable",
        );
      }
    }
    fixture.use(() => ok(undefined));
    for (const mutation of mutations(project).slice(0, 3)) {
      code(
        fixture.transaction((tx) =>
          mutation(missingPort(noWrites(tx)), userContext())
        ),
        "unavailable",
      );
    }
    project = keep(
      fixture.transaction((tx) =>
        commands.archive.handle(tx, userContext(), { project: project.id }, {
          base_revision: project.revision,
        })
      ),
    );
    for (const authorize of malformed) {
      fixture.use(authorize as TargetAuthorizer);
      code(
        fixture.transaction((tx) =>
          mutations(project)[3]!(noWrites(tx), userContext())
        ),
        "unavailable",
      );
    }
    code(
      fixture.transaction((tx) =>
        mutations(project)[3]!(missingPort(noWrites(tx)), userContext())
      ),
      "unavailable",
    );
  } finally {
    fixture.close();
  }
});
