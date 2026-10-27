import { projectApi } from "../../../packages/protocol/projects/mod.ts";
import type { Id } from "../../../packages/protocol/base/mod.ts";
import type { SetupContext } from "../types.ts";
import { type Material, textOf } from "./manifest.ts";

// `files/<name>/`를 run의 work 아래로 복사해 그 폴더로 project를 등록한다.
export async function restoreProjects(
  ctx: SetupContext,
  material: Material,
): Promise<void> {
  const { core } = ctx;
  const projects = JSON.parse(textOf(material, "projects.json")) as {
    name: string;
    title: string;
    purpose: string;
  }[];
  for (const { name, title, purpose } of projects) {
    const folder = `${core.run.work}/${name}`;
    await Deno.mkdir(folder, { recursive: true });
    for (const file of material.files) {
      if (!file.path.startsWith(`${name}/`)) continue;
      const target = `${core.run.work}/${file.path}`;
      await Deno.mkdir(target.slice(0, target.lastIndexOf("/")), {
        recursive: true,
      });
      await Deno.writeFile(target, file.bytes);
    }
    const id = material.manifest.ids[name] as Id<"prj">;
    await core.call(projectApi.register, {
      id,
      name,
      title,
      purpose,
      folders: [{ path: folder, description: "", subfolders: [] }],
    });
    ctx.world.projects[name] = id;
    ctx.world.folders[name] = folder;
  }
}
