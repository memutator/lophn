import { assert, assertEquals } from "@std/assert";
import { err, ok, type Result } from "../../base/mod.ts";
import type { TargetAuthorizer } from "../../contracts/platform/mod.ts";
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
function seed(fixture: ReturnType<typeof projectFixture>) {
  return keep(
    fixture.transaction((tx) =>
      commands.create.handle(tx, userContext(), input, {})
    ),
  );
}
import type { DocumentRef } from "../../contracts/documents/mod.ts";
import { createProjectReads, type ProjectReadDeps } from "./reads.ts";
const documents: DocumentRef[] = [
  { document: ids.doc, version: ids.version, section: null },
  {
    document: "doc_01arz3ndektsv4rrffq69g5faw",
    version: ids.version,
    section: null,
  },
];
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

Deno.test("documents/projects#R8: per-document authorization determines counts and projections in the same snapshot", () => {
  const fixture = projectFixture();
  try {
    const project = seed(fixture);
    const snapshot = fixture.snapshot();
    const seen: string[] = [];
    const authorize: TargetAuthorizer = (_ctx, operation, target) => {
      assert(["project.get", "project.list"].includes(operation));
      assertEquals(target.project, project.id);
      const kind = "document" in target ? "document" : "project";
      seen.push(kind);
      if (kind === "document") {
        assert(documents.some((doc) => doc.document === target.document));
        assertEquals(target.version, ids.version);
        return target.document === ids.doc
          ? ok(undefined)
          : err({ code: "not_found", message: "hidden" });
      }
      return ok(undefined);
    };
    const deps: ProjectReadDeps = {
      documents(received, id) {
        assertEquals(received, snapshot);
        assertEquals(id, project.id);
        return ok(documents);
      },
    };
    const reads = createProjectReads(deps);
    fixture.use(authorize);
    const user = keep(
      reads.get.handle(snapshot, userContext(), { project: project.id }),
    );
    assert("document_count" in user.project);
    assertEquals(user.project.document_count, 1);
    assertEquals(user.project.documents, [documents[0]]);
    const agent = keep(
      reads.list.handle(
        snapshot,
        userContext("agent:asg_01arz3ndektsv4rrffq69g5fav"),
        { limit: 1 },
      ),
    );
    assertEquals(agent.projects[0]?.documents, [documents[0]]);
    assertEquals(agent.next_cursor, null);
    assertEquals(agent.omitted, undefined);
    assertEquals(seen, [
      "project",
      "document",
      "document",
      "project",
      "document",
      "document",
    ]);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/projects#R9: get and list recheck current project and document scope", () => {
  const fixture = projectFixture();
  try {
    seed(fixture);
    keep(
      fixture.transaction((tx) =>
        commands.create.handle(tx, userContext(), {
          ...input,
          id: ids.other,
          name: "other",
        }, {})
      ),
    );
    let projectAllowed = true;
    let documentAllowed = true;
    const reads = createProjectReads({
      documents: () => ok(documents),
    });
    const authorize: TargetAuthorizer = (_ctx, _operation, target) =>
      target.project === ids.project && projectAllowed &&
        (!("document" in target) || documentAllowed)
        ? ok(undefined)
        : err({ code: "forbidden", message: "scope changed" });
    fixture.use(authorize);
    const get = () =>
      reads.get.handle(fixture.snapshot(), userContext(), {
        project: ids.project,
      });
    const list = () =>
      reads.list.handle(fixture.snapshot(), userContext(), { limit: 1 });
    assertEquals(keep(get()).project.documents.length, 2);
    documentAllowed = false;
    assertEquals(keep(get()).project.documents, []);
    assertEquals(keep(list()).projects[0]?.documents, []);
    projectAllowed = false;
    code(get(), "not_found");
    assertEquals(keep(list()).projects, []);
    assertEquals(keep(list()).omitted, undefined);
    assertEquals(keep(list()).next_cursor, null);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/projects#R9: malformed document candidates and dependency failures return safe errors", () => {
  const fixture = projectFixture();
  try {
    seed(fixture);
    const get = (deps: ProjectReadDeps) =>
      createProjectReads(deps).get.handle(fixture.snapshot(), userContext(), {
        project: ids.project,
      });
    code(
      get({
        documents: () =>
          ok([{ document: "private bad ref" }] as unknown as DocumentRef[]),
      }),
      "internal",
    );
    const unfixed = createProjectReads({
      documents: () => ok([{ ...documents[0]!, version: null }]),
    });
    for (const actor of ["user", "agent:asg_01arz3ndektsv4rrffq69g5fav"]) {
      const ctx = userContext(actor);
      code(
        unfixed.get.handle(fixture.snapshot(), ctx, {
          project: ids.project,
        }),
        "internal",
      );
      code(unfixed.list.handle(fixture.snapshot(), ctx, {}), "internal");
    }
    code(
      unfixed.resolve.handle(fixture.snapshot(), userContext(), {
        path: "/work/notes/file.md",
      }),
      "internal",
    );
    const brokenPort = () => {
      const snapshot = fixture.snapshot();
      snapshot.port = (() => {
        throw new Error("unregistered project port");
      }) as typeof snapshot.port;
      return snapshot;
    };
    const readsFor = (deps: ProjectReadDeps) => createProjectReads(deps);
    for (const authorize of malformed) {
      fixture.use(authorize as TargetAuthorizer);
      code(
        readsFor({ documents: () => ok(documents) }).get.handle(
          fixture.snapshot(),
          userContext(),
          { project: ids.project },
        ),
        "unavailable",
      );
    }
    code(
      readsFor({ documents: () => ok(documents) }).get.handle(
        brokenPort(),
        userContext(),
        { project: ids.project },
      ),
      "unavailable",
    );
    code(
      get({} as unknown as ProjectReadDeps),
      "unavailable",
    );
    code(
      get({
        documents: (async () =>
          await ok(documents)) as unknown as ProjectReadDeps["documents"],
      }),
      "unavailable",
    );
    for (const failure of ["internal", "unavailable"] as const) {
      fixture.use((_ctx, _op, target) =>
        "document" in target
          ? err({ code: failure, message: "dependency failure" })
          : ok(undefined)
      );
      code(
        readsFor({ documents: () => ok(documents) }).get.handle(
          fixture.snapshot(),
          userContext(),
          { project: ids.project },
        ),
        failure,
      );
    }
    const reads = createProjectReads({
      documents: () => ok([]),
    });
    for (const actor of ["machine", "unknown"]) {
      code(
        reads.get.handle(fixture.snapshot(), userContext(actor), {
          project: ids.project,
        }),
        "forbidden",
      );
      code(
        reads.list.handle(fixture.snapshot(), userContext(actor), {}),
        "forbidden",
      );
    }
  } finally {
    fixture.close();
  }
});

Deno.test("documents/projects#R9: pagination binds query credential snapshot and authorized references", () => {
  const fixture = projectFixture();
  try {
    seed(fixture);
    keep(fixture.transaction((tx) =>
      commands.create.handle(tx, userContext(), {
        ...input,
        id: ids.other,
        name: "other",
      }, {})
    ));
    let documentAllowed = true;
    let projectAllowed = true;
    const reads = createProjectReads({
      documents: () => ok(documents),
    });
    const authorize: TargetAuthorizer = (_ctx, _op, target) =>
      (target.project !== ids.other || projectAllowed) &&
        (!("document" in target) || documentAllowed)
        ? ok(undefined)
        : err({ code: "forbidden", message: "scope changed" });
    fixture.use(authorize);
    const ctx = userContext("agent:asg_01arz3ndektsv4rrffq69g5fav");
    const snapshot = fixture.snapshot();
    const first = keep(reads.list.handle(snapshot, ctx, { limit: 1 }));
    assert(first.next_cursor !== null);
    assertEquals(first.omitted, [{ reason: "page_limit", count: 1 }]);
    const cursor = first.next_cursor;
    const next = keep(reads.list.handle(snapshot, ctx, { limit: 1, cursor }));
    assertEquals(next.projects.map((project) => project.id), [ids.other]);
    assertEquals(next.next_cursor, null);
    const body = new TextDecoder().decode(
      Uint8Array.from(atob(cursor), (char) => char.charCodeAt(0)),
    );
    assert(!body.includes("/work"));
    assert(!body.includes("folders"));
    for (
      const changed of [
        { ...ctx, credential_ref: "different" },
        { ...ctx, principal: "different" },
        userContext(),
      ]
    ) {
      code(
        reads.list.handle(snapshot, changed, { limit: 1, cursor }),
        "invalid_input",
      );
    }
    code(
      reads.list.handle(snapshot, ctx, { limit: 2, cursor }),
      "invalid_input",
    );
    code(
      reads.list.handle(snapshot, ctx, { limit: 1, status: "active", cursor }),
      "invalid_input",
    );
    code(
      reads.list.handle(fixture.snapshot("99"), ctx, { limit: 1, cursor }),
      "conflict",
    );
    documentAllowed = false;
    code(reads.list.handle(snapshot, ctx, { limit: 1, cursor }), "conflict");
    documentAllowed = true;
    projectAllowed = false;
    code(reads.list.handle(snapshot, ctx, { limit: 1, cursor }), "conflict");
    const filtered = keep(reads.list.handle(snapshot, ctx, { limit: 1 }));
    assertEquals(filtered.next_cursor, null);
    assertEquals(filtered.omitted, undefined);
    for (
      const malformed of ["1", "not-base64", btoa("{}"), btoa('{"offset":-1}')]
    ) {
      code(
        reads.list.handle(snapshot, ctx, { limit: 1, cursor: malformed }),
        "invalid_input",
      );
    }
  } finally {
    fixture.close();
  }
});
