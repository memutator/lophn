import { assert, assertEquals } from "@std/assert";
import { ok } from "../../base/mod.ts";
import { createVersionCommands } from "./commands.ts";
import {
  file,
  ids,
  preparedInput,
  userContext,
  versionFixture,
} from "./testing/mod.ts";

const commands = createVersionCommands();

function save(
  fixture: ReturnType<typeof versionFixture>,
  input: ReturnType<typeof preparedInput>,
  actor: ReturnType<typeof userContext> = userContext(),
  compare: { base_version: string | null } = {
    base_version: input.base_version,
  },
) {
  return fixture.transaction((tx) =>
    commands.save.handle(tx, actor, input as never, compare)
  );
}

Deno.test("documents/versions#R20: 지침 문서의 agent save는 forbidden", () => {
  const docId = ids.doc;
  const instructionAttachments = {
    attachments: (d: string) =>
      d === docId ? ok([{ preset: "pst_aaa", revision: 1 }]) : ok([]),
  };
  const fixture = versionFixture(undefined, instructionAttachments);
  try {
    // Create as user first
    const createRes = save(
      fixture,
      preparedInput(docId, [file("LOPHN.md", true, 100)]),
    );
    assert(createRes.ok);

    // Agent save should be forbidden
    if (!createRes.ok) throw new Error("setup failed");
    const agentRes = save(
      fixture,
      preparedInput(docId, [file("LOPHN.md", true, 101)]),
      userContext("agent:agn_aaa"),
      { base_version: createRes.value.version },
    );
    assert(!agentRes.ok);
    assertEquals(agentRes.error?.code, "forbidden");
  } finally {
    fixture.db.close();
  }
});

Deno.test("documents/versions#R20: 지침 문서의 agent update는 forbidden", () => {
  const docId = ids.doc;
  const instructionAttachments = {
    attachments: (d: string) =>
      d === docId ? ok([{ preset: "pst_aaa", revision: 1 }]) : ok([]),
  };
  const fixture = versionFixture(undefined, instructionAttachments);
  try {
    // Create as user first
    const createRes = save(
      fixture,
      preparedInput(docId, [file("LOPHN.md", true, 100)]),
    );
    assert(createRes.ok);

    // Agent update title should be forbidden
    const agentRes = fixture.transaction((tx) =>
      commands.update.handle(
        tx,
        userContext("agent:agn_aaa"),
        { document: docId, title: "Updated" } as never,
        { base_revision: (createRes as any).value.revision },
      )
    );
    assert(!agentRes.ok);
    assertEquals(agentRes.error?.code, "forbidden");
  } finally {
    fixture.db.close();
  }
});

Deno.test("documents/versions#R20: 지침 문서는 user save는 allowed", () => {
  const docId = ids.doc;
  const instructionAttachments = {
    attachments: (d: string) =>
      d === docId ? ok([{ preset: "pst_aaa", revision: 1 }]) : ok([]),
  };
  const fixture = versionFixture(undefined, instructionAttachments);
  try {
    // Create as user
    const createRes = save(
      fixture,
      preparedInput(docId, [file("LOPHN.md", true, 100)]),
    );
    assert(createRes.ok);

    // User save allowed (should not be blocked by instruction file protection)
    const userSaveRes = fixture.transaction((tx) =>
      commands.save.handle(
        tx,
        userContext(),
        {
          ...preparedInput(docId, [file("LOPHN.md", true, 101)]),
          base_version: (createRes as any).value.version,
        } as never,
        { base_version: (createRes as any).value.version },
      )
    );
    assert(userSaveRes.ok, `user save failed: ${JSON.stringify(userSaveRes)}`);
  } finally {
    fixture.db.close();
  }
});

Deno.test("documents/versions#R20: 지침 문서의 coding_agent·app save도 forbidden", () => {
  const docId = ids.doc;
  const instructionAttachments = {
    attachments: (d: string) =>
      d === docId ? ok([{ preset: "pst_aaa", revision: 1 }]) : ok([]),
  };
  const fixture = versionFixture(undefined, instructionAttachments);
  try {
    const createRes = save(
      fixture,
      preparedInput(docId, [file("LOPHN.md", true, 100)]),
    );
    assert(createRes.ok);

    // coding_agent save should be forbidden
    const codingRes = fixture.transaction((tx) =>
      commands.save.handle(
        tx,
        userContext("coding_agent:cag_aaa"),
        preparedInput(docId, [file("LOPHN.md", true, 101)]) as never,
        { base_version: (createRes as any).value.version },
      )
    );
    assert(!codingRes.ok);
    assertEquals(codingRes.error?.code, "forbidden");

    // app save should be forbidden
    const appRes = fixture.transaction((tx) =>
      commands.save.handle(
        tx,
        userContext("app:app_aaa"),
        preparedInput(docId, [file("LOPHN.md", true, 101)]) as never,
        { base_version: (createRes as any).value.version },
      )
    );
    assert(!appRes.ok);
    assertEquals(appRes.error?.code, "forbidden");
  } finally {
    fixture.db.close();
  }
});
