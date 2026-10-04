import { assert, assertEquals } from "@std/assert";
import { err, ok, type Result } from "../../base/mod.ts";
import type { ProjectEvent } from "./authorization.ts";
import type { TargetAuthorizer } from "../../contracts/platform/mod.ts";
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
const commands = createProjectCommands();
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
] as unknown as (TargetAuthorizer | undefined)[];

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
    const project = seed(fixture);
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
    let current = project;
    const seen: ProjectEvent[] = [];
    const authorize: TargetAuthorizer = (_ctx, operation, target) => {
      assertEquals(target.project, current.id);
      assertEquals(operation, target.event_type);
      seen.push(operation === "ProjectCreated" ? historical : updated);
      return current.purpose === "revoked"
        ? err({ code: "forbidden", message: "scope changed" })
        : ok(undefined);
    };
    fixture.use(authorize);
    const visibility = createProjectEventVisibility();
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
    assertEquals(seen, [historical, updated]);
    fixture.use(() => ok(undefined));
    current = keep(
      fixture.transaction((tx) =>
        commands.update.handle(tx, userContext(), {
          project: ids.project,
          purpose: "revoked",
        }, { base_revision: project.revision })
      ),
    );
    fixture.use(authorize);
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
    const closed = createProjectEventVisibility();
    const refuse: TargetAuthorizer = () => {
      throw new Error("nonuser must not authorize");
    };
    fixture.use(refuse);
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
    fixture.use(authorize);
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
    const visibilityClosed = createProjectEventVisibility();
    for (const authorize of malformed) {
      fixture.use(authorize as TargetAuthorizer);
      code(
        visibilityClosed.created.handle(
          fixture.snapshot(),
          userContext(),
          historical as Extract<ProjectEvent, { type: "ProjectCreated" }>,
        ),
        "unavailable",
      );
    }
    const missingPort = fixture.snapshot();
    missingPort.port = (() => {
      throw new Error("unregistered project port");
    }) as typeof missingPort.port;
    code(
      visibilityClosed.created.handle(
        missingPort,
        userContext(),
        historical as Extract<ProjectEvent, { type: "ProjectCreated" }>,
      ),
      "unavailable",
    );
    for (const failure of ["internal", "unavailable"] as const) {
      fixture.use(() => err({ code: failure, message: "dependency failure" }));
      code(
        visibilityClosed.created.handle(
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
    const seenEvents: ProjectEvent[] = [];
    const authorize: TargetAuthorizer = (_ctx, operation, target) => {
      assertEquals(target.project, project.id);
      assertEquals(target.event_type, operation);
      seenEvents.push(operation === "ProjectArchived" ? archived : unarchived);
      calls.push(operation);
      return ok(undefined);
    };
    fixture.use(authorize);
    const visibility = createProjectEventVisibility();
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
    assertEquals(seenEvents, [archived, unarchived]);
    const missing = createProjectEventVisibility();
    const missingPort = fixture.snapshot();
    missingPort.port = (() => {
      throw new Error("unregistered project port");
    }) as typeof missingPort.port;
    code(
      missing.archived.handle(missingPort, userContext(), archived),
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
    const denied = createProjectEventVisibility();
    fixture.use(() => err({ code: "not_found", message: "hidden" }));
    assertEquals(
      keep(
        denied.archived.handle(
          fixture.snapshot(),
          userContext(),
          archived,
        ),
      ),
      false,
    );
  } finally {
    fixture.close();
  }
});
