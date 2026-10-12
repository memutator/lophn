import {
  canonicalize,
  err,
  formatSeq,
  ok,
  parseSeq,
  type Result,
  sha256Hex,
} from "../../../base/mod.ts";
import {
  BACKUP_LEDGER_PATH,
  type BackupManifest,
} from "../../../protocol/platform/mod.ts";
import {
  BACKUP_DIR_NAME,
  BACKUP_PENDING_NAME,
  BACKUP_STAMP,
  backupStamp,
  findBackupDirectory,
  readManifest,
  snapshotRefs,
  snapshotThroughSeq,
  verifyCopyIntegrity,
} from "./backup.ts";
import { newLedgerId, readLedgerId, writeLedgerId } from "./ledger-id.ts";

// restore(platform/backup-and-migration#R13, R14). 모든 writer·worker를 정지한 뒤에만 현재
// 자료를 따로 보존하고, 검증을 마친 staging 본으로 ledger를 바꾼다. 여기까지가 파일의 일이고,
// 사람이 잃을 범위를 확인하는 일과 정지는 호출하는 core의 몫이다.

// 보존본·staging은 backups/restore/<stamp>/ 밑에 둔다. 이 이름은 묶음 stamp가 아니라서
// 목록·보존 정리(retainBackups)가 지나치지 않는다.
export const RESTORE_DIR_NAME = "restore";

// 사람이 잃을 범위를 확인했다는 handle의 결정 이름. 확인은 이 결정 하나에만 쓴다.
export const RESTORE_DECISION = "restore_backup";

// 정지 조건. 셋 다 관측으로 채운다(core 종료 조립). 하나라도 거짓이면 아무것도 건드리지 않는다.
export type RestoreStopped = {
  preparationsBlocked: boolean;
  commandsBlocked: boolean;
  writerStopped: boolean;
};

export type RestorePlan = {
  manifest: BackupManifest;
  // 고르는 순간의 현재 ledger 끝. 사람이 본 범위의 한쪽 끝이다.
  current_through_seq: string;
  // 복원하면 잃는 기록(묶음 through_seq 다음부터 현재 끝까지). 잃는 것이 없으면 null.
  lost: { from_seq: string; through_seq: string; events: number } | null;
};

const LEDGER_FILE = "lophn.db";

async function currentHead(ledgerPath: string): Promise<Result<string | null>> {
  // 없는 경로를 연결로 열면 새 ledger가 생긴다. 먼저 있는지 본다.
  try {
    if (!(await Deno.stat(ledgerPath)).isFile) return ok(null);
  } catch (thrown) {
    if (thrown instanceof Deno.errors.NotFound) return ok(null);
    return err({
      code: "unavailable",
      message: "현재 ledger를 확인하지 못했다",
    });
  }
  const head = snapshotThroughSeq(ledgerPath);
  return head.ok ? ok(head.value) : head;
}

// 고른 묶음이 복원 가능한지 보고 잃을 범위를 계산한다. 파일은 바꾸지 않는다.
// 복원 가능: manifest가 complete·integrity passed이고 만들기 중 표시가 없으며 이 설치가
// 읽을 수 있는 schema다(flow backup-and-restore 다른 갈래: 호환되지 않는 묶음은 열지 않는다).
export async function planRestore(
  root: string,
  ledgerPath: string,
  createdAt: string,
  supportedSchema: number,
): Promise<Result<RestorePlan>> {
  const directory = await findBackupDirectory(root, createdAt);
  if (directory === undefined) {
    return err({ code: "not_found", message: "backup이 없다" });
  }
  const manifest = await readManifest(directory);
  if (manifest === undefined) {
    return err({ code: "not_found", message: "backup이 없다" });
  }
  let pending = true;
  try {
    await Deno.stat(`${directory}/${BACKUP_PENDING_NAME}`);
  } catch (thrown) {
    pending = !(thrown instanceof Deno.errors.NotFound);
  }
  if (pending || !manifest.complete || manifest.integrity !== "passed") {
    return err({
      code: "unavailable",
      message: "완료·검증되지 않은 backup은 복원할 수 없다",
    });
  }
  if (manifest.schema_version > supportedSchema) {
    return err({
      code: "unavailable",
      message: "이 설치보다 새 schema의 backup은 복원할 수 없다",
    });
  }
  const head = await currentHead(ledgerPath);
  if (!head.ok) return head;
  const current = head.value ?? "0";
  const through = parseSeq(manifest.through_seq);
  const now = parseSeq(current);
  if (!through.ok || !now.ok) {
    return err({ code: "unavailable", message: "seq를 읽지 못했다" });
  }
  return ok({
    manifest,
    current_through_seq: current,
    lost: now.value > through.value
      ? {
        from_seq: formatSeq(through.value + 1n),
        through_seq: current,
        events: Number(now.value - through.value),
      }
      : null,
  });
}

