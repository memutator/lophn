// 앱 export 준비(apps/data#R13). data worker가 준비하는 일의 본체다: 배타 lock,
// SQLite backup API로 WAL의 확정 내용까지 포함한 DB 사본 무결성 확인, ledger에서
// 읽은 고정 blueprint·release 이력, 봉인 bundle 사본, 설치 SDK 사본 byte를 데이터
// 영역 안 staging에 모은다. secret 원값·credential은 모으지 않는다. export는
// 운영 DB 복원이나 외부 효과 취소를 뜻하지 않는다(domain-model apps/data "export").
//
// export 작업은 DATA_JOB_KINDS 밖이다: activation의 inspect·backup와 달리 ledger
// 확정이 뒤따르지 않아 data path 부모의 준비(앱 폴더)가 필요 없고, blueprint·
// release 이력·SDK root는 data worker 자식이 읽을 수 없어(allow-read가 앱 폴더만)
// 호출자(core serving이나 app 폴더 안에서 도는 조립)가 준비해 넘긴다. DB 사본은
// 이 모듈이 앱 폴더 안에서 만들고 확인한다.
import { err, ok, type Result } from "../../../base/mod.ts";
import type { BundleManifest, Release } from "../../../contracts/apps/mod.ts";
import { bundleCopyPath, readSdkCopies } from "../../releases/mod.ts";
import { openAppDatabase } from "./db.ts";
import { verifyDatabase } from "./integrity.ts";
import { acquireDataLock } from "./lock.ts";
import { contained } from "./paths.ts";

export type ExportCopy = {
  // staging 안 상대 경로(`blueprint.json`, `releases.json`, `sdk/<이름>/<version>/…`,
  // `bundles/<bundle hash>/…`).
  path: string;
  bytes: Uint8Array;
};

export type PreparedExport = {
  // 데이터 영역 상대 경로. export 묶음이 이 안에 있다.
  copy: string;
  // 검증한 DB 사본의 hash("sha256:" prefix). bundle 복사와 같은 hash 규칙이다.
  database_hash: string;
  // export가 담은 blueprint 원문(canonical JSON).
  blueprint_json: Uint8Array;
  // export가 담은 release 이력 원문.
  releases_json: Uint8Array;
  // export가 담은 bundle 매니페스트(불변 bundle 목록).
  bundles: readonly {
    bundle_hash: string;
    manifest: BundleManifest;
  }[];
  // export가 담은 SDK 사본 목록.
  sdk: readonly { name: string; version: string }[];
};

export type ExportFailure = {
  code: "invalid_input" | "conflict" | "unavailable";
  message: string;
};

function invalid(message: string): Result<never, ExportFailure> {
  return err({ code: "invalid_input", message });
}

function unavailable(message: string): Result<never, ExportFailure> {
  return err({ code: "unavailable", message });
}

const EXPORTS_DIR = "exports";
const PENDING_SUFFIX = ".pending";

// export의 호출자 입력. blueprint 원문과 release 이력은 ledger에서 읽은 것이다.
export type ExportInput = {
  app: string;
  // active release의 고정 blueprint 원문(canonical JSON). active release가 없으면 생략한다.
  blueprintJson?: Uint8Array;
  // release 이력(준비 순서). 호출자가 ledger에서 읽어 넘긴다.
  releases: readonly Release[];
  // release 이력 위에 있는 각 불변 bundle의 매니페스트. bundle 사본은 이 hash로 찾는다.
  bundles: readonly { bundle_hash: string; manifest: BundleManifest }[];
  // 설치 SDK root(`<dataRoot>/sdk`). 사본이 없으면 실패다.
  sdkRoot: string;
  // export 사본의 이름. 기본은 `export-<ISO 시각>`이다.
  name?: string;
};

