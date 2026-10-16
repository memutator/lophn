import { assert, assertEquals } from "@std/assert";
import type { RequestContext, Tx } from "../../../protocol/server/mod.ts";
import type { AgentRef } from "../../../protocol/lophn-agent/mod.ts";
import { createNodeAgentFiles } from "./adapters/node-fs.ts";
import { createAgentCommands } from "./commands.ts";
import { ensureLophn, ensureProjectManager } from "./ensure.ts";
import type { AgentLookups } from "./ports.ts";
import { createAgentStore, slotOf } from "./store.ts";

const PROJECT = "prj_00000000000000000000000001";
const OTHER = "prj_00000000000000000000000002";
const OPERATOR = "agt_00000000000000000000000001";
const user = {} as RequestContext;
const tx = { sql: {} } as unknown as Tx;

const lookups: AgentLookups = {
  placeExists: (place) => place.id === PROJECT,
  places: () => [{ kind: "project", id: PROJECT }],
  contextStatus: () => null,
  contextProject: () => null,
  activeContexts: () => [],
  skills: () => [],
  mcp: () => [],
  modelDefault: () => null,
};

Deno.test("Operator만 사람이 만들고 지운다: built-in 정의는 이름·삭제·없는 place로 만들어지지 않는다", async () => {
  const root = await Deno.makeTempDir();
  try {
    const files = createNodeAgentFiles();
    const commands = createAgentCommands({
      files,
      lookups: () => lookups,
      dataRoot: root,
    });
    const place = { kind: "project", id: PROJECT } as const;
    const create = (name: string, id = OPERATOR) =>
      commands.create.handle(
        tx,
        user,
        { id: id as never, place, definition: { name, body: "do it" } },
        {} as never,
      );

    // built-in 이름을 Operator가 쓰지 못한다.
    for (const name of ["lophn", "Project Manager", "app engineer"]) {
      const made = create(name);
      assert(!made.ok);
      assertEquals(made.error.code, "invalid_input");
    }
    // 같은 이름의 Operator 둘은 없다.
    assert(create("reviewer").ok);
    const twin = create("Reviewer", "agt_00000000000000000000000002");
    assert(!twin.ok);
    assertEquals(twin.error.code, "invalid_input");

    // 없는 place에는 built-in도 Operator도 생기지 않는다.
    const stranger = { role: "project_manager", project: OTHER } as AgentRef;
    const changed = commands.changeBuiltin.handle(
      tx,
      user,
      { agent: stranger as never, definition: { body: "x" } },
      { hash: null },
    );
    assert(!changed.ok);
    assertEquals(changed.error.code, "not_found");

    // Operator 삭제는 Operator 파일만 지운다. built-in 파일은 ensure가 만든 채로 남는다.
    assert(ensureLophn({ files, root }).ok);
    assert(ensureProjectManager({ files, root }, PROJECT).ok);
    const store = createAgentStore(files, root);
    const manager = slotOf(root, {
      role: "project_manager",
      project: PROJECT as never,
    })!;
    const stored = store.read(
      slotOf(root, { role: "operator", agent: OPERATOR as never }, place)!,
    );
    assert(stored.ok && stored.value !== null);
    const gone = commands.delete.handle(
      tx,
      user,
      { agent: OPERATOR as never },
      { hash: stored.value.hash },
    );
    assert(gone.ok);
    assert(store.read(manager).ok);
    const again = commands.delete.handle(
      tx,
      user,
      { agent: OPERATOR as never },
      { hash: stored.value.hash },
    );
    assert(!again.ok);
    assertEquals(again.error.code, "not_found");
    const survivor = store.read(manager);
    assert(survivor.ok && survivor.value !== null);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("옛 hash로 Operator를 고치면 충돌이고 파일은 그대로다", async () => {
  const root = await Deno.makeTempDir();
  try {
    const files = createNodeAgentFiles();
    const commands = createAgentCommands({
      files,
      lookups: () => lookups,
      dataRoot: root,
    });
    const place = { kind: "project", id: PROJECT } as const;
    const made = commands.create.handle(
      tx,
      user,
      {
        id: OPERATOR as never,
        place,
        definition: { name: "reviewer", body: "v1" },
      },
      {} as never,
    );
    assert(made.ok);
    const stale = commands.change.handle(
      tx,
      user,
      {
        agent: OPERATOR as never,
        definition: { name: "reviewer", body: "v2" },
      },
      { hash: "0".repeat(64) },
    );
    assert(!stale.ok);
    assertEquals(stale.error.code, "conflict");
    const store = createAgentStore(files, root);
    const kept = store.read(
      slotOf(root, { role: "operator", agent: OPERATOR as never }, place)!,
    );
    assert(kept.ok && kept.value?.hash === made.value.hash);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
