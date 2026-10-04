import { assert, assertEquals } from "@std/assert";
import { err, ok, type Result } from "../../base/mod.ts";
import type { ProjectAuthorizer, ProjectEvent } from "./authorization.ts";
import { createProjectCommands } from "./commands.ts";
import { createProjectEventVisibility } from "./visibility.ts";
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
function seed(fixture: ReturnType<typeof projectFixture>) {
  return keep(
    fixture.transaction((tx) =>
      commands.create.handle(tx, userContext(), input, {})
    ),
  );
}
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

function event(): ProjectEvent {
  return {
    seq: "1",
    type: "ProjectCreated",
    subject: ids.project,
    actor: "user",
    run: null,
    at: "2026-10-04T00:00:00.000Z",
    payload: {
      ...input,
      folders: [{ path: "/historical/private", description: "old" }],
    },
  };
}

Deno.test("documents/projects#R9: raw events hide nonusers and authorize current project plus historical envelope", () => {
  const fixture = projectFixture();
  try {
    let project = seed(fixture);
    const historical = event();
    const updated: ProjectEvent = {
      ...historical,
      type: "ProjectUpdated",
      payload: {
        before: {
          folders: [{ path: "/old", description: "old" }],
        },
        after: { folders: input.folders },
      },
    };
    const visibility = createProjectEventVisibility({
      authorize(_ctx, operation, target) {
        assert(target.kind === "event");
        assertEquals(target.project, project);
        assertEquals(operation, target.event.type);
        assertEquals(
          target.event,
          target.event.type === "ProjectCreated" ? historical : updated,
        );
        return target.project.purpose === "revoked"
          ? err({ code: "forbidden", message: "scope changed" })
          : ok(undefined);
      },
    });
    assertEquals(
      keep(
        visibility.created.handle(
          fixture.snapshot(),
          userContext(),
          historical as Extract<ProjectEvent, { type: "ProjectCreated" }>,
        ),
      ),
      true,
    );
    assertEquals(
      keep(
        visibility.updated.handle(
          fixture.snapshot(),
          userContext(),
          updated as Extract<ProjectEvent, { type: "ProjectUpdated" }>,
        ),
      ),
      true,
    );
    project = keep(
      fixture.transaction((tx) =>
        commands.update.handle(tx, userContext(), {
          project: ids.project,
          purpose: "revoked",
        }, { base_revision: project.revision })
      ),
    );
    assertEquals(
      keep(
        visibility.created.handle(
          fixture.snapshot(),
          userContext(),
          historical as Extract<ProjectEvent, { type: "ProjectCreated" }>,
        ),
      ),
      false,
    );
    const closed = createProjectEventVisibility({
      authorize: () => {
        throw new Error("nonuser must not authorize");
      },
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
      assertEquals(
        keep(
          closed.created.handle(
            fixture.snapshot(),
            userContext(actor),
            historical as Extract<ProjectEvent, { type: "ProjectCreated" }>,
          ),
        ),
        false,
      );
    }
    const absent = { ...historical, subject: ids.other } as Extract<
      ProjectEvent,
      { type: "ProjectCreated" }
    >;
    assertEquals(
      keep(
        visibility.created.handle(fixture.snapshot(), userContext(), absent),
      ),
      false,
    );
    for (const authorize of malformed) {
      code(
        createProjectEventVisibility({
          authorize: authorize as ProjectAuthorizer,
        }).created.handle(
          fixture.snapshot(),
          userContext(),
          historical as Extract<ProjectEvent, { type: "ProjectCreated" }>,
        ),
        "unavailable",
      );
    }
    for (const failure of ["internal", "unavailable"] as const) {
      code(
        createProjectEventVisibility({
          authorize: () =>
            err({ code: failure, message: "dependency failure" }),
        }).created.handle(
          fixture.snapshot(),
          userContext(),
          historical as Extract<ProjectEvent, { type: "ProjectCreated" }>,
        ),
        failure,
      );
    }
  } finally {
    fixture.close();
  }
});

Deno.test("documents/projects#R9: archive events authorize exact envelope and missing dependencies fail closed", () => {
  const fixture = projectFixture();
  try {
    const project = seed(fixture);
    const common = {
      seq: "2",
      subject: project.id,
      actor: "user",
      run: null,
      at: "2026-10-04T00:00:00.000Z",
      payload: { before_revision: project.revision },
    };
    const archived = { ...common, type: "ProjectArchived" as const };
    const unarchived = { ...common, type: "ProjectUnarchived" as const };
    const calls: string[] = [];
    const visibility = createProjectEventVisibility({
      authorize(_ctx, operation, target) {
        assert(target.kind === "event");
        assertEquals(target.project, project);
        assertEquals(
          target.event,
          operation === "ProjectArchived" ? archived : unarchived,
        );
        calls.push(operation);
        return ok(undefined);
      },
    });
    assertEquals(
      keep(
        visibility.archived.handle(fixture.snapshot(), userContext(), archived),
      ),
      true,
    );
    assertEquals(
      keep(
        visibility.unarchived.handle(
          fixture.snapshot(),
          userContext(),
          unarchived,
        ),
      ),
      true,
    );
    assertEquals(calls, ["ProjectArchived", "ProjectUnarchived"]);
    const missing = createProjectEventVisibility(
      undefined as unknown as { authorize: ProjectAuthorizer },
    );
    code(
      missing.archived.handle(fixture.snapshot(), userContext(), archived),
      "unavailable",
    );
    assertEquals(
      keep(
        missing.unarchived.handle(
          fixture.snapshot(),
          userContext("machine"),
          unarchived,
        ),
      ),
      false,
    );
    const denied = createProjectEventVisibility({
      authorize: () => err({ code: "not_found", message: "hidden" }),
    });
    assertEquals(
      keep(denied.archived.handle(fixture.snapshot(), userContext(), archived)),
      false,
    );
  } finally {
    fixture.close();
  }
});
