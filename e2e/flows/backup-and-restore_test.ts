// platform operations slice flow E2E: backup-and-restore(docs/flows/backup-and-restore.md).
// 실제 shell(headless)·core·worker를 임시 LOPHN_HOME으로 띄우고, 사람이 settings의 Backup 탭에서
// 검증된 묶음을 고르고 잃을 기록 범위를 본 뒤 복원한다. 복원 뒤 core는 같은 pipe의 새 hello로
// 다시 시작하고, 같은 창이 복원 기준의 기록을 다시 읽는다.
// - 1·2(하루 backup)는 사람에게 보이지 않는 machine 단계다. I/O worker의 check 주기가 1시간이라
//   시험은 운영 중 ledger에서 I/O worker와 같은 createBackup으로 묶음을 만든다(packages/core/storage/migration/restore-flow_test.ts와 같다).
// - 미완성 묶음 갈래는 manifest 전에 멈춘 묶음 folder(중단된 backup)로 만든다.
// - 이 파일이 보지 않는 갈래(앱 export: app-export_test.ts가 본다, 호환되지 않는 묶음, secret
//   export·import 보호 창, 문서만 export, keychain 잠김, 확인 불가 외부 결과)는 platform#T54의
//   PR 본문에 적었다.
import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";

import {
  backupStamp,
  createBackup,
} from "../../packages/core/storage/migration/mod.ts";
import {
  type FlowShell,
  mustCall,
  openFlowShell,
  PROJECT,
  registerProject,
  removeHome,
} from "../flow-support.ts";

const LATER = "prj_01arz3ndektsv4rrffq69g5faw";

// 운영 중 ledger에서 I/O worker의 하루 backup과 같은 createBackup으로 묶음을 만든다.
async function backupNow(home: string, at: string): Promise<string> {
  const stamp = backupStamp(at);
  assert(stamp.ok);
  const db = new DatabaseSync(`${home}/lophn.db`, { readOnly: true });
  const version = Number(
    (db.prepare("select max(version) as v from schema_migrations").get() as {
      v: number | bigint;
    }).v,
  );
  db.close();
  const created = await createBackup(`${home}/lophn.db`, {
    root: home,
    schemaVersion: version,
    stamp: stamp.value,
    now: () => at,
  });
  assert(created.ok, created.ok ? "" : created.error.message);
  return created.value.created_at;
}

async function projectIds(flow: FlowShell): Promise<string[]> {
  const read = await mustCall(flow, {
    kind: "read",
    resource: "projects",
    method: "list",
    body: {},
  });
  return (read.projects as { id: string }[]).map((row) => row.id).sort();
}

// 복원 뒤 core가 다시 떠 main의 연결이 돌아올 때까지 기다린다. 그 사이 통로는 transport
// 실패로 답한다. 기한 안에 돌아오지 않으면 실패다.
async function reconnected(flow: FlowShell): Promise<void> {
  const deadline = Date.now() + 60_000;
  let last: unknown;
  while (Date.now() < deadline) {
    const reply = await flow.call({
      kind: "read",
      resource: "projects",
      method: "list",
      body: {},
    });
    if (reply.ok) return;
    last = reply;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `복원 뒤 core 연결이 돌아오지 않았다: ${JSON.stringify(last)}`,
  );
}

// 복원이 보존한 이전 현재 자료(`<work>/previous/previous.json`)를 찾는다.
async function hasPreserved(dir: string, depth = 0): Promise<boolean> {
  if (depth > 4) return false;
  for await (const entry of Deno.readDir(dir)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isFile && entry.name === "previous.json") return true;
    if (
      entry.isDirectory && entry.name !== "blobs" &&
      await hasPreserved(path, depth + 1)
    ) return true;
  }
  return false;
}

async function openBackupTab(flow: FlowShell): Promise<void> {
  await flow.until(
    `[...document.querySelectorAll("[role=tab]")].some((el) => el.textContent.trim() === "Backup")`,
    "settings에 Backup 탭이 없다",
  );
  await flow.mouseClickText("[role=tab]", "Backup");
  await flow.until(
    `document.querySelector("[data-backup]") !== null`,
    "Backup 자리가 열리지 않았다",
  );
}