// export 준비 한 번. 배타 lock을 잡고 데이터 영역 안에서만 일한다. 하나라도
// 실패하면 staging을 지우고 아무것도 남기지 않는다. 확인을 통과한 것만
// `exports/<name>`으로 남는다.
export async function prepareAppExport(
  dataArea: string,
  databasePath: string,
  input: ExportInput,
): Promise<Result<PreparedExport, ExportFailure>> {
  if (!contained(dataArea, databasePath)) {
    return invalid("database leaves the data area");
  }
  const name = input.name === undefined
    ? `export-${new Date().toISOString().replace(/[:.]/g, "-")}`
    : input.name;
  if (name.includes("/")) {
    return invalid("export name leaves the data area");
  }
  const copy = `${dataArea}/${EXPORTS_DIR}/${name}`;
  if (!contained(dataArea, copy) || copy === dataArea) {
    return invalid("export copy leaves the data area");
  }
  // SDK 사본은 app 폴더 밖(`<dataRoot>/sdk`)이라 data worker 자식이 직접 읽지
  // 못한다. 호출자가 준비한 이 입력 안에서만 읽는다.
  const sdk = await readSdkCopies(input.sdkRoot, sdkRefs(input));
  if (!sdk.ok) {
    return err({
      code: "invalid_input",
      message: `sdk copy is not installed: ${sdk.error.specifier}`,
    });
  }
  const locked = await acquireDataLock(dataArea);
  if (!locked.ok) {
    const code = locked.error.code === "conflict" ? "conflict" : "unavailable";
    return err({ code, message: locked.error.message });
  }
  try {
    // DB 사본은 backup API로 WAL의 확정 내용까지 포함해 만들고, 무결성·schema를
    // 확인한 뒤에만 export 사본으로 옮긴다(R5과 같은 관문).
    await Deno.mkdir(copy, { recursive: true });
    const pending = `${copy}/database${PENDING_SUFFIX}`;
    const opened = openAppDatabase(databasePath);
    if (!opened.ok) return unavailable(opened.error.message);
    const db = opened.value;
    const copied = await db.backupTo(pending);
    db.close();
    if (!copied.ok) {
      await removeCopy(copy);
      return unavailable("app database backup failed");
    }
    const verified = await verifyDatabase(pending);
    if (!verified.ok) {
      await removeCopy(copy);
      return err({ code: "unavailable", message: verified.error.message });
    }
    await Deno.rename(pending, `${copy}/database.sqlite`);
    // bundle 사본(0444·0555 봉인)은 그대로 읽어 export 묶음 안에 담는다.
    const bundles: { bundle_hash: string; manifest: BundleManifest }[] = [];
    try {
      for (const bundle of input.bundles) {
        const found = bundleCopyPath(dataArea, input.app, bundle.bundle_hash);
        if (!found.ok) {
          await removeCopy(copy);
          return err({ code: found.error.code, message: found.error.message });
        }
        const walked = await copyDirectory(found.value, copy, [
          "bundles",
          bundle.bundle_hash,
        ]);
        if (!walked.ok) {
          await removeCopy(copy);
          return walked;
        }
        bundles.push(bundle);
      }
    } catch (thrown) {
      await removeCopy(copy);
      return err({
        code: "unavailable",
        message: `bundle copy cannot be read: ${
          thrown instanceof Error ? thrown.message : thrown
        }`,
      });
    }
    // SDK 사본 byte와 ledger에서 읽은 원문을 staging에 쓴다.
    try {
      await Deno.writeTextFile(
        `${copy}/releases.json`,
        JSON.stringify(input.releases),
      );
      if (input.blueprintJson !== undefined) {
        await Deno.writeFile(`${copy}/blueprint.json`, input.blueprintJson);
      }
      for (const file of sdk.value) {
        const target = `${copy}/${file.path}`;
        await Deno.mkdir(target.slice(0, target.lastIndexOf("/")), {
          recursive: true,
        });
        await Deno.writeFile(target, file.bytes);
      }
    } catch (thrown) {
      await removeCopy(copy);
      return err({
        code: "unavailable",
        message: `export copy cannot be written: ${
          thrown instanceof Error ? thrown.message : thrown
        }`,
      });
    }
    return ok({
      copy,
      database_hash: verified.value.databaseHash,
      blueprint_json: input.blueprintJson ?? new Uint8Array(),
      releases_json: new TextEncoder().encode(JSON.stringify(input.releases)),
      bundles,
      sdk: sdkRefs(input),
    });
  } finally {
    await locked.value.release();
  }
}

// SDK 사본 목록이다. release 이력의 manifest.sdk_dependencies에서 푼다. 같은
// name·version은 하나만 담는다.
function sdkRefs(
  input: ExportInput,
): readonly { name: string; version: string }[] {
  const seen = new Set<string>();
  const refs: { name: string; version: string }[] = [];
  for (const bundle of input.bundles) {
    for (const dependency of bundle.manifest.sdk_dependencies) {
      const key = `${dependency.name}@${dependency.version}`;
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push({ name: dependency.name, version: dependency.version });
    }
  }
  return refs;
}

async function removeCopy(copy: string): Promise<void> {
  await Deno.remove(copy, { recursive: true }).catch(() => {});
}

// 봉인 bundle 사본의 byte를 export 묶음 안으로 읽어 옮긴다. 사본은 밖으로 나가지
// 않는다(경계 확인은 매 파일이다).
async function copyDirectory(
  from: string,
  staging: string,
  relative: readonly string[],
): Promise<Result<void, ExportFailure>> {
  const target = `${staging}/${relative.join("/")}`;
  await Deno.mkdir(target, { recursive: true });
  for await (const entry of Deno.readDir(from)) {
    if (entry.isDirectory) {
      const walked = await copyDirectory(
        `${from}/${entry.name}`,
        staging,
        [...relative, entry.name],
      );
      if (!walked.ok) return walked;
    } else if (entry.isFile) {
      const target = `${staging}/${[...relative, entry.name].join("/")}`;
      await Deno.writeFile(
        target,
        await Deno.readFile(`${from}/${entry.name}`),
      );
    }
  }
  return ok(undefined);
}
