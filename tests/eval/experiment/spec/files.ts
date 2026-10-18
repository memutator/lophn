import {
  err,
  ok,
  type Result,
  sha256Hex,
} from "../../../../packages/base/mod.ts";
import { parseSpec } from "./parse.ts";
import type { ExperimentResult, ExperimentSpec } from "./types.ts";

export const EXPERIMENTS_DIR = "tests/eval/experiments";

export async function readSpec(
  dir: string,
  id: string,
): Promise<Result<{ spec: ExperimentSpec; hash: string }>> {
  let content: string;
  try {
    content = await Deno.readTextFile(`${dir}/${id}/spec.json`);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      return err({
        code: "not_found",
        message: `no spec for experiment ${id}`,
      });
    }
    throw e;
  }
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch (e) {
    return err({
      code: "invalid_input",
      message: `spec.json of ${id} is not JSON: ${
        e instanceof Error ? e.message : String(e)
      }`,
    });
  }
  const spec = parseSpec(json, id);
  if (!spec.ok) return spec;
  return ok({ spec: spec.value, hash: await sha256Hex(content) });
}

export async function readResult(
  dir: string,
  id: string,
): Promise<Result<ExperimentResult | null>> {
  try {
    return ok(JSON.parse(await Deno.readTextFile(`${dir}/${id}/result.json`)));
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return ok(null);
    throw e;
  }
}

// 판정이 난 result는 덮지 않는다: 같은 spec을 마음에 드는 결과가 나올 때까지 굴리는 길을 막는다.
// inconclusive(예산이 끊었다)만 이어 돌린다.
export async function writeResult(
  dir: string,
  result: ExperimentResult,
): Promise<Result<void>> {
  try {
    await Deno.stat(`${dir}/${result.id}/spec.json`);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      return err({
        code: "not_found",
        message: `no spec for experiment ${result.id}`,
      });
    }
    throw e;
  }
  const old = await readResult(dir, result.id);
  if (old.ok && old.value && old.value.decision !== "inconclusive") {
    return err({
      code: "conflict",
      message:
        `experiment ${result.id} already decided (${old.value.decision}); write a new spec`,
    });
  }
  await Deno.writeTextFile(
    `${dir}/${result.id}/result.json`,
    JSON.stringify(result, null, 2) + "\n",
  );
  return ok(undefined);
}

export async function listSpecIds(dir: string): Promise<string[]> {
  const ids: string[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (!entry.isDirectory) continue;
      try {
        await Deno.stat(`${dir}/${entry.name}/spec.json`);
        ids.push(entry.name);
      } catch (e) {
        if (!(e instanceof Deno.errors.NotFound)) throw e;
      }
    }
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  return ids.sort();
}