// 사람이 확인한 것을 handle에 묶는 기준. 대상은 묶음(created_at)이고 내용은 묶음의 끝과 현재
// 끝, 곧 잃는 범위다. 확인 뒤 ledger가 자라면 내용이 달라져 옛 확인은 쓸 수 없다.
export async function restoreBinding(
  plan: Pick<RestorePlan, "current_through_seq"> & {
    manifest: Pick<BackupManifest, "created_at" | "through_seq">;
  },
): Promise<{ target: string; content: string }> {
  return {
    target: plan.manifest.created_at,
    content: await sha256Hex(canonicalize({
      created_at: plan.manifest.created_at,
      through_seq: plan.manifest.through_seq,
      current_through_seq: plan.current_through_seq,
    })),
  };
}

export type RestoreDeps = {
  root: string;
  ledgerPath: string;
  // backups/restore/<stamp>/. 묶음 stamp와 같은 filename-safe 형식이다.
  stamp: string;
  createdAt: string;
  supportedSchema: number;
  // 사람이 확인한 현재 끝. 정지 뒤 다시 읽은 끝이 다르면 확인하지 않은 기록이 생긴 것이라 멈춘다.
  expectedCurrentSeq: string;
  conditions: RestoreStopped;
  now(): string;
};

export type RestoreOutcome = {
  // 복원한 묶음.
  created_at: string;
  restored_through_seq: string;
  // 복원 전 현재 자료(보존본). 사람이 지우기 전에는 남는다.
  previous_directory: string;
  previous_through_seq: string | null;
  // 새로 정한 ledger 식별. 이 값이 바뀌어 derived가 다시 만들어진다.
  ledger_id: string;
};

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

function blobPath(root: string, hash: string): string {
  return `${root}/blobs/sha256/${hash.slice(0, 2)}/${hash.slice(2)}`;
}

function failed(message: string): Result<never> {
  return err({ code: "unavailable", message });
}

// stamp(yyyyMMddThhmmssSSSZ)를 1ms 뒤로 옮긴다.
function bumpStamp(stamp: string): string | undefined {
  const parsed = Date.parse(
    `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${
      stamp.slice(9, 11)
    }:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}.${stamp.slice(15, 18)}Z`,
  );
  if (Number.isNaN(parsed)) return undefined;
  const next = backupStamp(new Date(parsed + 1).toISOString());
  return next.ok ? next.value : undefined;
}

type Staged = { directory: string; ledger: string };

// staging: 묶음 ledger를 복사하고 복사본을 다시 검증한다. 묶음의 blob은 하나하나 실제 hash·size를
// 확인한다. 묶음 folder와 현재 자료는 읽기만 한다.
async function stage(
  backup: string,
  manifest: BackupManifest,
  work: string,
): Promise<Result<Staged>> {
  const directory = `${work}/staging`;
  const ledger = `${directory}/${LEDGER_FILE}`;
  try {
    await Deno.mkdir(directory, { recursive: true, mode: 0o700 });
    await Deno.copyFile(`${backup}/${manifest.ledger_path}`, ledger);
    await Deno.chmod(ledger, 0o600);
  } catch {
    return failed("backup ledger를 staging에 복사하지 못했다");
  }
  let bytes: Uint8Array;
  try {
    bytes = await Deno.readFile(ledger);
  } catch {
    return failed("staging ledger를 읽지 못했다");
  }
  if (await sha256Hex(bytes) !== manifest.ledger_hash) {
    return failed("backup ledger가 manifest hash와 다르다");
  }
  if (!verifyCopyIntegrity(ledger)) {
    return failed("staging ledger 무결성 검사가 실패했다");
  }
  const through = snapshotThroughSeq(ledger);
  if (!through.ok || through.value !== manifest.through_seq) {
    return failed("staging ledger의 끝이 manifest와 다르다");
  }
  // ledger가 가리키는 blob은 모두 묶음에 있어야 한다. 하나라도 없는 묶음으로 바꾸지 않는다.
  const refs = snapshotRefs(ledger);
  if (!refs.ok) return refs;
  const listed = new Set(manifest.blobs.map((blob) => blob.hash));
  for (const ref of refs.value) {
    if (!listed.has(ref.hash)) {
      return failed("ledger 참조 blob이 backup에 없다");
    }
  }
  for (const blob of manifest.blobs) {
    let content: Uint8Array;
    try {
      content = await Deno.readFile(`${backup}/${blob.path}`);
    } catch {
      return failed("backup blob이 없다");
    }
    if (
      content.length !== blob.size_bytes ||
      await sha256Hex(content) !== blob.hash
    ) {
      return failed("backup blob 내용이 manifest와 다르다");
    }
  }
  return ok({ directory, ledger });
}

