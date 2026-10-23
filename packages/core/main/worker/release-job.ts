// release 준비 job 한 번(apps/releases). supervisor가 준비 요청마다 권한을 좁혀 띄우고 argv의 JSON 한 줄을
// 받아 stdout에 결과 JSON 한 줄을 남긴다. 플랫폼 credential은 받지 않는다.
// build 바로 뒤에 의존성과 migration 검사도 이 자식이 돈다: 앱이 쓴 migration SQL을 core process에서 돌리지 않는다.
import { appStagingFolder } from "../../../protocol/apps/mod.ts";
import {
  dataChangesOf,
  readBundleCopy,
} from "../../apps/releases/activation/desired.ts";
import {
  checkDependencies,
  checkMigration,
  type CheckOutcome,
} from "../../apps/releases/prepare/checks.ts";
import { prepareFromSource } from "../../apps/releases/prepare/from-source.ts";

type ReleaseJobInput = {
  dataRoot: string;
  app: string;
  sourceRoot: string;
  commit: string;
  previousSchema: number | null;
};

type ReleaseJobResult =
  | {
    ok: true;
    bundle_hash: string;
    declaration_hash: string;
  }
  | {
    ok: false;
    stage: "build" | "dependencies" | "migration";
    reason: string;
  };

function failed(
  stage: "build" | "dependencies" | "migration",
  reason: string,
): ReleaseJobResult {
  return { ok: false, stage, reason };
}

async function checkSealedCopy(
  input: ReleaseJobInput,
  bundleHash: string,
): Promise<ReleaseJobResult | null> {
  const copy = await readBundleCopy(input.dataRoot, input.app, bundleHash);
  if (!copy.ok) return failed("build", copy.error.message);
  if (copy.value === undefined) {
    return failed("build", "the prepared bundle copy is missing");
  }
  const parts = copy.value;
  const changes = await dataChangesOf(parts);
  // `-- loss:` 줄이 틀리면 여기서 떨어진다.
  if (!changes.ok) return failed("migration", changes.error.message);
  let imports: Record<string, string>;
  try {
    const map = JSON.parse(
      await Deno.readTextFile(parts.importMap),
    ) as { imports?: Record<string, string> };
    imports = map.imports ?? {};
  } catch {
    return failed("build", "the prepared import map cannot be read");
  }
  const dependencies = checkDependencies({
    dependencies: parts.manifest.dependencies,
    imports,
  });
  if (!dependencies.ok) return failed("dependencies", dependencies.reason);

  const staging = appStagingFolder(input.dataRoot, input.app);
  await Deno.mkdir(staging, { recursive: true });
  const area = await Deno.makeTempDir({ dir: staging, prefix: "checks-" });
  let migration: CheckOutcome;
  try {
    migration = await checkMigration({
      bundleRoot: parts.root,
      dataChanges: changes.value,
      dataSchema: parts.dataSchema,
      previousSchema: input.previousSchema,
      area,
    });
  } finally {
    await Deno.remove(area, { recursive: true }).catch(() => undefined);
  }
  return migration.ok ? null : failed("migration", migration.reason);
}

if (import.meta.main) {
  const input = JSON.parse(Deno.args[0] ?? "{}") as ReleaseJobInput;
  const prepared = await prepareFromSource(input);
  let result: ReleaseJobResult;
  if (!prepared.ok) {
    result = failed("build", prepared.error.reason);
  } else {
    result = await checkSealedCopy(input, prepared.value.bundleHash) ?? {
      ok: true,
      bundle_hash: prepared.value.bundleHash,
      declaration_hash: prepared.value.blueprintHash,
    };
  }
  console.log(JSON.stringify(result));
}
