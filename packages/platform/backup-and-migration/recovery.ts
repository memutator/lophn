import { err, ok, type Result } from "../../base/mod.ts";
import { BACKUP_LEDGER_PATH } from "../../contracts/platform/mod.ts";
import { type LedgerConnection, openConnection } from "../ledger/mod.ts";

// 복구본 stamp. yyyyMMddThhmmssSSSZ 하나다. colon·slash가 없어 파일 이름이 된다.
export const RECOVERY_STAMP = /^[0-9]{8}T[0-9]{6}[0-9]{3}Z$/;

export type RecoveryCopy = {
  // backups/migrations/s<N>-<stamp>/ledger.db
  path: string;
  schemaVersion: number;
};

export type RecoveryDeps = {
  // 데이터 root. 복구본은 <root>/backups/migrations/ 밑에 둔다.
  root: string;
  // 변환 전 schema 순번.
  schemaVersion: number;
  // clock.now()를 그대로 쓰지 않고 filename-safe stamp로 바꿔 넣는다.
  stamp: string;
};

// clock 시각(YYYY-MM-DDTHH:mm:ss.sssZ)을 s<N>- 폴더 stamp로 바꾼다.
export function recoveryStamp(at: string): Result<string> {
  const parsed = Date.parse(at);
  if (Number.isNaN(parsed)) {
    return err({ code: "invalid_input", message: "시각을 읽을 수 없다" });
  }
  const d = new Date(parsed);
  const pad = (n: number, width: number) => n.toString().padStart(width, "0");
  return ok(
    `${pad(d.getUTCFullYear(), 4)}${pad(d.getUTCMonth() + 1, 2)}${
      pad(d.getUTCDate(), 2)
    }T${pad(d.getUTCHours(), 2)}${pad(d.getUTCMinutes(), 2)}${
      pad(d.getUTCSeconds(), 2)
    }${pad(d.getUTCMilliseconds(), 3)}Z`,
  );
}

export function recoveryName(schemaVersion: number, stamp: string): string {
  return `s${schemaVersion}-${stamp}`;
}

// vacuum이 만든 복구본을 attach한 연결로 integrity를 본다.
function copyIntegrityOk(
  connection: LedgerConnection,
  attached: string,
): boolean {
  try {
    const rows = connection.sql.all(
      `select * from ${attached}.pragma_integrity_check`,
      [],
    );
    return rows.length === 1 && rows[0]?.["integrity_check"] === "ok";
  } catch {
    return false;
  }
}

// migration 적용 전 복구본. SQLite backup API(VACUUM INTO)가 일관된 snapshot을
// 만들고 attach한 integrity 검사를 통과한 뒤에만 시작 경로로 돌아간다(R3).
// 어느 곳에서 실패해도 원본 파일은 건드리지 않는다(R18: 성공한 복구본은 남는다).
export async function createRecoveryCopy(
  sourcePath: string,
  deps: RecoveryDeps,
): Promise<Result<RecoveryCopy>> {
  if (!RECOVERY_STAMP.test(deps.stamp)) {
    return err({
      code: "invalid_input",
      message: "복구본 stamp가 filename-safe 형식이 아니다",
    });
  }
  const name = recoveryName(deps.schemaVersion, deps.stamp);
  const directory = `${deps.root}/backups/migrations/${name}`;
  try {
    await Deno.mkdir(directory, { recursive: true, mode: 0o700 });
  } catch {
    return err({
      code: "unavailable",
      message: "복구본 directory를 만들지 못했다",
    });
  }
  const copyPath = `${directory}/${BACKUP_LEDGER_PATH}`;
  // target이 이미 있으면 vacuum이 실패한다. 이미 같은 stamp가 있으면 거절한다.
  try {
    await Deno.stat(copyPath);
    return err({ code: "unavailable", message: "같은 이름의 복구본이 이미 있다" });
  } catch (thrown) {
    if (!(thrown instanceof Deno.errors.NotFound)) {
      return err({
        code: "unavailable",
        message: "복구본 자리를 확인하지 못했다",
      });
    }
  }
  // 원본 연결 하나로 vacuum과 검사를 같이 한다. WAL 안의 내용도 snapshot에 들어간다.
  const opened = openConnection(sourcePath);
  if (!opened.ok) return opened;
  const connection = opened.value;
  let vacuumed = false;
  let failed: Result<never> | undefined;
  try {
    connection.exec(`vacuum into '${copyPath}'`);
    vacuumed = true;
    //vacuum이 만든 복구본을 attach해 integrity를 검사한다.
    let attached = false;
    try {
      connection.exec(`attach database '${copyPath}' as migration_recovery`);
      attached = true;
      if (!copyIntegrityOk(connection, "migration_recovery")) {
        failed = err({
          code: "unavailable",
          message: "복구본 무결성 검사가 실패해 migration을 시작하지 않는다",
        });
      }
    } catch {
      failed = err({ code: "unavailable", message: "복구본 검사에 실패했다" });
    } finally {
      if (attached) {
        try {
          connection.exec("detach database migration_recovery");
        } catch {
          //detach가 실패해도 연결을 닫는다.
        }
      }
    }
  } catch {
    failed = err({ code: "unavailable", message: "복구본을 만들지 못했다" });
  } finally {
    connection.close();
  }
  if (failed !== undefined) {
    // 실패한 복구본은 남기지 않는다. R18의 대상은 성공한 복구본이다.
    if (vacuumed) {
      try {
        await Deno.remove(copyPath);
      } catch {
        // 이미 사라진 파일
      }
    }
    return failed;
  }
  return ok({ path: copyPath, schemaVersion: deps.schemaVersion });
}
