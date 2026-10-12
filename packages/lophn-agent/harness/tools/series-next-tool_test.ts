// deno-lint-ignore-file no-explicit-any
// lophn-agent/harness/tools#R24: series의 다음 이름을 읽는 tool은 context와 series kind의 type을 받아 다음
// 문서 이름을 돌려주기만 하고 아무것도 만들지 않는다. 구현은 ctx-I58e가 한다. core는 `ContractCall` fake이고
// 네트워크·model은 부르지 않는다. 이름 계산 자체는 documents/series가 맡으므로 fake는 정해진 답을 준다.
import { assert, assertEquals } from "@std/assert";
import { err, ok, type Result } from "../../../base/mod.ts";
import { ROLE_CAPS } from "../../agents/mod.ts";
import {
  BUILTIN_TOOLS,
  executeTool,
  listTools,
  type RunCredential,
  runOperations,
  type ToolDefinition,
} from "./mod.ts";
import {
  createSeriesNextToolHandlers,
  SERIES_NEXT_CONTRACT,
  SERIES_NEXT_TOOL,
  SERIES_NEXT_TOOLS,
  type SeriesNextRead,
} from "./series-next-tool.ts";

const ALPHA = "0123456789abcdefghjkmnpqrstvwxyz";
function id(prefix: string, n: number): string {
  return `${prefix}_01arz3ndektsv4rrffq69g5f${ALPHA[n >> 5]}${ALPHA[n & 31]}`;
}

const RUN = id("run", 1);
const CALL = id("tcl", 1);
const CTX = id("ctx", 1);
const OTHER_CTX = id("ctx", 2);

type Seen = { contract: string; input: Record<string, unknown>; run: string };

// context의 project 파일과 판 상태. 시험이 호출 전후를 비교한다. `daily` type은 series kind이고
// `Note`는 docs kind라 다음 이름이 없다.
function world(
  files: string[] = [
    "daily/note-001.md",
    "daily/note-002.md",
    "daily/note-003.md",
  ],
) {
  const state = {
    files,
    applied: "a".repeat(64),
    contexts: [CTX],
    series: new Map<string, string>([
      ["Daily", "daily/note-{n:3}.md"],
      ["Weekly", "weekly/week-*-{n:3}.md"],
    ]),
    // 다음 이름이 이미 있는 이름으로 계산되는 상황을 흉내 낸다.
    taken: false,
  };
  const seen: Seen[] = [];
  const nextOf = (type: string): SeriesNextRead["next"] => {
    if (type === "Daily") {
      const last = state.files.filter((f) => f.startsWith("daily/note-")).sort()
        .at(-1);
      if (last === undefined) {
        return {
          key: "",
          path: null,
          from: null,
          complete: false,
          taken: false,
        };
      }
      const n = Number(last.slice("daily/note-".length, -3)) + 1;
      const key = String(n).padStart(3, "0");
      return {
        key,
        path: `daily/note-${key}.md`,
        from: last,
        complete: true,
        taken: state.taken || state.files.includes(`daily/note-${key}.md`),
      };
    }
    if (type === "Weekly") {
      return {
        key: "004",
        path: "weekly/week-*-004.md",
        from: "weekly/week-a-003.md",
        complete: false,
        taken: false,
      };
    }
    return { key: "", path: null, from: null, complete: false, taken: false };
  };
  const ports = {
    call(
      contract: string,
      input: unknown,
      run: string,
    ): Promise<Result<unknown>> {
      const body = input as { context: string; type: string };
      seen.push({ contract, input: body, run });
      if (contract !== SERIES_NEXT_CONTRACT) {
        return Promise.resolve(err({ code: "not_found", message: "no route" }));
      }
      if (!state.contexts.includes(body.context)) {
        return Promise.resolve(
          err({ code: "not_found", message: `no context ${body.context}` }),
        );
      }
      const pattern = state.series.get(body.type);
      if (pattern === undefined) {
        return Promise.resolve(err({
          code: "invalid_input",
          message: `${body.type} is not a series type`,
        }));
      }
      const read: SeriesNextRead = {
        context: body.context,
        type: body.type,
        pattern,
        next: nextOf(body.type),
      };
      return Promise.resolve(
        ok({ as_of_seq: "9", complete: true, next_cursor: null, ...read }),
      );
    },
  };
  return {
    state,
    seen,
    ports,
    snapshot: () => JSON.stringify({ ...state, series: [...state.series] }),
  };
}

function credential(listed: readonly ToolDefinition[]): RunCredential {
  return {
    run: RUN,
    targets: new Set(),
    operations: new Set(runOperations(listed)),
    call: CALL,
  };
}