// 현재 자료 보존. ledger는 일관된 사본(VACUUM INTO)이고 blob은 같은 파일 시스템의 hard link다.
// link는 복사 없이 blob GC가 현재 store에서 지워도 보존본의 내용을 지킨다.
async function preserve(
  deps: RestoreDeps,
  work: string,
  oldId: string | undefined,
  head: string | null,
): Promise<Result<{ directory: string; missingBlobs: number }>> {
  const previous = `${work}/previous`;
  try {
    await Deno.mkdir(previous, { recursive: true, mode: 0o700 });
  } catch {
    return failed("현재 자료 보존 folder를 만들지 못했다");
  }
  let missingBlobs = 0;
  if (head !== null) {
    const copy = `${previous}/${BACKUP_LEDGER_PATH}`;
    // 모든 writer가 멈췄으므로 파일을 그대로 복사한다(R13: 정지 뒤 물리 복사). 제한한 권한의
    // 프로세스에서는 VACUUM INTO가 쓰는 attach를 쓸 수 없다. 복구가 필요한 WAL·SHM도 같이 둔다.
    try {
      await Deno.copyFile(deps.ledgerPath, copy);
      for (const suffix of ["-wal", "-shm"]) {
        try {
          await Deno.copyFile(
            `${deps.ledgerPath}${suffix}`,
            `${copy}${suffix}`,
          );
        } catch (thrown) {
          if (!(thrown instanceof Deno.errors.NotFound)) throw thrown;
        }
      }
    } catch {
      return failed("현재 ledger를 보존하지 못했다");
    }
    if (!verifyCopyIntegrity(copy)) {
      return failed("보존한 현재 ledger 무결성 검사가 실패했다");
    }
    const refs = snapshotRefs(copy);
    if (!refs.ok) return refs;
    const hashes = new Set(refs.value.map((ref) => ref.hash));
    for (const hash of hashes) {
      const target = `${previous}/blobs/sha256/${hash.slice(0, 2)}/${
        hash.slice(2)
      }`;
      try {
        await Deno.mkdir(target.slice(0, target.lastIndexOf("/")), {
          recursive: true,
          mode: 0o700,
        });
        try {
          await Deno.link(blobPath(deps.root, hash), target);
        } catch (thrown) {
          if (thrown instanceof Deno.errors.NotFound) throw thrown;
          await Deno.copyFile(blobPath(deps.root, hash), target);
        }
      } catch {
        // 현재 store에도 없는 blob이다. 보존할 수 없는 것을 세어 남긴다.
        missingBlobs++;
      }
    }
  }
  try {
    await Deno.writeTextFile(
      `${previous}/previous.json`,
      JSON.stringify(
        {
          preserved_at: deps.now(),
          through_seq: head,
          ledger_id: oldId ?? null,
          restored_from: deps.createdAt,
          missing_blobs: missingBlobs,
        },
        null,
        "  ",
      ) + "\n",
      { mode: 0o600 },
    );
  } catch {
    return failed("현재 자료 보존 기록을 남기지 못했다");
  }
  return ok({ directory: previous, missingBlobs });
}

// 묶음 blob을 현재 store에 넣는다. 같은 hash가 이미 있으면 그대로 둔다(불변·내용 주소).
async function installBlobs(
  deps: RestoreDeps,
  backup: string,
  manifest: BackupManifest,
): Promise<Result<void>> {
  for (const blob of manifest.blobs) {
    const target = blobPath(deps.root, blob.hash);
    if (await exists(target)) continue;
    try {
      await Deno.mkdir(target.slice(0, target.lastIndexOf("/")), {
        recursive: true,
        mode: 0o700,
      });
      await Deno.mkdir(`${deps.root}/blobs/tmp`, {
        recursive: true,
        mode: 0o700,
      });
      const temporary = `${deps.root}/blobs/tmp/restore-${blob.hash}`;
      await Deno.copyFile(`${backup}/${blob.path}`, temporary);
      await Deno.chmod(temporary, 0o400);
      await Deno.rename(temporary, target);
    } catch {
      return failed("backup blob을 store에 넣지 못했다");
    }
  }
  return ok(undefined);
}

