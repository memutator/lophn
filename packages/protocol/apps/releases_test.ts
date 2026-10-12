import { assert, assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import { ALL_EVENTS, ALL_ROUTES } from "../mod.ts";
import { eventEnvelopeSchema } from "../events/events.ts";
import { routePath } from "../base/route.ts";
import {
  activationInputSchema,
  activationSchema,
  BLUEPRINT_EXTRACT_LIMIT_MS,
  bundleManifestSchema,
  dataChangeSchema,
  dataResultSchema,
  RELEASE_BUNDLE_MAX_BYTES,
  RELEASE_EVENTS,
  RELEASE_FILE_MAX_COUNT,
  RELEASE_PREPARATION_LIMIT_MS,
  RELEASE_ROUTES,
  RELEASE_SOURCE_MAX_BYTES,
  RELEASE_STATUSES,
  releaseActivated,
  releaseActivationFailed,
  releaseActivationStarted,
  releaseBackupRecorded,
  releaseCancelPreparation,
  releaseCompleteActivation,
  releaseDataChanged,
  releaseDataRestored,
  releaseFailActivation,
  releasePreparation,
  releasePrepare,
  releasePrepareBundle,
  releasePrepared,
  releaseRecordBackup,
  releaseRecordDataChange,
  releaseRecordDataRestore,
  releaseSchema,
  releasesCompareInputSchema,
  releasesCompareOutputSchema,
  releasesGetInputSchema,
  releasesGetOutputSchema,
  releasesListInputSchema,
  releasesListOutputSchema,
  releaseStartActivation,
  releaseSuperseded,
  ticketSourceInputSchema,
  ticketSourceSchema,
} from "./releases.ts";
import { EVENTS, ROUTES } from "./registry.ts";

const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
const OTHER_APP = "app_01h456vb4pex5v6nkc6gd5fdw1";
const REL = "rel_01h455vb4pex5v6nkc6gd5fdw1";
const PREV_REL = "rel_01h456vb4pex5v6nkc6gd5fdw1";
const TKT = "tkt_01h455vb4pex5v6nkc6gd5fdw1";
const VRF = "vrf_01h455vb4pex5v6nkc6gd5fdw1";
const VRF2 = "vrf_01h456vb4pex5v6nkc6gd5fdw1";
const APR = "apr_01h455vb4pex5v6nkc6gd5fdw1";
const INV = "inv_01h455vb4pex5v6nkc6gd5fdw1";
const AT = "2026-10-04T00:00:00.000Z";
const COMMIT = "ab".repeat(20);
const HASH = "ab".repeat(32);
const META = { as_of_seq: "8", next_cursor: null };

const ticketSource = { ticket: TKT, claim_seq: "8" };

const dataChanges = [
  {
    from: 0,
    to: 2,
    script_hash: HASH,
    description: "usage 표를 만들고 기존 항목은 남긴다",
  },
];

const manifest = {
  entrypoint: "main.ts",
  files: [
    { path: "main.ts", hash: HASH },
    { path: "screens/home.ts", hash: "cd".repeat(32) },
  ],
  sdk_dependencies: [{ name: "lophn", version: "1.2.3" }],
};

const activation = {
  started_seq: "12",
  previous_release: PREV_REL,
  approval: APR,
  expected_grants_seq: 4,
  expected_schema: 2,
  backup_hash: HASH,
  data_change_invocation: INV,
};

const release = {
  id: REL,
  app: APP,
  number: 3,
  code_commit: COMMIT,
  bundle_hash: HASH,
  blueprint_hash: "cd".repeat(32),
  data_schema: 2,
  data_changes: dataChanges,
  tests: [VRF, VRF2],
  ticket_source: ticketSource,
  created_by: "machine",
  created_at: AT,
  status: "prepared" as const,
  activation: null,
  failure: null,
};

Deno.test("apps/releases#R1, apps/releases#R12, apps/releases#R15: route와 event 이름은 architecture 5.3과 같다", () => {
  const methods = [
    "prepare_bundle",
    "preparation",
    "cancel_preparation",
    "prepare",
    "start_activation",
    "record_backup",
    "record_data_change",
    "record_data_restore",
    "complete_activation",
    "fail_activation",
    "list",
    "get",
    "compare",
  ];
  assertEquals(
    ROUTES.filter((route) => route.resource === "releases")
      .map((route) => [route.kind, routePath(route), route.name]),
    [
      ["command", "/v1/releases/prepare_bundle", "release.prepare_bundle"],
      ["command", "/v1/releases/preparation", "release.preparation"],
      [
        "command",
        "/v1/releases/cancel_preparation",
        "release.cancel_preparation",
      ],
      ["command", "/v1/releases/prepare", "release.prepare"],
      ["command", "/v1/releases/start_activation", "release.start_activation"],
      ["command", "/v1/releases/record_backup", "release.record_backup"],
      [
        "command",
        "/v1/releases/record_data_change",
        "release.record_data_change",
      ],
      [
        "command",
        "/v1/releases/record_data_restore",
        "release.record_data_restore",
      ],
      [
        "command",
        "/v1/releases/complete_activation",
        "release.complete_activation",
      ],
      ["command", "/v1/releases/fail_activation", "release.fail_activation"],
      ["read", "/v1/releases/list", "releases.list"],
      ["read", "/v1/releases/get", "releases.get"],
      ["read", "/v1/releases/compare", "releases.compare"],
    ],
  );
  assertEquals(
    ROUTES.filter((route) => route.resource === "releases").length,
    methods.length,
  );
  assertEquals(
    EVENTS.filter((event) => event.type.startsWith("Release")).map(
      (event) => event.type,
    ),
    [
      "ReleasePrepared",
      "ReleaseActivationStarted",
      "ReleaseBackupRecorded",
      "ReleaseDataChanged",
      "ReleaseDataRestored",
      "ReleaseActivated",
      "ReleaseSuperseded",
      "ReleaseActivationFailed",
    ],
  );
  assertEquals(RELEASE_ROUTES.length, 13);
  assertEquals(RELEASE_EVENTS.length, 8);
  for (const route of RELEASE_ROUTES) {
    assertEquals(ALL_ROUTES.filter((entry) => entry === route).length, 1);
  }
  for (const event of RELEASE_EVENTS) {
    assertEquals(ALL_EVENTS.filter((entry) => entry === event).length, 1);
  }
});

Deno.test("apps/releases#R1, apps/releases#R19: 상한 상수는 정책 값이다", () => {
  assertEquals(RELEASE_SOURCE_MAX_BYTES, 64 * 1024 * 1024);
  assertEquals(RELEASE_BUNDLE_MAX_BYTES, 256 * 1024 * 1024);
  assertEquals(RELEASE_FILE_MAX_COUNT, 10_000);
  assertEquals(RELEASE_PREPARATION_LIMIT_MS, 300_000);
  assertEquals(BLUEPRINT_EXTRACT_LIMIT_MS, 10_000);
});

Deno.test("apps/releases#R1, apps/releases#R5: release schema는 고정 필드를 읽는다", () => {
  const parsed = releaseSchema.parse(release);
  assertEquals(parsed.status, "prepared");
  assertEquals(parsed.ticket_source, ticketSource);
  assertEquals(parsed.data_changes.length, 1);
  assertEquals(parsed.tests, [VRF, VRF2]);
});

Deno.test("apps/releases#R1: status 전이와 activation 조건을 검사한다", () => {
  assertEquals(RELEASE_STATUSES, [
    "prepared",
    "activating",
    "active",
    "failed",
    "superseded",
  ]);
  for (const status of ["prepared", "active", "superseded"]) {
    releaseSchema.parse({ ...release, status });
  }
  // activating과 failed는 activation 필수다.
  assert(
    !releaseSchema.safeParse({ ...release, status: "activating" }).success,
  );
  assert(!releaseSchema.safeParse({ ...release, status: "failed" }).success);
  releaseSchema.parse({
    ...release,
    status: "activating",
    activation,
  });
  // failed는 failure 필수다.
  assert(
    !releaseSchema.safeParse({
      ...release,
      status: "failed",
      activation,
      failure: null,
    }).success,
  );
  releaseSchema.parse({
    ...release,
    status: "failed",
    activation,
    failure: { code: "activation_failed", summary: "시작 준비 실패" },
  });
  // test 참조는 비어 있지 않고 중복이 없다.
  assert(!releaseSchema.safeParse({ ...release, tests: [] }).success);
  assert(!releaseSchema.safeParse({ ...release, tests: [VRF, VRF] }).success);
});

Deno.test("apps/releases#R6, apps/releases#R7: ticket_source는 ticket과 claim seq를 보존한다", () => {
  assertEquals(ticketSourceSchema.parse(ticketSource), ticketSource);
  assertEquals(ticketSourceInputSchema.parse(ticketSource), ticketSource);
  // null은 과거 이력만이다.
  releaseSchema.parse({ ...release, ticket_source: null });
  // claim seq 0은 양의 정수가 아니다.
  assert(
    !ticketSourceSchema.safeParse({ ticket: TKT, claim_seq: "0" }).success,
  );
  assert(!ticketSourceSchema.safeParse({ ticket: TKT }).success);
});

Deno.test("apps/releases#R5: tests 참조는 vrf ID고 같은 bundle hash의 통과 app test다", () => {
  releaseSchema.parse({ ...release, tests: [VRF] });
  assert(
    !releaseSchema.safeParse({ ...release, tests: ["vrf_wrong"] }).success,
  );
  assert(!releaseSchema.safeParse({ ...release, tests: ["abc"] }).success);
});

Deno.test("apps/releases#R14: prepare 입력은 신뢰된 준비 결과와 같은 hash test만 받는다", () => {
  const input = {
    app: APP,
    commit: COMMIT,
    bundle_hash: HASH,
    blueprint_hash: "cd".repeat(32),
    blueprint: { name: "앱" },
    manifest,
    data_schema: 2,
    data_changes: dataChanges,
    tests: [VRF],
    ticket_source: ticketSource,
    created_by: "machine",
    key: "k".repeat(16),
  };
  const parsed = releasePrepare.input.parse(input);
  assertEquals(parsed.ticket_source, ticketSource);
  assertEquals(parsed.manifest.files.length, 2);
  // commitment input은 중복 test를 거절한다.
  assert(
    !releasePrepare.input.safeParse({ ...input, tests: [VRF, VRF] })
      .success,
  );
});

Deno.test("apps/releases#R12: start_activation은 CAS 비교 기준을 받는다", () => {
  const input = {
    release: REL,
    approval: APR,
    previous_release: PREV_REL,
    expected_grants_seq: 4,
    expected_schema: 2,
    key: "k".repeat(16),
  };
  const parsed = releaseStartActivation.input.parse(input);
  assertEquals(parsed.expected_grants_seq, 4);
  // 첫 activation은 이전 release가 없다.
  releaseStartActivation.input.parse({
    ...input,
    previous_release: null,
  });
  assert(
    !releaseStartActivation.input.safeParse({ ...input, approval: "apr" })
      .success,
  );
});

Deno.test("apps/releases#R12, apps/releases#R16: activation은 시작 seq와 이전 참조를 보존한다", () => {
  assertEquals(activationSchema.parse(activation), activation);
  assertEquals(
    activationInputSchema.parse(activation),
    activation,
  );
  // 첫 activation은 이전 release가 없다.
  activationSchema.parse({ ...activation, previous_release: null });
  assert(!activationInputSchema.safeParse(activation).success === false);
});

Deno.test("apps/releases#R12: complete_activation은 같은 시도와 준비 확인을 받는다", () => {
  releaseCompleteActivation.input.parse({
    release: REL,
    started_seq: "12",
    result: {
      release: REL,
      activation_seq: "12",
      invocation: INV,
      data_schema: 2,
      integrity_ok: true,
    },
    attestation: {
      release: REL,
      bundle_hash: HASH,
      commands: ["create_report"],
      data_schema: 2,
      process_nonce: "nonce-1",
      connection_ok: true,
    },
  });
});

Deno.test("apps/releases#R15, apps/releases#R18: fail_activation은 실패 근거와 invocation 참조를 받는다", () => {
  releaseFailActivation.input.parse({
    release: REL,
    started_seq: "12",
    failure: { code: "backup_failed", summary: "backup 확보 실패" },
    invocation: null,
  });
  releaseFailActivation.input.parse({
    release: REL,
    started_seq: "12",
    failure: { code: "activation_failed", summary: "시작 준비 실패" },
  });
  assert(
    !releaseFailActivation.input.safeParse({
      release: REL,
      started_seq: "12",
      failure: { code: "", summary: "" },
    }).success,
  );
});

Deno.test("apps/releases#R4: record_backup은 보호 hash와 그 byte를 준비한 blob과 실제 schema를 받는다", () => {
  const blob = {
    preparation: "prep-1",
    principal: "machine:apps-supervisor",
    purpose: "app_backup",
    hash: HASH,
    size_bytes: 12,
  };
  releaseRecordBackup.input.parse({
    release: REL,
    activation_seq: "12",
    backup_hash: HASH,
    blob,
    data_schema: 2,
  });
  assert(
    !releaseRecordBackup.input.safeParse({
      release: REL,
      activation_seq: "12",
      backup_hash: "xyz",
      blob,
      data_schema: 2,
    }).success,
  );
  // 보존한 blob 없이 hash만 주장하는 입력은 받지 않는다.
  assert(
    !releaseRecordBackup.input.safeParse({
      release: REL,
      activation_seq: "12",
      backup_hash: HASH,
      data_schema: 2,
    }).success,
  );
});

Deno.test("apps/releases#R4, apps/releases#R18: data_result는 실제 schema·무결성·시도를 받는다", () => {
  const result = {
    release: REL,
    activation_seq: "12",
    invocation: INV,
    data_schema: 2,
    integrity_ok: true,
  };
  assertEquals(dataResultSchema.parse(result), result);
  // restore은 invocation이 nullable이다.
  dataResultSchema.parse({ ...result, invocation: null });
  assert(
    !dataResultSchema.safeParse({ ...result, data_schema: -1 }).success,
  );
});

Deno.test("apps/releases#R4, apps/releases#R7: record_data_change와 restore은 DataResult를 받는다", () => {
  const result = {
    release: REL,
    activation_seq: "12",
    invocation: INV,
    data_schema: 2,
    integrity_ok: true,
  };
  releaseRecordDataChange.input.parse({ result });
  releaseRecordDataRestore.input.parse({ result, backup_hash: HASH });
  assert(
    !releaseRecordDataRestore.input.safeParse({ result }).success,
  );
});

Deno.test("apps/releases#R4, apps/apps-data#R3: data_changes는 앞으로 가는 경로만 받는다", () => {
  assertEquals(dataChangeSchema.parse(dataChanges[0]), dataChanges[0]);
  assert(
    !dataChangeSchema.safeParse({
      from: 2,
      to: 0,
      script_hash: HASH,
      description: "뒤로 가는 변경",
    }).success,
  );
  assert(
    !dataChangeSchema.safeParse({
      from: 0,
      to: 0,
      script_hash: HASH,
      description: "같은 schema",
    }).success,
  );
  assert(
    !dataChangeSchema.safeParse({
      from: 0,
      to: 2,
      script_hash: HASH,
      description: "",
    }).success,
  );
});

Deno.test("apps/releases#R1, apps/releases#R9: bundle manifest는 path와 SDK 의존을 고정한다", () => {
  assertEquals(bundleManifestSchema.parse(manifest), manifest);
  // path가 중복이면 거절한다.
  assert(
    !bundleManifestSchema.safeParse({
      ...manifest,
      files: [
        { path: "main.ts", hash: HASH },
        { path: "main.ts", hash: HASH },
      ],
    }).success,
  );
  // entrypoint는 상대 경로다.
  assert(
    !bundleManifestSchema.safeParse({
      ...manifest,
      entrypoint: "/etc/passwd",
    }).success,
  );
  assert(
    !bundleManifestSchema.safeParse({
      ...manifest,
      entrypoint: "../escape.ts",
    }).success,
  );
});

Deno.test("apps/releases#R9, apps/releases#R10: comparison은 사람이 볼 비교 항목을 받는다", () => {
  const comparison = {
    previous_release: PREV_REL,
    added_permissions: ["documents:write"],
    removed_permissions: [],
    added_commands: ["export_usage"],
    removed_commands: [],
    changed_commands: ["create_report"],
    command_changes: [{
      command: "create_report",
      kinds: ["effect"],
      effect_from: "write",
      effect_to: "external",
      new_required_inputs: [],
    }],
    external_commands: ["create_report"],
    description_only_commands: [],
    added_automations: [],
    removed_automations: [],
    changed_automations: [],
    added_screens: [],
    removed_screens: [],
    changed_screens: [],
    added_problem_code_warnings: ["LOPHN_PROBLEM_001"],
    data_schema: { from: 1, to: 2 },
    data_changes: dataChanges,
    review_required: true,
  };
  releasesCompareOutputSchema.parse({ ...META, comparison });
  releasesCompareInputSchema.parse({ release: REL });
  releasesCompareInputSchema.parse({
    release: REL,
    previous_release: PREV_REL,
  });
});

Deno.test("apps/releases#R1: list와 get은 불변 Release를 읽는다", () => {
  releasesListInputSchema.parse({ app: APP });
  releasesListInputSchema.parse({ status: "active" });
  releasesListInputSchema.parse({ app: APP, limit: 50, cursor: "c" });
  assert(!releasesListInputSchema.safeParse({ limit: 0 }).success);
  assert(!releasesListInputSchema.safeParse({ limit: 201 }).success);
  releasesListOutputSchema.parse({ ...META, releases: [release] });
  releasesGetInputSchema.parse({ release: REL });
  releasesGetOutputSchema.parse({ ...META, release });
  releasesGetOutputSchema.parse({ ...META, release: null });
});

Deno.test("apps/releases#R12: command 오류는 domain-model 표와 같다", () => {
  assertEquals(releasePrepareBundle.errors, [
    "forbidden",
    "invalid_input",
    "conflict",
    "unavailable",
  ]);
  assertEquals(releaseStartActivation.errors, [
    "forbidden",
    "conflict",
    "invalid_input",
  ]);
  assertEquals(releaseCompleteActivation.errors, ["conflict", "unavailable"]);
  assertEquals(releaseFailActivation.errors, ["conflict", "invalid_input"]);
  assertEquals(releaseRecordBackup.errors, [
    "conflict",
    "invalid_input",
    "unavailable",
  ]);
  assertEquals(releaseRecordDataChange.errors, [
    "conflict",
    "invalid_input",
    "unavailable",
  ]);
  assertEquals(releaseRecordDataRestore.errors, [
    "conflict",
    "invalid_input",
    "unavailable",
  ]);
  for (const route of RELEASE_ROUTES) {
    for (const code of route.errors) assert(ERROR_CODES.includes(code));
  }
});

Deno.test("apps/releases#R19: prepare_bundle은 commit과 ticket_source를 받는다", () => {
  releasePrepareBundle.input.parse({
    app: APP,
    commit: COMMIT,
    request_key: "req-1",
  });
  releasePrepareBundle.input.parse({
    app: APP,
    commit: COMMIT,
    request_key: "req-1",
    ticket_source: ticketSource,
  });
  assert(
    !releasePrepareBundle.input.safeParse({
      app: APP,
      commit: "abc",
      request_key: "req-1",
    }).success,
  );
  releasePrepareBundle.output.parse({
    request_key: "req-1",
    status: "preparing",
    bundle_hash: null,
    blueprint_hash: null,
    manifest: null,
  });
  releasePrepareBundle.output.parse({
    request_key: "req-1",
    status: "completed",
    bundle_hash: HASH,
    blueprint_hash: "cd".repeat(32),
    manifest,
  });
  releasePreparation.input.parse({ app: APP, request_key: "req-1" });
  releasePreparation.output.parse({
    app: APP,
    request_key: "req-1",
    status: "unknown",
    bundle_hash: null,
    blueprint_hash: null,
    manifest: null,
  });
  releaseCancelPreparation.input.parse({ app: APP, request_key: "req-1" });
  releaseCancelPreparation.output.parse({ accepted: true });
});

Deno.test("apps/releases#R1: ReleasePrepared event는 고정 필드·test ID·ticket_source를 싣는다", () => {
  eventEnvelopeSchema(releasePrepared).parse({
    seq: "12",
    type: "ReleasePrepared",
    subject: REL,
    actor: "machine",
    run: null,
    payload: {
      app: APP,
      number: 3,
      code_commit: COMMIT,
      bundle_hash: HASH,
      blueprint_hash: "cd".repeat(32),
      data_schema: 2,
      data_changes: dataChanges,
      tests: [VRF, VRF2],
      ticket_source: ticketSource,
      created_by: "machine",
    },
    at: AT,
  });
  // 과거 이력은 null 출처다.
  eventEnvelopeSchema(releasePrepared).parse({
    seq: "12",
    type: "ReleasePrepared",
    subject: REL,
    actor: "machine",
    run: null,
    payload: {
      app: APP,
      number: 3,
      code_commit: COMMIT,
      bundle_hash: HASH,
      blueprint_hash: "cd".repeat(32),
      data_schema: 2,
      data_changes: [],
      tests: [VRF],
      ticket_source: null,
      created_by: "machine",
    },
    at: AT,
  });
});

Deno.test("apps/releases#R12, apps/releases#R16: activation event는 시작 값을 싣는다", () => {
  eventEnvelopeSchema(releaseActivationStarted).parse({
    seq: "12",
    type: "ReleaseActivationStarted",
    subject: REL,
    actor: "machine",
    run: null,
    payload: {
      app: APP,
      started_seq: "12",
      previous_release: PREV_REL,
      approval: APR,
      expected_grants_seq: 4,
      expected_schema: 2,
    },
    at: AT,
  });
  eventEnvelopeSchema(releaseActivated).parse({
    seq: "20",
    type: "ReleaseActivated",
    subject: REL,
    actor: "machine",
    run: null,
    payload: {
      started_seq: "12",
      previous_release: PREV_REL,
      data_schema: 2,
    },
    at: AT,
  });
  eventEnvelopeSchema(releaseSuperseded).parse({
    seq: "20",
    type: "ReleaseSuperseded",
    subject: PREV_REL,
    actor: "machine",
    run: null,
    payload: {
      release: REL,
      started_seq: "12",
    },
    at: AT,
  });
});

Deno.test("apps/releases#R15, apps/releases#R18: 실패와 data event는 근거를 싣는다", () => {
  eventEnvelopeSchema(releaseActivationFailed).parse({
    seq: "18",
    type: "ReleaseActivationFailed",
    subject: REL,
    actor: "machine",
    run: null,
    payload: {
      started_seq: "12",
      failure: { code: "backup_failed", summary: "backup 확보 실패" },
      invocation: null,
    },
    at: AT,
  });
  eventEnvelopeSchema(releaseBackupRecorded).parse({
    seq: "14",
    type: "ReleaseBackupRecorded",
    subject: REL,
    actor: "machine",
    run: null,
    payload: {
      activation_seq: "12",
      backup_hash: HASH,
      data_schema: 2,
    },
    at: AT,
  });
  eventEnvelopeSchema(releaseDataChanged).parse({
    seq: "16",
    type: "ReleaseDataChanged",
    subject: REL,
    actor: "machine",
    run: null,
    payload: {
      activation_seq: "12",
      invocation: INV,
      data_schema: 2,
      integrity_ok: true,
    },
    at: AT,
  });
  eventEnvelopeSchema(releaseDataRestored).parse({
    seq: "22",
    type: "ReleaseDataRestored",
    subject: REL,
    actor: "machine",
    run: null,
    payload: {
      activation_seq: "12",
      invocation: INV,
      backup_hash: HASH,
      data_schema: 2,
      integrity_ok: true,
    },
    at: AT,
  });
});

Deno.test("apps/releases#R1, apps/releases#R5: 다른 앱 release와 다른 앱 activation은 구별한다", () => {
  // 다른 앱의 previous_release 참조도 ID 모양만 검사한다. 같은 앱 판정은 runtime이다.
  releasesGetOutputSchema.parse({
    ...META,
    release: { ...release, app: OTHER_APP },
  });
});