function reader(core = world(), selected: readonly string[] = [CTX]) {
  const listed = SERIES_NEXT_TOOLS;
  const handlers = createSeriesNextToolHandlers(core.ports, selected);
  return {
    core,
    handlers,
    run: (input: unknown) =>
      executeTool(
        { listed, handlers, credential: credential(listed) },
        SERIES_NEXT_TOOL,
        input,
      ),
  };
}

function listedFor(role: string): readonly ToolDefinition[] {
  const cap = ROLE_CAPS.get(role);
  assert(cap !== undefined, role);
  return listTools(
    { builtin: BUILTIN_TOOLS, app: [], external: [] },
    { presetTools: cap.tools, roleTools: cap.tools },
  );
}

Deno.test("lophn-agent/harness/tools#R24 [ctx-I58e]: 다음 이름 tool은 context와 series type을 받는 읽기 tool 하나이고 쓰기 handler가 없다", () => {
  assertEquals(SERIES_NEXT_TOOLS.map((d) => d.name), [SERIES_NEXT_TOOL]);
  const definition = SERIES_NEXT_TOOLS[0]!;
  assertEquals(definition.effect, "read");
  assertEquals(definition.confirm, false);
  assertEquals(definition.idempotent, true);
  assertEquals(definition.contract, SERIES_NEXT_CONTRACT);
  assertEquals(definition.origin, "builtin");
  assert(definition.errors.includes("not_found"));
  assert(definition.errors.includes("invalid_input"));
  assertEquals(
    {
      type: definition.inputSchema?.["type"],
      required: [
        ...((definition.inputSchema?.["required"] as string[] | undefined) ??
          []),
      ].sort(),
      additional: definition.inputSchema?.["additionalProperties"],
      properties: Object.keys(
        (definition.inputSchema?.["properties"] as object | undefined) ?? {},
      ).sort(),
    },
    {
      type: "object",
      required: ["context", "type"],
      additional: false,
      properties: ["context", "type"],
    },
  );
  // handler는 이 tool 하나뿐이다. 문서를 만들거나 series를 등록하는 handler가 없다.
  assertEquals([...createSeriesNextToolHandlers(world().ports, [CTX]).keys()], [
    SERIES_NEXT_TOOL,
  ]);
});

Deno.test("lophn-agent/harness/tools#R24 [ctx-I58e]: Operator와 lophn의 목록에 읽기 tool로 들어 있다", () => {
  assert(BUILTIN_TOOLS.some((d) => d.name === SERIES_NEXT_TOOL));
  for (const role of ["operator", "lophn"]) {
    const found = listedFor(role).find((d) => d.name === SERIES_NEXT_TOOL);
    assert(found !== undefined, `${role} lacks ${SERIES_NEXT_TOOL}`);
    assertEquals(found.effect, "read");
    assert(runOperations(listedFor(role)).includes(SERIES_NEXT_CONTRACT));
  }
});

Deno.test("lophn-agent/harness/tools#R24 [ctx-I58e]: 다음 이름을 돌려주고 호출 전후 문서와 context 상태가 그대로이며 같은 입력은 같은 이름이다", async () => {
  const box = reader();
  const before = box.core.snapshot();
  const first = await box.run({ context: CTX, type: "Daily" });
  assertEquals(first.outcome.kind, "success");
  assertEquals(first.effect, "read");
  assertEquals(first.executed, true);

  assertEquals(box.core.seen.length, 1);
  assertEquals(box.core.seen[0]!.contract, SERIES_NEXT_CONTRACT);
  assertEquals(box.core.seen[0]!.input, { context: CTX, type: "Daily" });
  assertEquals(box.core.seen[0]!.run, RUN);

  const content = first.result.content as Record<string, any>;
  assertEquals(content["pattern"], "daily/note-{n:3}.md");
  assertEquals(content["next"], {
    key: "004",
    path: "daily/note-004.md",
    from: "daily/note-003.md",
    complete: true,
    taken: false,
  });
  assertEquals(first.result.complete, true);
  // 아무것도 만들지 않았다.
  assertEquals(box.core.snapshot(), before);
  assertEquals(box.core.state.files.length, 3);

  const again = await box.run({ context: CTX, type: "Daily" });
  assertEquals(again.result.content, first.result.content);
  assertEquals(box.core.snapshot(), before);
  assertEquals(
    box.core.seen.every((call) => call.contract === SERIES_NEXT_CONTRACT),
    true,
  );
});

