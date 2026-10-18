import type { RunRecord } from "../types.ts";

export const RUNS_DIR = new URL("../runs", import.meta.url).pathname;

// dir의 *.json을 RunRecord로 읽는다. 읽지 못하거나 id가 없는 file은 이름과 이유를 담아 throw한다.
export async function readRuns(dir: string = RUNS_DIR): Promise<RunRecord[]> {
  const runs: RunRecord[] = [];
  try {
    for await (const e of Deno.readDir(dir)) {
      if (!e.isFile || !e.name.endsWith(".json")) continue;
      const file = `${dir}/${e.name}`;
      try {
        const run = JSON.parse(await Deno.readTextFile(file)) as RunRecord;
        if (typeof run.id !== "string" || run.id === "") {
          throw new Error("id가 없다");
        }
        runs.push(run);
      } catch (cause) {
        throw new Error(`run file ${e.name}을 읽지 못했다: ${cause}`);
      }
    }
  } catch (e) {
    // runs 폴더가 아직 없으면 run이 없는 것이다.
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  return runs;
}
