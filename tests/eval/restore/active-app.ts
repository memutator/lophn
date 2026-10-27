import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { err, ok, type Result } from "../../../packages/base/mod.ts";
import { scaffoldApp } from "../../../packages/core/apps/packages/template/scaffold.ts";
import type { Id } from "../../../packages/protocol/base/mod.ts";
import {
  approveActivation,
  deliverRelease,
  startTestApp,
  waitRunning,
} from "../../support/app/activate.ts";
import type { AppPatch } from "../../support/app/source.ts";
import type { SetupContext } from "../types.ts";
import { restoreAppProject } from "./apps.ts";
import { type Material, textOf } from "./manifest.ts";

const TMPL = ".tmpl";
const SOURCE = "source/";

// core가 `app.create`에서 깐 template을 걷고 재료의 source/ 아래 file을 얹는다. 이름 끝의 `.tmpl`만 뗀다.
// template file이 남으면 재료에 없는 file(home 화면 등)이 commit에 섞인다. `.git`과 `.lophn`만 둔다.
function materialSource(
  material: Material,
  slug: string,
  dataRoot: string,
): AppPatch {
  return async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === ".lophn") continue;
      await rm(`${dir}/${entry.name}`, { recursive: true });
    }
    for (const file of material.files) {
      if (!file.path.startsWith(SOURCE) || !file.path.endsWith(TMPL)) continue;
      const path = `${dir}/${file.path.slice(SOURCE.length, -TMPL.length)}`;
      await mkdir(path.slice(0, path.lastIndexOf("/")), {
        recursive: true,
      });
      await writeFile(path, file.bytes);
    }
    // template의 개발용 파생물(`.lophn/`, ignore)은 재료 source로 바꾼 뒤 다시 쓴다.
    const scaffolded = await scaffoldApp({
      files: [],
      dir,
      app: slug,
      dataRoot,
    });
    if (!scaffolded.ok) throw new Error(scaffolded.error.message);
  };
}

// 제품 길로 되살린다: `app.create` → 재료 source commit → 가짜 App Engineer의 release 준비·activate → 사람의 동의 → running.
export async function restoreActiveApp(
  ctx: SetupContext,
  material: Material,
): Promise<Result<void>> {
  const { core, fake } = ctx;
  const spec = JSON.parse(textOf(material, "app.json")) as {
    slug: string;
    name: string;
    description: string;
    goal?: string;
  };
  const id = material.manifest.ids[spec.name] as Id<"app">;
  try {
    fake.reset();
    // 앱 옆에 사람이 둔 보통 project다. 앱은 project에 묶이지 않는다.
    await restoreAppProject(ctx, spec.slug);
    const app = await startTestApp(core, fake, {
      id,
      name: spec.name,
      slug: spec.slug,
      description: spec.description,
      sample: false,
      patch: materialSource(material, spec.slug, core.run.home),
    });
    const { release, activated } = await deliverRelease(core, fake, app, {
      goal: spec.goal ?? "Make the first release of the app",
    });
    if (activated.status === "waiting_consent") {
      // 전제 재료를 만드는 일이라 사람의 승인은 늘 allow다.
      await approveActivation(core, app, "allow");
    } else if (activated.status === "failed") {
      throw new Error(
        `activation failed: ${activated.failure.code} ${activated.failure.summary}`,
      );
    }
    await waitRunning(core, app, release);
    ctx.world.apps[spec.name] = id;
    return ok(undefined);
  } catch (error) {
    return err({
      code: "unavailable",
      message: `active app ${spec.name} was not restored: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
  }
}