Deno.test("lophn-agent/harness/tools#R24 [ctx-I58e]: 파일을 쓴 뒤에야 다음 이름이 한 칸 넘어가고 읽기만으로는 멤버가 늘지 않는다", async () => {
  const box = reader();
  const one = await box.run({ context: CTX, type: "Daily" });
  const two = await box.run({ context: CTX, type: "Daily" });
  assertEquals(
    (two.result.content as Record<string, any>)["next"]["path"],
    (one.result.content as Record<string, any>)["next"]["path"],
  );
  // 이어 쓰기는 다른 tool(각 역할의 문서 저장 범위)이 한다. 여기서는 그 결과만 흉내 낸다.
  box.core.state.files.push("daily/note-004.md");
  const three = await box.run({ context: CTX, type: "Daily" });
  assertEquals(
    (three.result.content as Record<string, any>)["next"]["path"],
    "daily/note-005.md",
  );
});

Deno.test("lophn-agent/harness/tools#R24 [ctx-I58e]: 이미 있음 표시가 붙은 이름과 멤버가 없거나 `*`가 남은 이름은 실패 없이 그대로 보여 주고 덮어쓰지 말라고 알린다", async () => {
  // 이미 있는 이름
  const crowded = world();
  crowded.state.taken = true;
  const reply = await reader(crowded).run({ context: CTX, type: "Daily" });
  assertEquals(reply.outcome.kind, "success");
  assertEquals(
    (reply.result.content as Record<string, any>)["next"]["taken"],
    true,
  );
  assert(reply.result.pending.length > 0);

  // 파일 이름 칸에 `*`가 남아 사람이나 모델이 마저 정해야 하는 이름
  const wildcard = await reader().run({ context: CTX, type: "Weekly" });
  assertEquals(wildcard.outcome.kind, "success");
  const next = (wildcard.result.content as Record<string, any>)["next"];
  assertEquals(next["path"], "weekly/week-*-004.md");
  assertEquals(next["complete"], false);

  // 멤버가 없어 계산할 수 없다.
  const empty = await reader(world([])).run({ context: CTX, type: "Daily" });
  assertEquals(empty.outcome.kind, "success");
  assertEquals((empty.result.content as Record<string, any>)["next"], {
    key: "",
    path: null,
    from: null,
    complete: false,
    taken: false,
  });
});

Deno.test("lophn-agent/harness/tools#R24 [ctx-I58e]: series kind가 아닌 type과 닿지 않는 context는 구별된 실패이고 존재를 드러내지 않는다", async () => {
  const box = reader();
  const notSeries = await box.run({ context: CTX, type: "Note" });
  assertEquals(notSeries.outcome, { kind: "failure", code: "invalid_input" });

  // core가 모르는 context(선택에는 있다)와 선택 밖 context는 같은 not_found다.
  const unknown = reader(world(), [CTX, OTHER_CTX]);
  const missing = await unknown.run({ context: OTHER_CTX, type: "Daily" });
  assertEquals(missing.outcome, { kind: "failure", code: "not_found" });
  assertEquals(JSON.stringify(missing.result).includes(OTHER_CTX), false);
  assertEquals(unknown.core.seen.length, 1);
  assertEquals(box.core.state.files.length, 3);
});

Deno.test("lophn-agent/harness/tools#R24 [ctx-I58e]: 입력은 context id와 type 이름 둘뿐이고 어긋나면 core를 부르기 전에 거절한다", async () => {
  const box = reader();
  for (
    const input of [
      {},
      { context: CTX },
      { type: "Daily" },
      { context: "ctx_nope", type: "Daily" },
      { context: CTX, type: "daily" }, // type 이름은 대문자로 시작한다
      { context: CTX, type: 3 },
      { context: CTX, type: "Daily", pattern: "x/{n}.md" }, // 모델이 pattern을 넘겨 series를 만들 수 없다
      { context: CTX, type: "Daily", create: true },
    ]
  ) {
    const outcome = await box.run(input);
    assertEquals(
      outcome.outcome,
      { kind: "failure", code: "invalid_input" },
      JSON.stringify(input),
    );
    assertEquals(outcome.executed, false);
  }
  assertEquals(box.core.seen, []);
});

Deno.test("lophn-agent/harness/tools#R24 [ctx-I57]: preset 선택 밖 context와 선택이 빈 run은 core를 부르기 전에 not_found이고 존재를 드러내지 않는다", async () => {
  const outside = reader();
  const refused = await outside.run({ context: OTHER_CTX, type: "Daily" });
  assertEquals(refused.outcome, { kind: "failure", code: "not_found" });
  assertEquals(JSON.stringify(refused.result).includes(OTHER_CTX), false);
  assertEquals(outside.core.seen, []);

  const none = reader(world(), []);
  const empty = await none.run({ context: CTX, type: "Daily" });
  assertEquals(empty.outcome, { kind: "failure", code: "not_found" });
  assertEquals(none.core.seen, []);

  // 선택 안의 context는 core까지 간다.
  const inside = await outside.run({ context: CTX, type: "Daily" });
  assertEquals(inside.outcome.kind, "success");
  assertEquals(outside.core.seen.length, 1);
});
