import { appCoreEnv } from "../../support/coding/deps.ts";
import { loadMaterial, MATERIALS_ROOT } from "./manifest.ts";

const NEEDS_APP_ENV = ["active_app", "app_data", "package"];

// release 준비와 app test가 쓰는 deno dir과 systemd-run 환경이다. 해당 재료가 없으면 비운다.
export async function restoreCoreEnv(
  refs: string[],
  root = MATERIALS_ROOT,
): Promise<Record<string, string>> {
  const seen = new Set<string>();
  let needed = false;
  const visit = async (ref: string) => {
    if (seen.has(ref)) return;
    seen.add(ref);
    const { manifest } = await loadMaterial(root, ref);
    if (NEEDS_APP_ENV.includes(manifest.kind)) needed = true;
    for (const need of manifest.needs) await visit(need);
  };
  for (const ref of refs) await visit(ref);
  return needed ? await appCoreEnv() : {};
}
