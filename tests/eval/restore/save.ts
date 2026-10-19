import { err, ok, type Result } from "../../../packages/base/mod.ts";
import { releasesGetRecord } from "../../../packages/protocol/apps/activation/activation.ts";
import { appGet, appList } from "../../../packages/protocol/apps/mod.ts";
import type { Core } from "../../support/core/mod.ts";
import type {
  MaterialKind,
  MaterialManifest,
  Scenario,
  SentCall,
  TrialRecord,
  WorldIds,
} from "../types.ts";
import { gitBytes } from "./git.ts";
import {
  loadMaterial,
  type Material,
  type MaterialFile,
  MATERIALS_ROOT,
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

// 작업 트리가 아니라 활성 release의 commit에서 읽는다. 앱 처리 중 만든 untracked file이나 `.lophn/`(이 장치의
// 절대 경로가 든 import map)가 재료에 들어가면 hash가 장치마다 달라진다.
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

async function saveCall(deps: Deps, appName: string): Promise<Result<Saved>> {
  // lophn이 trial 안에서 만든 앱은 world에 없어 이름으로 찾는다.
  const { apps } = await deps.core.call(appList, {});
  const app = apps.find((item) => item.name === appName);
  if (app === undefined) {
    return err({ code: "not_found", message: `app ${appName} not found` });
  }
  const sent = deps.trial.sessions.flatMap((session) => session.sent_calls)
    .find((item: SentCall) =>
      item.receiver?.role === "app_engineer" &&
      item.receiver.app === app.id
    );
  if (sent === undefined) {
    return err({
      code: "not_found",
      message: `no call to the App Engineer of ${appName}`,
    });
  }
  return ok({
    kind: "call",
    ids: { [appName]: app.id },
    files: [
      await appFile(deps.core, app.id),
      {
        path: "call.json",
        bytes: json({
          to: { role: "app_engineer", place: { app: appName } },
          reply: sent.reply,
          body: sent.body,
        }),
      },
    ],
  });
}

async function nextN(root: string, name: string): Promise<number> {
  let max = 0;
  try {
    for await (const entry of Deno.readDir(`${root}/${name}`)) {
      if (/^\d+$/.test(entry.name)) max = Math.max(max, Number(entry.name));
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  return max + 1;
}

// parent는 저장하는 app id가 든 재료(둘 이상이면 n이 큰 것), needs는 나머지 가운데 켜진 앱과 package다.
function relations(
  materials: Material[],
  ids: Record<string, string>,
): Pick<MaterialManifest, "needs" | "parent"> {
  const saved = new Set(Object.values(ids));
  const owners = materials.filter((item) =>
    Object.values(item.manifest.ids).some((id) => saved.has(id))
  ).sort((a, b) => splitRef(a.ref).n - splitRef(b.ref).n);
  const parent = owners.at(-1)?.ref ?? null;
  return {
    parent,
    needs: materials.filter((item) =>
      item.ref !== parent &&
      (item.manifest.kind === "active_app" || item.manifest.kind === "package")
    ).map((item) => item.ref),
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
    const saved = spec.kind === "active_app"
      ? await saveActiveApp(deps, spec.app)
      : await saveCall(deps, spec.app);
    if (!saved.ok) return saved;
    const n = await nextN(root, name);
    const result = await writeMaterial(root, name, n, {
      kind: saved.value.kind,
      ids: saved.value.ids,
      ...relations(materials, saved.value.ids),
      produced_by: from,
    }, saved.value.files);
    if (!result.ok) return result;
    written.push({ name, n });
  }
  return ok(written);
}
