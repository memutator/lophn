// `/v1/apps/blueprint` read(apps/blueprint#R2, R3). active release에 고정한 blueprint를 command·화면·
// automation의 설명으로 읽고, 설명·구조 검증·실제 test 통과를 서로 다른 필드로 낸다.
import { assert, assertEquals } from "@std/assert";
import { appBlueprint, releasePrepare } from "../../../protocol/apps/mod.ts";
import type { Blueprint } from "./mod.ts";
import { createReleaseCommands, loadActiveBlueprint } from "../releases/mod.ts";
import {
  APP,
  blueprint,
  command,
  machineContext,
  OTHER_APP,
  prepareInput,
  type ReleasesLedger,
  releasesLedger,
  userContext,
  VRF,
} from "../releases/testing/mod.ts";
import { descriptionGaps } from "./describe.ts";
import { createBlueprintReads } from "./reads.ts";

const reads = createBlueprintReads(loadActiveBlueprint);

function prepared(ledger: ReleasesLedger, value: Blueprint, active = true) {
  const input = prepareInput(value);
  ledger.verifications.set(VRF, {
    id: VRF,
    app: APP,
    kind: "app_test",
    result: "pass",
    bundle_hash: String(input.bundle_hash),
  });
  const result = createReleaseCommands().prepare.handle(
    ledger.tx(),
    machineContext(),
    releasePrepare.input.parse(input),
    {},
  );
  assert(result.ok, JSON.stringify(result));
  if (active) {
    ledger.db.prepare("UPDATE releases SET status = 'active' WHERE id = ?")
      .run(result.value.release.id);
  }
  return result.value.release;
}

function read(ledger: ReleasesLedger, app = APP) {
  return reads.blueprint.handle(
    ledger.snapshot(),
    userContext(),
    appBlueprint.input.parse({ app }),
  );
}

const described: Blueprint = blueprint({
  commands: [
    command("add_item", "write", {
      description: "Adds one item to the list",
      confirm: true,
      input: {
        type: "object",
        description: "The item to add",
        properties: {
          title: { type: "string", description: "What the item is called" },
        },
        required: ["title"],
        additionalProperties: false,
      },
    }),
    command("list_items"),
  ],
  automatic_tasks: [{
    key: "nightly",
    label: "Nightly cleanup",
    when: { kind: "interval", interval_ms: 3_600_000 },
    command: "list_items",
  }],
});

Deno.test("apps/blueprint#R2: active release의 command·화면·automation을 설명과 함께 읽는다", () => {
  const ledger = releasesLedger();
  try {
    const release = prepared(ledger, described);
    const reply = read(ledger);
    assert(reply.ok, JSON.stringify(reply));
    assert(appBlueprint.output.safeParse(reply.value).success);
    assertEquals(reply.value.release, release.id);
    assertEquals(reply.value.blueprint_hash, release.blueprint_hash);
    const add = reply.value.commands.find((entry) => entry.key === "add_item");
    assertEquals(add?.effect, "write");
    assertEquals(add?.confirm, true);
    assertEquals(add?.description, "Adds one item to the list");
    assertEquals(
      (add?.input as { required: string[] }).required,
      ["title"],
    );
    assertEquals(reply.value.screens.map((s) => [s.key, s.path, s.sizes]), [
      ["home", "/home", ["full"]],
    ]);
    assertEquals(reply.value.automations[0].label, "Nightly cleanup");
    // 실행 범위를 계산하는 쪽이 쓰는 선언 사실도 같은 release의 고정 blueprint에서 나온다.
    assertEquals(reply.value.declarations.commands, ["add_item", "list_items"]);
    assertEquals(reply.value.declarations.automations.length, 1);
    assertEquals(reply.value.declarations.automations[0].external, false);
    assertEquals(reply.value.declarations.problem_codes, []);
    // 화면·command 설명이 모두 있으면 설명이 완성이다.
    assertEquals(reply.value.evidence.description, {
      complete: true,
      gaps: [],
    });
  } finally {
    ledger.close();
  }
});

