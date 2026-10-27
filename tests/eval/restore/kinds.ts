import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";
import { err, ok, type Result } from "../../../packages/base/mod.ts";
import {
  domainCreate,
  domainKindsFile,
} from "../../../packages/protocol/domains/mod.ts";
import type { RestoreContext } from "../types.ts";
import { type Material, textOf } from "./manifest.ts";

const specSchema = z.strictObject({
  project: z.string(),
  domain: domainCreate.input
    .pick({
      id: true,
      name: true,
      title: true,
      purpose: true,
    })
    .required({ id: true }),
});

// kind 파일은 domain 폴더에 있으므로 project 안에 domain을 먼저 만든다. 고정 id는 사람만 정할 수 있고(Core.call은 user token),
// 다른 재료처럼 trial마다 같은 world가 되도록 spec에 적는다. kind 파일은 release 없이 바로 쓰이므로 놓기만 하면 된다.
export async function restoreKinds(
  ctx: RestoreContext,
  material: Material,
): Promise<Result<void>> {
  const parsed = specSchema.safeParse(
    JSON.parse(textOf(material, "spec.json")),
  );
  if (!parsed.success) {
    return err({
      code: "invalid_input",
      message:
        "kinds: spec.json needs {project, domain: {id, name, title, purpose}}",
    });
  }
  const spec = parsed.data;
  const project = ctx.world.projects[spec.project];
  if (project === undefined) {
    return err({
      code: "not_found",
      message: `kinds: project ${spec.project} is not restored`,
    });
  }
  const { core } = ctx;
  // domain보다 먼저 놓는다. 만든 뒤에 쓰면 core가 이미 kind 파일 없음으로 읽은 것이 최대 2초 남는다.
  const path = domainKindsFile(core.run.home, spec.domain.id);
  await mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  await writeFile(path, textOf(material, "kinds.yaml"));
  await core.call(domainCreate, {
    ...spec.domain,
    owner: { kind: "project", id: project },
  });
  return ok(undefined);
}
