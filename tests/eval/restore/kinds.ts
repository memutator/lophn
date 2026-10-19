import { err, ok, type Result } from "../../../packages/base/mod.ts";
import { domainKindsFile } from "../../../packages/protocol/domains/mod.ts";
import type { SetupContext } from "../types.ts";
import { type Material, textOf } from "./manifest.ts";

// kind 파일은 release 없이 바로 쓰이므로 domain 폴더(data root 아래)에 놓기만 하면 된다.
// spec.domain은 domain id다. world에 domain 표가 생길 때까지 자료가 id를 직접 적는다.
export async function restoreKinds(
  ctx: SetupContext,
  material: Material,
): Promise<Result<void>> {
  const spec = JSON.parse(textOf(material, "spec.json")) as { domain?: string };
  if (spec.domain === undefined) {
    return err({
      code: "invalid_input",
      message: "kinds: spec.json needs a domain id",
    });
  }
  const path = domainKindsFile(ctx.core.run.home, spec.domain);
  await Deno.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  await Deno.writeTextFile(path, textOf(material, "kinds.yaml"));
  return ok(undefined);
}