// 정지한 data root에서 한 묶음으로 복원한다. 검증·보존이 끝나기 전에는 현재 ledger를 건드리지
// 않고, 바꾸는 단계는 rename 하나다. 실패하면 현재 자료는 그대로이고 사람이 다시 고른다.
export async function restoreFromBackup(
  deps: RestoreDeps,
): Promise<Result<RestoreOutcome>> {
  if (!BACKUP_STAMP.test(deps.stamp)) {
    return err({
      code: "invalid_input",
      message: "restore stamp가 filename-safe 형식이 아니다",
    });
  }
  const { preparationsBlocked, commandsBlocked, writerStopped } =
    deps.conditions;
  if (!(preparationsBlocked && commandsBlocked && writerStopped)) {
    return failed("모든 writer와 worker가 멈추기 전에는 복원하지 않는다");
  }
  const planned = await planRestore(
    deps.root,
    deps.ledgerPath,
    deps.createdAt,
    deps.supportedSchema,
  );
  if (!planned.ok) return planned;
  const { manifest } = planned.value;
  if (planned.value.current_through_seq !== deps.expectedCurrentSeq) {
    return err({
      code: "conflict",
      message: "사람이 확인한 뒤 현재 기록이 달라졌다",
    });
  }
  const backup = await findBackupDirectory(deps.root, deps.createdAt);
  if (backup === undefined) {
    return err({ code: "not_found", message: "backup이 없다" });
  }
  // 같은 시각에 이미 한 번 복원했으면(시계가 멈춘 테스트·빠른 반복) 비어 있는 다음 ms를 쓴다.
  // 앞선 복원의 보존본은 어떤 경우에도 덮지 않는다.
  const restoreRoot = `${deps.root}/${BACKUP_DIR_NAME}/${RESTORE_DIR_NAME}`;
  let stamp = deps.stamp;
  for (let tries = 0; await exists(`${restoreRoot}/${stamp}`); tries++) {
    const next = bumpStamp(stamp);
    if (tries >= 1000 || next === undefined) {
      return failed("restore 작업 folder 이름을 정하지 못했다");
    }
    stamp = next;
  }
  const work = `${restoreRoot}/${stamp}`;
  try {
    await Deno.mkdir(work, { recursive: true, mode: 0o700 });
  } catch {
    return failed("restore 작업 folder를 만들지 못했다");
  }
  const staged = await stage(backup, manifest, work);
  if (!staged.ok) return staged;
  const head = await exists(deps.ledgerPath)
    ? planned.value.current_through_seq
    : null;
  const oldId = await readLedgerId(deps.root);
  const preserved = await preserve(deps, work, oldId, head);
  if (!preserved.ok) return preserved;
  const installed = await installBlobs(deps, backup, manifest);
  if (!installed.ok) return installed;
  // 새 식별을 ledger를 바꾸기 전에 쓴다. 이 사이에 죽어도 식별만 달라지고 derived는 다시 만든다.
  let id = newLedgerId();
  while (id === oldId) id = newLedgerId();
  const written = await writeLedgerId(deps.root, id);
  if (!written.ok) return written;
  try {
    // 옛 ledger의 WAL·SHM이 새 ledger에 붙으면 안 된다.
    for (const suffix of ["-wal", "-shm"]) {
      try {
        await Deno.remove(`${deps.ledgerPath}${suffix}`);
      } catch (thrown) {
        if (!(thrown instanceof Deno.errors.NotFound)) throw thrown;
      }
    }
    await Deno.rename(staged.value.ledger, deps.ledgerPath);
  } catch {
    return failed("복원한 ledger로 바꾸지 못했다");
  }
  try {
    await Deno.remove(staged.value.directory);
  } catch {
    // 남은 빈 staging folder는 결과에 영향이 없다.
  }
  return ok({
    created_at: manifest.created_at,
    restored_through_seq: manifest.through_seq,
    previous_directory: preserved.value.directory,
    previous_through_seq: head,
    ledger_id: id,
  });
}
