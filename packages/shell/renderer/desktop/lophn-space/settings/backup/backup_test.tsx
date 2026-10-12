// settings backup 자리 화면 테스트(shell#T58). 복원 가능한 묶음·제외된 자료·다시 준비할 항목,
// 만들기·검증 결과·보존 표시, 잃을 범위 확인·제출·결과 구별, secret 보호 창 열기를 가짜 통로로
// 확인한다(platform#T42, platform#T45, flow backup-and-restore).
import { assert, assertEquals } from "@std/assert";
import { click, render } from "../../../../../../design/components/testing.ts";

import { BackupPanel } from "./backup-panel.tsx";
import {
  backupRow,
  fakeBackup,
  PLAN_NO_LOST,
  PLAN_OK,
} from "./testdata/fake-source.ts";
import { find, flush } from "../../testdata/dom.ts";

const AT = "2026-10-01T00:00:00.000Z";

function textOf(root: Element): string {
  return root.textContent ?? "";
}

Deno.test("flow backup-and-restore: 복원 가능한 묶음·검증 결과·보존을 구별해 보이고 검증 전 묶음은 있는 것처럼 복원하게 하지 않는다", async () => {
  const ok = fakeBackup({
    backups: [
      backupRow("2026-10-05T00:00:00.000Z", { throughSeq: "150" }),
      backupRow("2026-10-04T00:00:00.000Z", {
        restoreable: false,
        integrity: "failed",
      }),
      backupRow("2026-10-03T00:00:00.000Z", {
        restoreable: false,
        integrity: "passed",
      }),
    ],
  });
  using view = render(<BackupPanel source={ok.source} />);
  await flush();
  const rows = [...view.container.querySelectorAll("[data-backup-row]")];
  assertEquals(rows.length, 3);
  assertEquals(rows.map((row) => row.getAttribute("data-restoreable")), [
    "true",
    "false",
    "false",
  ]);
  // 검증 통과 묶음만 [Restore]를 두고 실패·미완성 묶음은 둬도 누르지 못하게 하지 않는다.
  const restores = [
    ...rows.flatMap((
      row,
    ) => [...row.querySelectorAll("[data-action='restore']")]),
  ];
  assertEquals(restores.length, 1);
  // 만들기·검증 결과는 details 안에 정확한 값으로 둔다.
  const details = [...rows[1]!.querySelectorAll("dd")].map(textOf);
  assert(details.includes("Failed"));
  // 보존 문구는 통과한 묶음 수로 센다.
  const retained = textOf(find(view.container, "[data-retained]"));
  assert(retained.includes("The last 1 checked backup"), retained);
});

Deno.test("flow backup-and-restore: 복원 확인 자리는 잃을 최신 기록 범위를 보이고 사람이 확인하면 제출하며 성공·실패·재시작을 구별한다", async () => {
  const { source, calls } = fakeBackup({
    backups: [backupRow(AT, { throughSeq: "150" })],
    plan: PLAN_OK,
  });
  using view = render(<BackupPanel source={source} />);
  await flush();
  click(find(view.container, "[data-action='restore']"));
  await flush();
  // plan read는 확인 창을 열 때 부른다.
  assertEquals(calls.find((call) => call[0] === "restore-plan"), [
    "restore-plan",
    AT,
  ]);
  const confirm = find(view.container, "[data-restore-confirm]");
  assertEquals(
    find(confirm, "[data-lost='count']").textContent,
    "50 records made after this backup will be lost.",
  );
  // 아무것도 확인하지 않으면 제출하지 않는다.
  assertEquals(
    calls.some((call) => call[0] === "restore-submit"),
    false,
  );
  click(find(confirm, "[data-action='confirm-restore']"));
  await flush();
  assertEquals(
    calls.find((call) => call[0] === "restore-submit")?.[0],
    "restore-submit",
  );
  assertEquals(
    find(confirm, "[data-submit='restored']").textContent,
    "Restored. Your records now match the backup. Check connections that need signing in again.",
  );
});

