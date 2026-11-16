import { sep } from "node:path";
import { ok, type Result } from "../../../base/mod.ts";
import type { appPhoneScreens } from "../../../protocol/apps/phone.ts";
import { phoneManifestSchema } from "../../../protocol/apps/phone-screen.ts";
import type { Sql } from "../../../protocol/server/mod.ts";
import { loadApps } from "../registration/mod.ts";
import { loadActiveDeclaration } from "../releases/store.ts";
import type { ScreenFileDeps } from "../screens/mod.ts";
import { serveFileUnder } from "../screens/mod.ts";
import { readBackendManifest } from "./files.ts";

type PhoneScreen = ReturnType<
  typeof appPhoneScreens.output.parse
>["screens"][number];

export type PhoneScreensDeps = Omit<ScreenFileDeps, "maxBytes"> & {
  /** 그 앱의 live process가 이 release로 ready이고 요청을 받는가. 관측을 못 하면 false다. */
  running(app: string, release: string): Promise<boolean>;
  /** 폰에서 도는 앱의 backend manifest를 읽지 못해 그 앱을 뺐다는 log 한 줄. */
  warn(message: string): void;
};

const MANIFEST_MAX_BYTES = 64 * 1024;

// bundle 사본의 `screens/<key>/phone.json`. 화면 폴더가 `screens/` 밖(`..`, 밖을 가리키는 symlink)이면 없는 것이다:
// key는 앱 코드가 정하는 값이다.
async function readManifest(deps: PhoneScreensDeps, app: string, key: string) {
  const bundle = deps.bundles.dir({
    mode: "live",
    app: app as never,
    release: null,
  });
  if (!bundle.ok) return null;
  const root = await deps.realPath(bundle.value);
  if (root === null) return null;
  const dir = await deps.realPath(`${root}/screens/${key}`);
  // realpath는 OS 구분자로 잇는다(Windows는 `\`).
  if (dir === null || !dir.startsWith(`${root}${sep}screens${sep}`)) {
    return null;
  }
  const served = await serveFileUnder(
    { ...deps, maxBytes: MANIFEST_MAX_BYTES },
    dir,
    "phone.json",
  );
  if (!served.ok) return null;
  try {
    const parsed = phoneManifestSchema.safeParse(
      JSON.parse(new TextDecoder().decode(served.value.bytes)),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// 보관하지 않은 앱 가운데 active release가 있는 앱의 `phone` 화면을 앱 id 순으로 싣는다. manifest가 없거나 틀린 화면은
// 뺀다: 준비 단계가 phone.json을 짓고 검사해서 정상 앱에는 없고, 하나가 틀려도 나머지 앱은 폰에 가야 한다.
export async function readPhoneScreens(
  deps: PhoneScreensDeps,
  sql: Pick<Sql, "get" | "all">,
): Promise<Result<{ screens: PhoneScreen[] }>> {
  const apps = loadApps(sql, "active");
  if (!apps.ok) return apps;
  const screens: PhoneScreen[] = [];
  for (const app of apps.value) {
    const active = loadActiveDeclaration(sql, app.id);
    if (!active.ok) return active;
    if (active.value === null) continue;
    const { release, declaration } = active.value;
    const phone = declaration.screens.filter(
      (screen) => screen.places.length === 1 && screen.places[0] === "phone",
    );
    if (phone.length === 0) continue;
    const runsOn = declaration.runs_on ?? ["computer"];
    // 폰에서 도는 앱의 backend manifest를 읽지 못하면 그 앱은 폰에 보낼 수 없다.
    const backend = runsOn.includes("phone")
      ? await readBackendManifest(deps, app.id, release.id)
      : null;
    if (runsOn.includes("phone") && backend === null) {
      deps.warn(`phone backend manifest of ${app.id} is unreadable`);
      continue;
    }
    const running = await deps.running(app.id, release.id);
    for (const screen of phone) {
      const manifest = await readManifest(deps, app.id, screen.key);
      if (manifest === null) continue;
      screens.push({
        app: app.id,
        app_name: app.name,
        icon: declaration.icon ?? null,
        screen: screen.key,
        label: screen.label,
        ...(screen.params ? { params: screen.params } : {}),
        release: release.id,
        bundle_hash: release.bundle_hash,
        manifest,
        runs_on: runsOn,
        backend,
        running,
      });
    }
  }
  return ok({ screens });
}
