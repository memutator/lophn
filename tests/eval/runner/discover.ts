import { readdir } from "node:fs/promises";

import { errorCode } from "../../../packages/base/mod.ts";
import type { Scenario } from "../types.ts";

export const SCENARIOS_DIR = new URL("../scenarios/", import.meta.url).pathname;

export type Discovered = { scenario: Scenario; path: string };

async function findFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  try {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) found.push(...await findFiles(path));
      else if (entry.isFile() && entry.name.endsWith(".scenario.ts")) {
        found.push(path);
      }
    }
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
  return found;
}

// 시나리오 file을 더해도 남의 file을 고치지 않게 공용 index 없이 폴더를 돌며 찾는다.
export async function discoverScenarios(
  dir = SCENARIOS_DIR,
): Promise<Discovered[]> {
  const found: Discovered[] = [];
  for (const path of (await findFiles(dir.replace(/\/$/, ""))).sort()) {
    const module = await import(`file://${path}`);
    const scenario = module.default as Scenario;
    const same = found.find((item) => item.scenario.id === scenario.id);
    if (same !== undefined) {
      throw new Error(
        `시나리오 id ${scenario.id}가 둘이다: ${same.path}, ${path}`,
      );
    }
    found.push({ scenario, path });
  }
  return found;
}
