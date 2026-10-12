// release 비교(apps/releases#R9, R10, R11). 고정 blueprint 둘을 정적으로 비교한 결과를 본다.
import { assert, assertEquals } from "@std/assert";
import { canonicalInputHash } from "../blueprint/mod.ts";
import type { InputSchema } from "../blueprint/mod.ts";
import { compareReleases } from "./compare.ts";
import { canonicalInputHashSync } from "./facts.ts";
import { blueprint, command, sha256 } from "./testing/mod.ts";

const REL = "rel_01h455vb4pex5v6nkc6gd5fdw1";

function previous(over: Parameters<typeof blueprint>[0] = {}, schema = 0) {
  return { id: REL, blueprint: blueprint(over), data_schema: schema };
}

function compare(
  before: Parameters<typeof blueprint>[0],
  after: Parameters<typeof blueprint>[0],
  options: {
    schema?: [number, number];
    changes?: {
      from: number;
      to: number;
      script_hash: string;
      description: string;
    }[];
  } = {},
) {
  return compareReleases({
    previous: previous(before, options.schema?.[0] ?? 0),
    blueprint: blueprint(after),
    data_schema: options.schema?.[1] ?? 0,
    data_changes: options.changes ?? [],
  });
}

const objectInput = (required: string[]): InputSchema => ({
  type: "object",
  properties: Object.fromEntries(
    ["title", "due"].map((name) => [name, {
      type: "string",
      description: `${name} of the item`,
    }]),
  ),
  required,
  additionalProperties: false,
});

Deno.test("apps/releases#R9: 새 필수 입력·external 효과·permission 추가·파괴 migration이 각각 비교에 보인다", () => {
  const result = compare(
    {
      commands: [
        command("add", "write", { input: objectInput(["title"]) }),
        command("sync", "write"),
      ],
    },
    {
      commands: [
        command("add", "write", { input: objectInput(["title", "due"]) }),
        command("sync", "external"),
        command("export"),
      ],
      permissions: [{
        kind: "net.fetch",
        scope: { host: "api.example.com", port: 443 },
        reason: "sync",
      }],
    },
    {
      schema: [1, 2],
      changes: [{
        from: 1,
        to: 2,
        script_hash: sha256("drop"),
        description: "drops the notes column; its text is lost",
      }],
    },
  );
  const add = result.command_changes.find((c) => c.command === "add");
  assertEquals(add?.kinds, ["input"]);
  assertEquals(add?.new_required_inputs, ["due"]);
  assertEquals(result.external_commands, ["sync"]);
  assertEquals(result.added_commands, ["export"]);
  assertEquals(result.added_permissions, ["net.fetch:api.example.com:443"]);
  assertEquals(result.data_schema, { from: 1, to: 2 });
  assertEquals(result.data_changes.length, 1);
  assert(result.data_changes[0].description.includes("lost"));
  assertEquals(result.review_required, true);
});

Deno.test("apps/releases#R10: schema가 같아도 효과가 바뀌면 호환이라 하지 않고 설명만 바뀐 경우를 구별한다", () => {
  // 입력 schema는 그대로이고 효과만 read → write.
  const effect = compare(
    { commands: [command("list", "read")] },
    { commands: [command("list", "write")] },
  );
  assertEquals(effect.changed_commands, ["list"]);
  assertEquals(effect.command_changes[0].kinds, ["effect"]);
  assertEquals(effect.command_changes[0].effect_from, "read");
  assertEquals(effect.command_changes[0].effect_to, "write");
  assertEquals(effect.description_only_commands, []);
  assertEquals(effect.review_required, true);
  // 확인 여부가 바뀐 것도 입력 schema와 무관한 동작 변경이다.
  const confirm = compare(
    { commands: [command("list", "write")] },
    { commands: [command("list", "write", { confirm: true })] },
  );
  assertEquals(confirm.command_changes[0].kinds, ["confirm"]);
  // 이름·설명만 바뀐 command는 동작 변경이 아니다.
  const wording = compare(
    { commands: [command("list", "read")] },
    {
      commands: [command("list", "read", {
        label: "Show list",
        description: "shows the whole list",
      })],
    },
  );
  assertEquals(wording.changed_commands, []);
  assertEquals(wording.description_only_commands, ["list"]);
  assertEquals(wording.review_required, false);
  // 같은 blueprint는 바뀐 것이 없다. 처음 release(이전 없음)는 모두 검토 대상이다.
  const same = compare({}, {});
  assertEquals(same.review_required, false);
  const first = compareReleases({
    previous: null,
    blueprint: blueprint(),
    data_schema: 0,
    data_changes: [],
  });
  assertEquals(first.previous_release, null);
  assertEquals(first.added_commands, ["list"]);
  assertEquals(first.review_required, true);
});

Deno.test("apps/releases#R11: 데이터 계약 변경과 새 접근 요청은 서로 다른 근거로 나온다", () => {
  const dataOnly = compare({}, {}, {
    schema: [0, 1],
    changes: [{
      from: 0,
      to: 1,
      script_hash: sha256("add"),
      description: "adds a due column",
    }],
  });
  assertEquals(dataOnly.added_permissions, []);
  assertEquals(dataOnly.data_changes.map((c) => c.to), [1]);
  assertEquals(dataOnly.data_schema, { from: 0, to: 1 });
  const accessOnly = compare({}, {
    permissions: [{
      kind: "secret.use",
      scope: { name: "calendar-token" },
      reason: "reads the calendar",
    }],
  });
  assertEquals(accessOnly.added_permissions, ["secret.use:calendar-token"]);
  assertEquals(accessOnly.data_changes, []);
  assertEquals(accessOnly.data_schema, { from: 0, to: 0 });
  // 축소된 접근도 따로 낸다.
  const removed = compareReleases({
    previous: previous({
      permissions: [{
        kind: "document.save",
        scope: { key: "report" },
        reason: "saves the report",
      }],
    }),
    blueprint: blueprint(),
    data_schema: 0,
    data_changes: [],
  });
  assertEquals(removed.removed_permissions, ["document.save:report"]);
});

Deno.test("apps/releases#R9: automation·화면의 추가·삭제·변경을 구별한다", () => {
  const task = (interval_ms: number) => ({
    key: "nightly",
    label: "Nightly",
    when: { kind: "interval" as const, interval_ms },
    command: "list",
  });
  const result = compare(
    {
      automatic_tasks: [task(60_000)],
      screens: [{ key: "home", label: "Home", path: "/home", sizes: ["full"] }],
    },
    {
      automatic_tasks: [task(120_000)],
      screens: [
        { key: "home", label: "Home", path: "/home", sizes: ["full", "panel"] },
        { key: "stats", label: "Stats", path: "/stats", sizes: ["full"] },
      ],
    },
  );
  assertEquals(result.changed_automations, ["nightly"]);
  assertEquals(result.changed_screens, ["home"]);
  assertEquals(result.added_screens, ["stats"]);
});

Deno.test("apps/releases#R1: 동기 입력 hash는 blueprint 검증기의 정규 입력 hash와 같다", async () => {
  const schema: InputSchema = {
    type: "object",
    properties: { days: { type: "integer", default: 7 } },
    additionalProperties: false,
  };
  for (const value of [{}, { days: 3 }]) {
    const expected = await canonicalInputHash(schema, value);
    assert(expected.ok);
    assertEquals(canonicalInputHashSync(schema, value), expected.value);
  }
  const none = await canonicalInputHash(null);
  assert(none.ok);
  assertEquals(canonicalInputHashSync(null), none.value);
});
