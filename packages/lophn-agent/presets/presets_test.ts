import { assert, assertEquals } from "@std/assert";
import { createHash } from "node:crypto";
import { canonicalize } from "../../base/mod.ts";
import type { Result } from "../../base/mod.ts";
import type {
  AuthenticatedContext,
  SqlRow,
} from "../../contracts/platform/mod.ts";
import {
  createLedgerHarness,
  type LedgerHarness,
} from "../../../apps/core/testing/ledger.ts";

const NOW = Date.UTC(2026, 0, 1);

// command는 route name을 scope operation으로 검사한다(platform/ledger executor).
const OPERATIONS = [
  "RegisterProvider",
  "RegisterDefaultPreset",
  "CreatePreset",
  "RevisePreset",
  "ReadPreset",
  "ListPresets",
  "ReadPresetInstructionAttachments",
  "CommandResult",
];

const userCred: AuthenticatedContext = {
  actor: "user",
  principal: "user-1",
  credential_ref: "test:user-1:user",
  scope: { operations: OPERATIONS, targets: {} },
  conditions: {},
};

const machineCred: AuthenticatedContext = {
  actor: "machine",
  principal: "machine-1",
  credential_ref: "test:machine-1:machine",
  scope: { operations: OPERATIONS, targets: {} },
  conditions: {},
};

const DOC = "doc_01arz3ndektsv4rrffq69g5fav";

export function definitionJson(overrides: Record<string, unknown> = {}) {
  return {
    kind: "lophn",
    name: "Review",
    origin: "user",
    prompt: "a".repeat(64),
    capability: {
      bundles: [{ name: "read-only", revision: 1 }],
      tools: [],
    },
    context: [{ kind: "document", target: DOC, section: null }],
    mcp: { servers: ["notes"], tools: [] },
    safe_tools: [],
    skills: [],
    model: {
      provider: "pvd_01arz3ndektsv4rrffq69g5fav",
      credentials: ["key-main"],
      model_name: "claude-haiku-4-5",
      reasoning_level: "medium",
      options: {},
    },
    organizing_model: null,
    instructions: [{ document: DOC, order: 0 }],
    ...overrides,
  };
}

function definitionHash(definition: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalize(definition), "utf8").digest(
    "hex",
  );
}

let idempotency = 0;
function envelope(command: string, input: unknown, compare: unknown = {}) {
  idempotency++;
  return {
    command,
    input,
    compare,
    idempotency_key: `k-${idempotency}`,
    prepared: [],
  };
}

async function open(
  credentials: readonly AuthenticatedContext[] = [userCred, machineCred],
): Promise<LedgerHarness> {
  const opened = await createLedgerHarness({
    registrationModules: [
      new URL("./registration_test.ts", import.meta.url),
    ],
    credentials,
    nowMs: NOW,
  });
  assert(opened.ok, opened.ok ? undefined : JSON.stringify(opened.error));
  return opened.value;
}

function value<T>(result: Result<T>): T {
  assert(result.ok, result.ok ? undefined : JSON.stringify(result.error));
  return result.value;
}

function rows(result: Result<SqlRow[]>): SqlRow[] {
  return value(result);
}

function code(result: Result<unknown>, expected: string) {
  if (result.ok) {
    assert(false, "expected failure, got " + JSON.stringify(result.value));
  } else {
    assertEquals(result.error.code, expected);
  }
}

async function create(
  h: LedgerHarness,
  name = "Review",
  overrides: Record<string, unknown> = {},
) {
  const definition = definitionJson({ name, ...overrides });
  return await h.command(
    userCred,
    envelope("CreatePreset", {
      id: "pst_01arz3ndektsv4rrffq69g5fav",
      definition,
      copied_from: null,
    }),
  );
}

