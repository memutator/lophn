import { readFile, rename, writeFile } from "node:fs/promises";
import {
  err,
  errorCode,
  type IdSource,
  ok,
  type Result,
} from "../../../base/mod.ts";

// ledger 밖 data root 파일(agents/*.md, settings.json, secrets.json 등)의 모양을 바꾸는 step.
// 새 판의 core가 처음 뜰 때 적용하지 않은 step만 차례로 돌린다. step은 옛 모양을 새 모양으로 옮기고
// 파일을 temp에 쓴 뒤 rename한다. 중간에 끊겨 다시 돌아도 같은 결과여야 한다(기록 전에 끊기면 다시 돈다).
// 새 id가 필요한 step은 ids로 만든다. applyDataSteps는 늘 넘기고, id를 만들지 않는 step은 인자를 적게 받아도 된다.
export type DataStepDeps = { ids: IdSource };

export type DataStep = {
  id: string;
  run(root: string, deps: DataStepDeps): Promise<Result<void>>;
};

const RECORD_FILE = "data-migrations.json";

async function readApplied(root: string): Promise<Result<string[] | null>> {
  let text: string;
  try {
    text = await readFile(`${root}/${RECORD_FILE}`, "utf8");
  } catch (thrown) {
    if (errorCode(thrown) === "ENOENT") return ok(null);
    return err({
      code: "unavailable",
      message: "data migration 기록을 읽지 못했다",
    });
  }
  try {
    const parsed: unknown = JSON.parse(text);
    const applied = (parsed as { applied?: unknown } | null)?.applied;
    if (
      Array.isArray(applied) &&
      applied.every((id) => typeof id === "string")
    ) {
      return ok(applied);
    }
  } catch {
    // 아래에서 거절한다.
  }
  return err({ code: "unavailable", message: "data migration 기록이 깨졌다" });
}

async function writeApplied(
  root: string,
  applied: readonly string[],
): Promise<Result<void>> {
  const path = `${root}/${RECORD_FILE}`;
  try {
    await writeFile(
      `${path}.tmp`,
      `${JSON.stringify({ applied }, null, 2)}\n`,
      { mode: 0o600 },
    );
    await rename(`${path}.tmp`, path);
  } catch {
    return err({
      code: "unavailable",
      message: "data migration 기록을 쓰지 못했다",
    });
  }
  return ok(undefined);
}

// 적용한 step 수를 돌려준다. 새 data root는 옮길 옛 파일이 없어 돌리지 않고 모두 적용한 것으로 적는다.
// 기록에 지금 목록에 없는 id가 있으면 더 새 판이 쓴 data root라 아무것도 하지 않고 거절한다.
export async function applyDataSteps(
  root: string,
  steps: readonly DataStep[],
  fresh: boolean,
  deps: DataStepDeps,
): Promise<Result<number>> {
  const read = await readApplied(root);
  if (!read.ok) return read;
  if (read.value === null && fresh) {
    const written = await writeApplied(
      root,
      steps.map((step) => step.id),
    );
    return written.ok ? ok(0) : written;
  }
  const applied = read.value ?? [];
  const known = new Set(steps.map((step) => step.id));
  if (applied.some((id) => !known.has(id))) {
    return err({
      code: "unavailable",
      message: "설치본보다 새 판이 쓴 data root라 정상 시작을 거절한다",
      details: { start_failure: "newer_schema" },
    });
  }
  const done = new Set(applied);
  let count = 0;
  for (const step of steps) {
    if (done.has(step.id)) continue;
    const ran = await step.run(root, deps);
    if (!ran.ok) return ran;
    applied.push(step.id);
    done.add(step.id);
    const written = await writeApplied(root, applied);
    if (!written.ok) return written;
    count += 1;
  }
  // 기록 파일이 없던 옛 data root도 여기서 처음 기록을 남긴다.
  if (read.value === null && count === 0) {
    const written = await writeApplied(root, applied);
    if (!written.ok) return written;
  }
  return ok(count);
}
