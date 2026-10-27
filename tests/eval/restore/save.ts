import { readdir } from "node:fs/promises";
import { err, errorCode, ok, type Result } from "../../../packages/base/mod.ts";
import { releasesGetRecord } from "../../../packages/protocol/apps/activation/activation.ts";
import { appGet } from "../../../packages/protocol/apps/mod.ts";
import type { Core } from "../../support/core/mod.ts";
import type {
  MaterialKind,
  MaterialManifest,
  Scenario,
  TrialRecord,
  WorldIds,
} from "../types.ts";
import { gitBytes } from "./git.ts";
import {
  loadMaterial,
  MATERIALS_ROOT,
  type Material,
  type MaterialFile,
  splitRef,
  writeMaterial,
} from "./manifest.ts";

type Deps = {
  core: Core;
  world: WorldIds;
  refs: string[];
  trial: TrialRecord;
  root?: string;
};
type Saved = {
  kind: MaterialKind;
  ids: Record<string, string>;
  files: MaterialFile[];
};

const json = (value: unknown): MaterialFile["bytes"] =>
  new TextEncoder().encode(JSON.stringify(value, null, 2) + "\n");

async function appFile(core: Core, app: string) {
  const { slug, name, description } = (await core.call(appGet, { app })).app;
  return { path: "app.json", bytes: json({ slug, name, description }) };
}

// 작업 트리가 아니라 활성 release의 commit에서 읽는다. 앱 처리 중 만든 untracked file이나 `.lophn/`(SDK 사본 같은
// 파생물)가 재료에 들어가면 hash가 장치마다 달라진다.
async function saveActiveApp(
  deps: Deps,
  appName: string,
): Promise<Result<Saved>> {
  const { core } = deps;
  const id = deps.world.apps[appName];
  if (id === undefined) {
    return err({ code: "invalid_input", message: `app ${appName} not found` });
  }
  const { app } = await core.call(appGet, { app: id });
  if (app.source_path === null || app.active_release === null) {
    return err({
      code: "invalid_input",
      message: `app ${appName} is not active`,
    });
  }
  const { release } = await core.call(releasesGetRecord, {
    release: app.active_release,
  });
  if (release === null) {
    return err({
      code: "not_found",
      message: `release ${app.active_release} not found`,
    });
  }
  const commit = release.code_commit;
  const listed = new TextDecoder().decode(
    await gitBytes(
      app.source_path,
      "ls-tree",
      "-r",
      "-z",
      "--name-only",
      commit,
    ),
  );
  const files: MaterialFile[] = [await appFile(core, id)];
  for (const path of listed.split("\0").filter((item) => item !== "")) {
    files.push({
      path: `source/${path}.tmpl`,
      bytes: await gitBytes(
        app.source_path,
        "cat-file",
        "blob",
        `${commit}:${path}`,
      ),
    });
  }
  return ok({ kind: "active_app", ids: { [app.name]: id }, files });
}

async function nextN(root: string, name: string): Promise<number> {
  let max = 0;
  try {
    for (const entry of await readdir(`${root}/${name}`, {
      withFileTypes: true,
    })) {
      if (/^\d+$/.test(entry.name)) max = Math.max(max, Number(entry.name));
    }
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
  return max + 1;
}

// parent는 저장하는 app id가 든 재료(둘 이상이면 n이 큰 것), needs는 parent의 needs와 나머지 가운데 켜진 앱과 package다.
// 자식은 parent를 되살리지 않으므로 parent가 기대던 재료를 자식이 직접 이어야 혼자 풀 수 있다.
export function relations(
  materials: Material[],
  ids: Record<string, string>,
): Pick<MaterialManifest, "needs" | "parent"> {
  const saved = new Set(Object.values(ids));
  const owners = materials
    .filter((item) =>
      Object.values(item.manifest.ids).some((id) => saved.has(id)),
    )
    .sort((a, b) => splitRef(a.ref).n - splitRef(b.ref).n);
  const top = owners.at(-1);
  const parent = top?.ref ?? null;
  const others = materials
    .filter(
      (item) =>
        item.ref !== parent &&
        (item.manifest.kind === "active_app" ||
          item.manifest.kind === "package"),
    )
    .map((item) => item.ref);
  return {
    parent,
    needs: [...new Set([...(top?.manifest.needs ?? []), ...others])],
  };
}

export async function saveMaterials(
  deps: Deps,
  save: NonNullable<Scenario["save"]>,
  from: { scenario: string; trial: number; run: string },
): Promise<Result<{ name: string; n: number }[]>> {
  const root = deps.root ?? MATERIALS_ROOT;
  const materials = await Promise.all(
    deps.refs.map((ref) => loadMaterial(root, ref)),
  );
  const written: { name: string; n: number }[] = [];
  for (const [name, spec] of Object.entries(save)) {
    const saved = await saveActiveApp(deps, spec.app);
    if (!saved.ok) return saved;
    const n = await nextN(root, name);
    const result = await writeMaterial(
      root,
      name,
      n,
      {
        kind: saved.value.kind,
        ids: saved.value.ids,
        ...relations(materials, saved.value.ids),
        produced_by: from,
      },
      saved.value.files,
    );
    if (!result.ok) return result;
    written.push({ name, n });
  }
  return ok(written);
}