// 네 역할 기본 preset의 정의다(presets#R9). prompt는 hash 값이고 각 역할 상한
// 안에서만 tool을 고른다. 같은 id를 다른 kind에 보내면 conflict이다.
function defaultJson(kind: string): Record<string, unknown> {
  return definitionJson({
    kind,
    name: kind === "lophn"
      ? "lophn"
      : kind === "app_engineer"
      ? "App Engineer"
      : kind === "context_engineer"
      ? "Context Engineer"
      : kind === "operator"
      ? "Operator"
      : "Review",
    origin: "product",
    // 기본 preset은 공통 읽기 묶음 펼침만 노출한다(R4).
    capability: { bundles: [], tools: [] },
    context: [],
    mcp: { servers: [], tools: [] },
    safe_tools: [],
    skills: [],
    instructions: [],
  });
}

Deno.test("lophn-agent/presets#R1: preset stores no assignment scope, schedule, session or run state", async () => {
  const h = await open();
  try {
    const created = value(await create(h));
    const preset = ((created as Record<string, unknown>)["result"] as Record<
      string,
      unknown
    >)["preset"] as Record<
      string,
      unknown
    >;
    // 정의 화면 값은 수요 모양 그대로다. assignment 상태 필드는 없다.
    assertEquals(preset["definition"], definitionJson());
    // 표에도 세션·run 상태 열이 없다.
    const columns = rows(
      await h.inspect("pragma table_info(presets)", []),
    ).map((row) => String(row["name"]));
    assertEquals(
      columns.some((column) =>
        ["scope", "schedule", "interval", "session", "run_state"].includes(
          column,
        )
      ),
      false,
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/presets#R2: blank name and prompt are rejected", async () => {
  const h = await open();
  try {
    code(await create(h, "   "), "invalid_input");
    // prompt는 hash가 아닌 값으로 64 hex다. 모양 검사가 거른다.
    code(
      await h.command(
        userCred,
        envelope("CreatePreset", {
          id: "pst_01arz3ndektsv4rrffq69g5fav",
          definition: definitionJson({ prompt: "short" }),
          copied_from: null,
        }),
      ),
      "invalid_input",
    );
    // 하나도 남지 않는다(R11).
    assertEquals(
      rows(await h.inspect("select count(*) as n from presets", []))[0]!["n"],
      0n,
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/presets#R3: name duplicates fold case and blank, distinct from product name", async () => {
  const h = await open();
  try {
    value(await create(h, "Review"));
    // 대소문자·공백을 접으면 같은 이름이다(R3).
    code(await create(h, "  review "), "conflict");
    // product 표시 이름과 같은 user 이름은 별도 이름이 필요 없다(R3 확인).
    value(
      await h.command(
        machineCred,
        envelope("RegisterDefaultPreset", {
          id: "pst_01arz3ndektsv4rrffq69g5fbv",
          definition: definitionJson({ name: "Review", origin: "product" }),
          definition_hash: definitionHash(
            definitionJson({ name: "Review", origin: "product" }),
          ),
        }),
      ),
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/presets#R5: context selection reads documents, distinct from assignment scope", async () => {
  const h = await open();
  try {
    const created = value(
      await create(h, undefined, {
        context: [{
          kind: "project",
          target: "prj_01arz3ndektsv4rrffq69g5fav",
          section: null,
        }],
      }),
    );
    const preset = ((created as Record<string, unknown>)["result"] as Record<
      string,
      unknown
    >)["preset"] as Record<
      string,
      unknown
    >;
    const definition = preset["definition"] as Record<string, unknown>;
    assertEquals(definition["context"], [{
      kind: "project",
      target: "prj_01arz3ndektsv4rrffq69g5fav",
      section: null,
    }]);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/presets#R6: no credential values or price tables in the record", async () => {
  const h = await open();
  try {
    const created = value(await create(h));
    // record에 credential 원문·가격표는 없다(R6). key 이름 목록만 선택으로 남는다.
    const serialized = JSON.stringify(created);
    assertEquals(serialized.includes("seal_"), false);
    assertEquals(serialized.includes("price_basis"), false);
    // preset read로 열어도 sealed 원문 참조·가격표는 없다(R6).
    const read = value(
      await h.read({ resource: "presets", method: "read" }, userCred, {
        preset: "pst_01arz3ndektsv4rrffq69g5fav",
      }),
    );
    assertEquals(JSON.stringify(read).includes("seal_"), false);
    assertEquals(JSON.stringify(read).includes("price_basis"), false);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/presets#R7: bundles are expanded to stored operations and stay fixed", async () => {
  const h = await open();
  try {
    const created = value(await create(h));
    const preset = ((created as Record<string, unknown>)["result"] as Record<
      string,
      unknown
    >)["preset"] as Record<
      string,
      unknown
    >;
    const definition = preset["definition"] as Record<
      string,
      unknown
    >;
    // capability 화면 값은 선택 자체다. 펼침은 ledger 화면에 새지 않는다(R7).
    assertEquals(definition["capability"], {
      bundles: [{ name: "read-only", revision: 1 }],
      tools: [],
    });
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/presets#R10: copy carries only the definition", async () => {
  const h = await open();
  try {
    value(await create(h, "Review"));
    const copied = value(
      await h.command(
        userCred,
        envelope("CreatePreset", {
          id: "pst_01arz3ndektsv4rrffq69g5fbv",
          definition: definitionJson({ name: "Copy" }),
          copied_from: {
            preset: "pst_01arz3ndektsv4rrffq69g5fav",
            revision: 1,
          },
        }),
      ),
    );
    const preset = ((copied as Record<string, unknown>)["result"] as Record<
      string,
      unknown
    >)["preset"] as Record<
      string,
      unknown
    >;
    // 구성은 그대로, 세션·이력·권한은 없다(R10).
    assertEquals(preset["definition"], definitionJson({ name: "Copy" }));
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/presets#R11: validation failure rejects the whole save with item details", async () => {
  const h = await open();
  try {
    // 정상 prompt와 역할 상한 밖 tool을 함께 낸다(R11 확인).
    const rejected = await h.command(
      userCred,
      envelope("CreatePreset", {
        id: "pst_01arz3ndektsv4rrffq69g5fav",
        definition: definitionJson({
          capability: {
            bundles: [],
            tools: [{ tool: "doc.write", app_command: null }],
          },
        }),
        copied_from: null,
      }),
    );
    code(rejected, "forbidden");
    const error = (rejected as { error?: { details?: { item?: string } } })
      .error;
    assertEquals(error?.details?.item, "capability.tool:doc.write");
    // 어느 일부도 남지 않는다(R11).
    assertEquals(
      rows(await h.inspect("select count(*) as n from presets", []))[0]!["n"],
      0n,
    );
    assertEquals(
      rows(
        await h.inspect(
          "select count(*) as n from preset_revisions",
          [],
        ),
      )[0]!["n"],
      0n,
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/presets#R11: unknown bundle, MCP server and safe tool are rejected", async () => {
  const h = await open();
  try {
    code(
      await create(h, undefined, {
        capability: { bundles: [{ name: "missing", revision: 1 }], tools: [] },
      }),
      "not_found",
    );
    code(
      await create(h, undefined, { mcp: { servers: ["ghost"], tools: [] } }),
      "not_found",
    );
    // 되돌림을 모르는 write tool은 안전 표시할 수 없다(R16 같은 검사).
    code(
      await create(h, undefined, {
        mcp: {
          servers: ["notes"],
          tools: [{ server_name: "notes", original_tool: "notes.purge" }],
        },
        safe_tools: [{ server_name: "notes", original_tool: "notes.purge" }],
      }),
      "forbidden",
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/presets#R12: revision failure keeps the previous revision and past revisions stay", async () => {
  const h = await open();
  try {
    value(await create(h, "Review"));
    // CAS가 어긋나면 거절이다(R12).
    const clashed = await h.command(
      userCred,
      envelope(
        "RevisePreset",
        {
          preset: "pst_01arz3ndektsv4rrffq69g5fav",
          definition: definitionJson({ name: "Renamed" }),
          reason: "rename",
        },
        { revision: 7 },
      ),
    );
    code(clashed, "conflict");
    // 존재하지 않는 판의 개인화는 not_found다. compare는 schema가 있다.
    code(
      await h.command(
        userCred,
        envelope(
          "RevisePreset",
          {
            preset: "pst_01arz3ndektsv4rrffq69g5fbv",
            definition: definitionJson({ name: "Renamed" }),
            reason: "rename",
          },
          { revision: 1 },
        ),
      ),
      "not_found",
    );
    // 이전 판이 그대로다(R12).
    const read = value(
      await h.read({ resource: "presets", method: "read" }, userCred, {
        preset: "pst_01arz3ndektsv4rrffq69g5fav",
      }),
    );
    const preset = (read as Record<string, unknown>)["preset"] as Record<
      string,
      unknown
    >;
    assertEquals(preset["revision"], 1);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/presets#R12: revise writes a new revision and old revisions stay readable", async () => {
  const h = await open();
  try {
    value(await create(h, "Review"));
    value(
      await h.command(
        userCred,
        envelope(
          "RevisePreset",
          {
            preset: "pst_01arz3ndektsv4rrffq69g5fav",
            definition: definitionJson({ name: "Renamed" }),
            reason: "rename",
          },
          { revision: 1 },
        ),
      ),
    );
    // 현재 판은 새 revision이다(R12).
    const now = value(
      await h.read({ resource: "presets", method: "read" }, userCred, {
        preset: "pst_01arz3ndektsv4rrffq69g5fav",
      }),
    );
    assertEquals(
      ((now as Record<string, unknown>)["preset"] as Record<string, unknown>)[
        "revision"
      ],
      2,
    );
    // 과거 판은 그대로 읽힌다(R12).
    const past = value(
      await h.read({ resource: "presets", method: "read" }, userCred, {
        preset: "pst_01arz3ndektsv4rrffq69g5fav",
        revision: 1,
      }),
    );
    assertEquals(
      ((past as Record<string, unknown>)["preset"] as Record<string, unknown>)[
        "definition"
      ] as Record<string, unknown>,
      definitionJson(),
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/presets#R13: revision decision keeps person, reason and before-after", async () => {
  const h = await open();
  try {
    value(await create(h, "Review"));
    value(
      await h.command(
        userCred,
        envelope(
          "RevisePreset",
          {
            preset: "pst_01arz3ndektsv4rrffq69g5fav",
            definition: definitionJson({ name: "Renamed" }),
            reason: "rename after review",
          },
          { revision: 1 },
        ),
      ),
    );
    const stored = rows(
      await h.inspect(
        "select decided_by, proposed_by, reason, before_revision, before_hash, definition, definition_hash from preset_revisions where preset_id = ? and revision = 2",
        ["pst_01arz3ndektsv4rrffq69g5fav"],
      ),
    );
    assertEquals(stored.length, 1);
    assertEquals(stored[0]!["decided_by"], "user-1");
    assertEquals(stored[0]!["proposed_by"], "user-1");
    assertEquals(stored[0]!["reason"], "rename after review");
    // inspect는 bigint로 읽는다(apps/core/testing/ledger-worker).
    assertEquals(stored[0]!["before_revision"], 1n);
    // 전후 전체 내용이 남는다(R13).
    assertEquals(String(stored[0]!["before_hash"]).length, 64);
    assertEquals(String(stored[0]!["definition_hash"]).length, 64);
    assert(
      String(stored[0]!["definition"]).includes("Renamed"),
      "new definition content is stored",
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/presets#R14: revising a preset does not move assignments", async () => {
  const h = await open();
  try {
    value(await create(h, "Review"));
    value(
      await h.command(
        userCred,
        envelope(
          "RevisePreset",
          {
            preset: "pst_01arz3ndektsv4rrffq69g5fav",
            definition: definitionJson({ name: "Renamed" }),
            reason: "rename",
          },
          { revision: 1 },
        ),
      ),
    );
    // assignment 표 자체가 이 리프에 없다. 새 판은 preset에만 남는다(R14).
    const tables = rows(
      await h.inspect(
        "select name from sqlite_master where type = 'table' and name like '%assignment%'",
        [],
      ),
    );
    assertEquals(tables.length, 0);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/presets#R16: safe list marks one MCP tool pair and cannot widen product limits", async () => {
  const h = await open();
  try {
    // 되돌림을 아는 write tool은 안전 표시할 수 있다(R16).
    const created = value(
      await create(h, undefined, {
        mcp: {
          servers: ["notes"],
          tools: [{ server_name: "notes", original_tool: "notes.write" }],
        },
        safe_tools: [{ server_name: "notes", original_tool: "notes.write" }],
      }),
    );
    const preset = ((created as Record<string, unknown>)["result"] as Record<
      string,
      unknown
    >)["preset"] as Record<
      string,
      unknown
    >;
    const definition = preset["definition"] as Record<string, unknown>;
    assertEquals(definition["safe_tools"], [{
      server_name: "notes",
      original_tool: "notes.write",
    }]);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/presets#R16: safe list rejects unclassified and non-reversible tools", async () => {
  const h = await open();
  try {
    // safe 표시는 mcp 선택의 쌍 하나에만 적용한다. 선택 밖 쌍은 표를 만들지
    // 않는다(contract shape).
    code(
      await create(h, undefined, {
        safe_tools: [{ server_name: "notes", original_tool: "notes.read" }],
      }),
      "invalid_input",
    );
    code(
      await create(h, undefined, {
        mcp: {
          servers: ["notes"],
          tools: [{ server_name: "notes", original_tool: "notes.purge" }],
        },
        safe_tools: [{ server_name: "notes", original_tool: "notes.purge" }],
      }),
      "forbidden",
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/presets#R12: register-default replays the existing result for the same id", async () => {
  const h = await open();
  try {
    const definition = definitionJson({ name: "Review", origin: "product" });
    const first = value(
      await h.command(
        machineCred,
        envelope("RegisterDefaultPreset", {
          id: "pst_01arz3ndektsv4rrffq69g5fav",
          definition,
          definition_hash: definitionHash(definition),
        }),
      ),
    );
    const again = value(
      await h.command(
        machineCred,
        envelope("RegisterDefaultPreset", {
          id: "pst_01arz3ndektsv4rrffq69g5fav",
          definition,
          definition_hash: definitionHash(definition),
        }),
      ),
    );
    // 재전송은 같은 결과다. 정의·hash·revision은 그대로다(domain model command 표).
    assertEquals(
      (again as Record<string, unknown>)["result"],
      (first as Record<string, unknown>)["result"],
    );
    assertEquals(
      ((again as Record<string, unknown>)["result"] as Record<string, unknown>)[
        "preset"
      ] as Record<string, unknown>,
      ((first as Record<string, unknown>)["result"] as Record<string, unknown>)[
        "preset"
      ] as Record<string, unknown>,
    );
    assertEquals(
      rows(await h.inspect("select count(*) as n from presets", []))[0]!["n"],
      1n,
    );
    // 다른 kind의 재전송은 conflict다.
    code(
      await h.command(
        machineCred,
        envelope("RegisterDefaultPreset", {
          id: "pst_01arz3ndektsv4rrffq69g5fav",
          definition: definitionJson({
            name: "Review",
            origin: "product",
            kind: "operator",
          }),
          definition_hash: definitionHash(definitionJson({
            name: "Review",
            origin: "product",
            kind: "operator",
          })),
        }),
      ),
      "conflict",
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/presets#R9: four role defaults register once as machine and do not overwrite person presets", async () => {
  const h = await open();
  try {
    // 사람 판이 먼저 있다. 기본 등록은 그 판을 덮지 않는다(R9).
    value(await create(h, "Review"));
    const personCount = rows(
      await h.inspect(
        "select count(*) as n from presets where origin = 'user'",
        [],
      ),
    )[0]!["n"];
    assertEquals(personCount, 1n);
    // 같은 id의 user preset이 이미 있으므로 기본 등록은 conflict다(R9).
    code(
      await h.command(
        machineCred,
        envelope("RegisterDefaultPreset", {
          id: "pst_01arz3ndektsv4rrffq69g5fav",
          definition: defaultJson("lophn"),
          definition_hash: definitionHash(defaultJson("lophn")),
        }),
      ),
      "conflict",
    );
    // 네 역할 기본 preset을 각자 다른 id로 machine으로 한 번 등록한다(R9).
    const defaultIds: Record<string, string> = {
      lophn: "pst_01arz3ndektsv4rrffq69g5fbv",
      app_engineer: "pst_01arz3ndektsv4rrffq69g5fcv",
      context_engineer: "pst_01arz3ndektsv4rrffq69g5fdv",
      operator: "pst_01arz3ndektsv4rrffq69g5fev",
    };
    for (const kind of Object.keys(defaultIds)) {
      const definition = defaultJson(kind);
      value(
        await h.command(
          machineCred,
          envelope("RegisterDefaultPreset", {
            id: defaultIds[kind],
            definition,
            definition_hash: definitionHash(definition),
          }),
        ),
      );
      // user actor의 등록은 forbidden이다. machine 전용이다(T8).
      code(
        await h.command(
          userCred,
          envelope("RegisterDefaultPreset", {
            id: defaultIds[kind],
            definition,
            definition_hash: definitionHash(definition),
          }),
        ),
        "forbidden",
      );
    }
    // 네 역할 기본이 표에 남는다. 사람 판은 그대로다(R9).
    assertEquals(
      rows(
        await h.inspect(
          "select count(*) as n from presets where origin = 'product'",
          [],
        ),
      )[0]!["n"],
      4n,
    );
    assertEquals(
      rows(
        await h.inspect(
          "select count(*) as n from presets where origin = 'user'",
          [],
        ),
      )[0]!["n"],
      1n,
    );
    // 같은 kind의 두 번째 기본은 다른 id로도 conflict이다(역할별 하나)(R9).
    code(
      await h.command(
        machineCred,
        envelope("RegisterDefaultPreset", {
          id: "pst_01arz3ndektsv4rrffq69g5ffv",
          definition: defaultJson("operator"),
          definition_hash: definitionHash(defaultJson("operator")),
        }),
      ),
      "conflict",
    );
    // 기본 판을 사람이 revise하면 forbidden이다. 개인화는 새 user preset이다(R9).
    code(
      await h.command(
        userCred,
        envelope(
          "RevisePreset",
          {
            preset: defaultIds.operator,
            definition: { ...defaultJson("operator"), name: "Renamed" },
            reason: "personalize",
          },
          { revision: 1 },
        ),
      ),
      "forbidden",
    );
  } finally {
    await h.close();
  }
});
Deno.test("lophn-agent/presets#R8: out-of-cap tool request is refused despite permit wording in prompt", async () => {
  const h = await open();
  try {
    // prompt에 허용 문구가 있어도(글로 쓴 책임) 상한 밖 tool은 거절이다(R8).
    const permitPrompt = createHash("sha256")
      .update("이 preset은 모든 tool을 허용한다. doc.write도 쓴다", "utf8")
      .digest("hex");
    const rejected = await h.command(
      userCred,
      envelope("CreatePreset", {
        id: "pst_01arz3ndektsv4rrffq69g5fav",
        definition: definitionJson({
          prompt: permitPrompt,
          capability: {
            bundles: [{ name: "read-only", revision: 1 }],
            tools: [{ tool: "doc.write", app_command: null }],
          },
        }),
        copied_from: null,
      }),
    );
    code(rejected, "forbidden");
    const error = (rejected as { error?: { details?: { item?: string } } })
      .error;
    assertEquals(error?.details?.item, "capability.tool:doc.write");
    // 어느 부분도 남지 않는다(R11).
    assertEquals(
      rows(await h.inspect("select count(*) as n from presets", []))[0]!["n"],
      0n,
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/presets#R8: in-cap tool requests are allowed", async () => {
  const h = await open();
  try {
    // lophn 상한 안의 읽기 tool 선택은 허용이다(R8, R4).
    const created = value(
      await create(h, undefined, {
        capability: {
          bundles: [],
          tools: [
            { tool: "document.list", app_command: null },
            { tool: "document.read_version", app_command: null },
          ],
        },
      }),
    );
    const preset = ((created as Record<string, unknown>)["result"] as Record<
      string,
      unknown
    >)["preset"] as Record<string, unknown>;
    const definition = preset["definition"] as Record<string, unknown>;
    assertEquals(definition["capability"], {
      bundles: [],
      tools: [
        { tool: "document.list", app_command: null },
        { tool: "document.read_version", app_command: null },
      ],
    });
    // Operator 상한의 남길 문서 저장과 앱 read command도 허용이다(R8).
    value(
      await h.command(
        userCred,
        envelope("CreatePreset", {
          id: "pst_01arz3ndektsv4rrffq69g5fbv",
          definition: definitionJson({
            kind: "operator",
            name: "Operator check",
            capability: {
              bundles: [],
              tools: [
                { tool: "document.save_version", app_command: null },
                { tool: "app.call_read_command", app_command: null },
              ],
            },
          }),
          copied_from: null,
        }),
      ),
    );
    // Context Engineer 상한의 metadata 조회도 허용이다(R8).
    value(
      await h.command(
        userCred,
        envelope("CreatePreset", {
          id: "pst_01arz3ndektsv4rrffq69g5fcv",
          definition: definitionJson({
            kind: "context_engineer",
            name: "CE metadata",
            capability: {
              bundles: [],
              tools: [
                { tool: "app.commands", app_command: null },
              ],
            },
          }),
          copied_from: null,
        }),
      ),
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/presets#R4: default prompt stores the hash and the asset text stays outside the machine value", async () => {
  const h = await open();
  try {
    // 기본 preset을 등록한다(R4). prompt 원문은 asset 자리의 글이고 정의에는
    // hash만 남는다.
    const definition = defaultJson("lophn");
    value(
      await h.command(
        machineCred,
        envelope("RegisterDefaultPreset", {
          id: "pst_01arz3ndektsv4rrffq69g5fbv",
          definition,
          definition_hash: definitionHash(definition),
        }),
      ),
    );
    const read = value(
      await h.read({ resource: "presets", method: "read" }, userCred, {
        preset: "pst_01arz3ndektsv4rrffq69g5fbv",
      }),
    );
    const preset = (read as Record<string, unknown>)["preset"] as Record<
      string,
      unknown
    >;
    const stored = preset["definition"] as Record<string, unknown>;
    // prompt는 hash 값이다(64 hex). 기계 값 복제는 없다(R4).
    assertEquals(String(stored["prompt"]).length, 64);
    assertEquals(JSON.stringify(preset).includes("## 맡는 일"), false);
    // Operator 기본 등록도 machine으로 된다(R9).
    const operatorDefinition = defaultJson("operator");
    value(
      await h.command(
        machineCred,
        envelope("RegisterDefaultPreset", {
          id: "pst_01arz3ndektsv4rrffq69g5fev",
          definition: operatorDefinition,
          definition_hash: definitionHash(operatorDefinition),
        }),
      ),
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/presets#R12: revise keeps the preset kind", async () => {
  const h = await open();
  try {
    value(await create(h, "Review"));
    // 다른 종류는 새 preset이다. 판은 그대로 남는다.
    code(
      await h.command(
        userCred,
        envelope(
          "RevisePreset",
          {
            preset: "pst_01arz3ndektsv4rrffq69g5fav",
            definition: definitionJson({ kind: "operator" }),
            reason: "change kind",
          },
          { revision: 1 },
        ),
      ),
      "invalid_input",
    );
  } finally {
    await h.close();
  }
});
