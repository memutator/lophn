import { err, ok, type Result } from "../../../packages/base/mod.ts";
import { kindsFilePath } from "../../../packages/protocol/projects/mod.ts";
import type { SetupContext } from "../types.ts";
import { type Material, textOf } from "./manifest.ts";

// kind 파일은 release 없이 바로 쓰이므로 project 폴더 밖 data root에 놓기만 하면 된다.
export async function restoreKinds(
  ctx: SetupContext,
  material: Material,
): Promise<Result<void>> {
  const spec = JSON.parse(textOf(material, "spec.json")) as { project: string };
  const project = ctx.world.projects[spec.project];
  if (project === undefined) {
    return err({
      code: "invalid_input",
      message: `kinds: project ${spec.project} not restored`,
    });
  }
  const path = kindsFilePath(ctx.core.run.home, project);
  await Deno.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  await Deno.writeTextFile(path, textOf(material, "kinds.yaml"));
  return ok(undefined);
}