Deno.test("apps/blueprint#R2: 설명이 비었거나 입력 항목의 뜻이 없는 자리를 빈 값으로 찾는다", () => {
  const gaps = descriptionGaps(blueprint({
    screens: [{ key: "home", label: " ", path: "/home", sizes: ["full"] }],
    commands: [
      command("add", "write", {
        description: "",
        input: {
          type: "object",
          properties: {
            title: { type: "string" },
            note: { type: "string", description: "A note" },
          },
          additionalProperties: false,
        },
      }),
    ],
    automatic_tasks: [{
      key: "nightly",
      label: "",
      when: { kind: "on_start" },
      command: "add",
    }],
  }));
  assertEquals(gaps, [
    "automatic_tasks.nightly.label",
    "commands.add.description",
    "commands.add.input",
    "commands.add.input.title",
    "screens.home.label",
  ]);
  assertEquals(descriptionGaps(described), []);
});

Deno.test("apps/blueprint#R3: 설명·구조 검증·test 통과는 다른 근거이고 설명만 있는 앱에 test 성공 표시가 없다", () => {
  const ledger = releasesLedger();
  try {
    prepared(ledger, described);
    const tested = read(ledger);
    assert(tested.ok);
    assertEquals(tested.value.evidence.structure, { validated: true });
    assertEquals(tested.value.evidence.test, {
      passed: true,
      verifications: [VRF],
    });
    // 설명이 비어 있어도 test 근거는 그대로이고, 반대로 설명이 완성돼도 test를 대신하지 않는다.
    // 설명만 있는 앱(준비된 release가 채택되지 않았거나 release 자체가 없는 앱)은 읽히지 않으므로
    // test 성공 표시가 붙을 자리가 없다.
    const thin = releasesLedger();
    try {
      prepared(thin, blueprint({ description: "A calendar" }), false);
      const unadopted = read(thin);
      assert(!unadopted.ok);
      assertEquals(unadopted.error.code, "not_found");
      assert(!read(thin, OTHER_APP).ok);
    } finally {
      thin.close();
    }
    const partial = releasesLedger();
    try {
      prepared(
        partial,
        blueprint({
          commands: [command("add", "write", { input: { type: "object" } })],
        }),
      );
      const reply = read(partial);
      assert(reply.ok);
      assertEquals(reply.value.evidence.description.complete, false);
      assertEquals(reply.value.evidence.test.passed, true);
    } finally {
      partial.close();
    }
  } finally {
    ledger.close();
  }
});

Deno.test("apps/blueprint#R2: 범위 밖·없는 앱·active release가 없는 앱은 같은 not_found다", () => {
  const ledger = releasesLedger();
  try {
    // 준비만 되고 채택되지 않은 release는 blueprint를 읽을 수 없다.
    prepared(ledger, described, false);
    const unadopted = read(ledger);
    const noRelease = read(ledger, OTHER_APP);
    const absent = read(ledger, "app_01h455vb4pex5v6nkc6gd5fdw9");
    assert(!unadopted.ok);
    assertEquals(unadopted.error.code, "not_found");
    assertEquals(noRelease, unadopted);
    assertEquals(absent, unadopted);
    // 채택된 뒤 범위 밖이 되면 같은 답이다.
    ledger.db.prepare("UPDATE releases SET status = 'active'").run();
    assert(read(ledger).ok);
    ledger.hidden.add(APP);
    assertEquals(read(ledger), unadopted);
  } finally {
    ledger.close();
  }
});

Deno.test("apps/blueprint#R2: active release 없이 선택한 release의 고정 screen을 읽고 다른 앱의 release는 없는 것과 같다", () => {
  const ledger = releasesLedger();
  try {
    const release = prepared(
      ledger,
      blueprint({
        screens: [{
          key: "preview-only",
          label: "Preview",
          path: "/preview",
          sizes: ["full"],
        }],
      }),
      false,
    );
    const got = reads.blueprint.handle(ledger.snapshot(), userContext(), {
      app: APP,
      release: release.id,
    });
    assert(got.ok, JSON.stringify(got));
    assertEquals(got.value.screens[0].key, "preview-only");
    const absent = reads.blueprint.handle(ledger.snapshot(), userContext(), {
      app: OTHER_APP,
      release: release.id,
    });
    assert(!absent.ok);
    assertEquals(absent.error.code, "not_found");
  } finally {
    ledger.close();
  }
});