Deno.test("flow backup-and-restore: 잃을 기록이 없으면 잃는다고 말하지 않고, 계획을 읽지 못하면 아무것도 제출하지 않는다", async () => {
  const none = fakeBackup({
    backups: [backupRow(AT)],
    plan: PLAN_NO_LOST,
  });
  using view = render(<BackupPanel source={none.source} />);
  await flush();
  click(find(view.container, "[data-action='restore']"));
  await flush();
  const confirm = find(view.container, "[data-restore-confirm]");
  assertEquals(
    find(confirm, "[data-lost='none']").textContent,
    "No records were made after this backup. Nothing is lost.",
  );
  click(find(confirm, "[data-action='confirm-restore']"));
  await flush();
  // 잃을 기록이 없어도 복원은 성공으로 끝난다.
  assertEquals(
    find(confirm, "[data-submit='restored']").textContent,
    "Restored. Your records now match the backup. Check connections that need signing in again.",
  );
  assertEquals(
    find(view.container, "[data-restore-confirm]"),
    confirm,
  );

  const broken = fakeBackup({
    backups: [backupRow(AT)],
    planCode: "not_found",
  });
  using second = render(<BackupPanel source={broken.source} />);
  await flush();
  click(find(second.container, "[data-action='restore']"));
  await flush();
  assertEquals(
    find(second.container, "[data-plan='failed']").textContent,
    "The restore couldn't start. Your records are unchanged. Try again.",
  );
  // 계획을 읽지 못했으므로 결정 단추를 두지 않는다.
  assertEquals(
    second.container.querySelector("[data-action='confirm-restore']"),
    null,
  );
});

Deno.test("flow backup-and-restore: 제출이 실패하면 기록이 그대로라고 말하고, credential 다시 준비와 secret export·import는 창 열기만 기록한다", async () => {
  const failed = fakeBackup({
    backups: [backupRow(AT)],
    restoreCode: "conflict",
  });
  using view = render(<BackupPanel source={failed.source} />);
  await flush();
  click(find(view.container, "[data-action='restore']"));
  await flush();
  click(find(view.container, "[data-action='confirm-restore']"));
  await flush();
  assertEquals(
    find(view.container, "[data-submit='failed']").textContent,
    "The restore didn't finish. Your records are unchanged. Try again.",
  );

  const secrets = fakeBackup({ backups: [backupRow(AT)], windowOpens: false });
  using second = render(<BackupPanel source={secrets.source} />);
  await flush();
  click(find(second.container, "[data-action='export-secrets']"));
  await flush();
  assertEquals(secrets.calls.find((call) => call[0] === "export-secrets"), [
    "export-secrets",
  ]);
  // 값은 이 화면이 받지 않는다: 보호 창 열기만 실패로 답한다.
  assertEquals(
    find(second.container, "[data-notice='window-failed']").textContent,
    "The window didn't open. Nothing changed. Try again.",
  );
  // 이 화면 어디에도 값 입력칸이 없다.
  assertEquals(
    second.container.querySelector("input[type='password']"),
    null,
  );
  click(find(second.container, "[data-action='import-secrets']"));
  await flush();
  assertEquals(secrets.calls.find((call) => call[0] === "import-secrets"), [
    "import-secrets",
  ]);
});

Deno.test("flow backup-and-restore: 제외된 자료와 다시 준비할 연결을 한 문장으로 보 이고 묶음이 없으면 한 문장만 보인다", async () => {
  const { source } = fakeBackup({
    backups: [backupRow(AT)],
  });
  using view = render(<BackupPanel source={source} />);
  await flush();
  const excluded = textOf(find(view.container, "[data-backup-excluded]"));
  assert(
    excluded.includes("App data, projects and app files, the OS keychain"),
  );
  const reconnect = textOf(find(view.container, "[data-backup-reconnect]"));
  assert(reconnect.includes("Credentials aren't restored"));

  const empty = fakeBackup();
  using second = render(<BackupPanel source={empty.source} />);
  await flush();
  assertEquals(
    find(second.container, "[data-backup-empty]").textContent,
    "No backups are available yet.",
  );
});

Deno.test("flow backup-and-restore: 읽지 못한 자리는 대상과 다시 시도를 보인다", async () => {
  const failed = fakeBackup({ backupsFail: true });
  using view = render(<BackupPanel source={failed.source} />);
  await flush();
  const state = view.container.querySelector("[data-state='error']");
  assert(state !== null);
  assertEquals(
    state.querySelector("[data-state='error'] p")?.textContent,
    "Couldn't load your backups.",
  );
  assert(state.querySelector("button"));
});