Deno.test({
  name:
    "platform/backup-and-migration#R10 platform/backup-and-migration#R11 platform/backup-and-migration#R12 platform/backup-and-migration#R13 platform/backup-and-migration#R15 platform/backup-and-migration#R16 platform/approvals#R11 shell/wording#R10 flow backup-and-restore: backup → 묶음 확인 → 취소 → 복원 → 복원 기준 다시 읽기",
  // backup 탭은 settings nav에서 빠졌다(shell#T62). 이 flow는 backup 제거 작업이 지울 때까지 건너뛴다.
  ignore: true,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const folder = await Deno.realPath(
      await Deno.makeTempDir({ prefix: "lophn-e2e-backup-" }),
    );
    const flow = await openFlowShell({ start: "settings" });
    try {
      // 1·2. 복원 기준이 될 기록(프로젝트 하나)을 두고 하루 backup이 묶음을 만든다.
      await registerProject(flow, { folder });
      const createdAt = await backupNow(flow.home, new Date().toISOString());
      // 중단된 다음 backup: manifest 전이라 complete가 아니다.
      const pending = backupStamp(new Date(Date.now() + 1_000).toISOString());
      assert(pending.ok);
      await Deno.mkdir(`${flow.home}/backups/${pending.value}`, {
        recursive: true,
      });
      await Deno.writeTextFile(
        `${flow.home}/backups/${pending.value}/lophn.db`,
        "partial",
      );
      // backup 뒤의 기록. 복원하면 잃는 범위다.
      await registerProject(flow, {
        folder,
        id: LATER,
        name: "later",
        title: "Later",
      });
      assertEquals(await projectIds(flow), [PROJECT, LATER].sort());

      await t.step(
        "3: Backup 탭이 검증된 묶음과 제외 범위를 보인다",
        async () => {
          await openBackupTab(flow);
          await flow.until(
            `document.querySelectorAll("[data-backup-row]").length > 0`,
            "묶음 목록이 없다",
          );
          // 미완성 묶음은 복원 가능한 것으로 보이지 않는다. 마지막 검증 묶음만 고른다.
          assertEquals(await flow.count("[data-backup-row]"), 1);
          assertEquals(
            await flow.count(`[data-backup-row][data-restoreable="true"]`),
            1,
          );
          assert((await flow.count("[data-backup-excluded]")) === 1);
          assert((await flow.count("[data-backup-reconnect]")) === 1);
          assert((await flow.count("[data-backup-app-export]")) === 1);
        },
      );

      await t.step(
        "5 갈래: 잃을 범위를 보고 취소하면 복원하지 않는다",
        async () => {
          await flow.click(`[data-backup-row] [data-action="restore"]`);
          await flow.until(
            `document.querySelector("[data-restore-confirm] [data-lost]") !== null`,
            "복원 계획이 보이지 않는다",
          );
          assertEquals(
            await flow.evaluate(
              `document.querySelector("[data-restore-confirm] [data-lost]").getAttribute("data-lost")`,
            ),
            "count",
          );
          await flow.click(`[data-action="cancel-restore"]`);
          await flow.until(
            `document.querySelector("[data-restore-confirm]") === null`,
            "취소한 확인 자리가 남았다",
          );
          // 확인 자리를 거치지 않은 제출은 handle 없이 거절된다(옛 결정은 바뀐 대상에 쓰이지 않는다).
          const bare = await flow.evaluate(
            `window.lophnRestore.submit({ created_at: ${
              JSON.stringify(createdAt)
            } })`,
          ) as { ok: boolean };
          assertEquals(bare.ok, false);
          assertEquals(await projectIds(flow), [PROJECT, LATER].sort());
        },
      );

      await t.step("5·6·7·8: 확인한 묶음을 복원하고 결과를 본다", async () => {
        await flow.click(`[data-backup-row] [data-action="restore"]`);
        await flow.until(
          `document.querySelector('[data-action="confirm-restore"]') !== null`,
          "복원 결정 단추가 없다",
        );
        await flow.click(`[data-action="confirm-restore"]`);
        await flow.until(
          `document.querySelector('[data-submit="restored"], [data-submit="failed"]') !== null`,
          "복원 결과가 오지 않았다",
          120_000,
        );
        assertEquals(await flow.count(`[data-submit="restored"]`), 1);
        // 다시 준비해야 할 연결은 성공과 따로 보인다.
        assertEquals(await flow.count("[data-backup-reconnect]"), 1);
      });

      await t.step(
        "9·끝: 복원 기준의 기록을 다시 읽고 이전 자료는 보존된다",
        async () => {
          // 복원은 core를 다시 띄운다. main이 새 hello로 다시 연 session이 붙을 때까지 기다린다.
          await reconnected(flow);
          // 새 hello로 다시 연 session이 복원 기준 ledger를 읽는다.
          assertEquals(await projectIds(flow), [PROJECT]);
          // 복원 전 현재 자료는 지우지 않고 따로 보존한다(보존 folder의 previous.json).
          assert(await hasPreserved(flow.home), "보존한 이전 자료가 없다");
        },
      );
    } finally {
      await flow.close();
      await removeHome(flow.home);
      await Deno.remove(folder, { recursive: true });
    }
  },
});
