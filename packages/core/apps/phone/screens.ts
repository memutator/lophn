import { sep } from "node:path";
import { ok, type Result } from "../../../base/mod.ts";
import type { appPhoneScreens } from "../../../protocol/apps/phone.ts";
import { phoneManifestSchema } from "../../../protocol/apps/phone-screen.ts";
import type { Sql } from "../../../protocol/server/mod.ts";
import type { AppToolTarget } from "../../../protocol/apps/calls/mod.ts";
import { validateDeclaration } from "../declaration/mod.ts";
import type { ScreenDeclaration } from "../declaration/mod.ts";
import { loadApps } from "../registration/mod.ts";
import { DECLARATION_COPY_NAME } from "../releases/mod.ts";
import { loadActiveDeclaration } from "../releases/store.ts";
import type { ScreenFileDeps } from "../screens/mod.ts";
import { serveFileUnder } from "../screens/mod.ts";
import { readBackendManifest } from "./files.ts";

type PhoneScreensOutput = ReturnType<typeof appPhoneScreens.output.parse>;
type PhoneScreen = PhoneScreensOutput["screens"][number];
type PhonePreview = PhoneScreensOutput["previews"][number];

export type PhoneScreensDeps = Omit<ScreenFileDeps, "maxBytes"> & {
  /** 그 앱의 live process가 이 release로 ready이고 요청을 받는가. 관측을 못 하면 false다. */
  running(app: string, release: string): Promise<boolean>;
  /** 폰에서 도는 앱의 backend manifest를 읽지 못해 그 앱을 뺐다는 log 한 줄. */
  warn(message: string): void;
  /** 그 앱의 preview가 ready일 때만 그 값이다. 없거나 관측을 못 하면 null이다. */
  preview(app: string): Promise<{
    release: string | null;
    bundle_hash: string;
    process_nonce: string;
  } | null>;
};

const MANIFEST_MAX_BYTES = 64 * 1024;
const DECLARATION_MAX_BYTES = 1024 * 1024;

// bundle 사본의 `screens/<key>/phone.json`. 화면 폴더가 `screens/` 밖(`..`, 밖을 가리키는 symlink)이면 없는 것이다:
// key는 앱 코드가 정하는 값이다.
async function readManifest(
  deps: PhoneScreensDeps,
  target: AppToolTarget,
  key: string,
) {
  const bundle = deps.bundles.dir(target);
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

// preview bundle 사본의 선언. 선언을 읽지 못하면 그 preview는 화면이 없는 것이다.
async function readPreviewDeclaration(
  deps: PhoneScreensDeps,
  target: AppToolTarget,
  app: string,
) {
  const bundle = deps.bundles.dir(target);
  if (!bundle.ok) return null;
  const root = await deps.realPath(bundle.value);
  if (root === null) return null;
  const served = await serveFileUnder(
    { ...deps, maxBytes: DECLARATION_MAX_BYTES },
    root,
    DECLARATION_COPY_NAME,
  );
  if (!served.ok) return null;
  try {
    const declaration = validateDeclaration(
      JSON.parse(new TextDecoder().decode(served.value.bytes)),
      { app },
    );
    return declaration.ok ? declaration.value : null;
  } catch {
    return null;
  }
}

const isPhoneScreen = (screen: ScreenDeclaration) =>
  screen.places.length === 1 && screen.places[0] === "phone";

// ready인 preview 하나의 phone 화면. 화면은 live와 같은 규칙(manifest가 없거나 틀리면 뺀다)이고, 화면이 하나도
// 없는 preview는 싣지 않는다. preview는 active release와 무관해서 release가 없는 앱도 싣는다.
async function readPreview(
  deps: PhoneScreensDeps,
  app: { id: string; name: string },
): Promise<PhonePreview | null> {
  const preview = await deps.preview(app.id);
  if (preview === null) return null;
  const target = {
    mode: "preview",
    app: app.id as never,
    process_nonce: preview.process_nonce as never,
  } as const;
  const declaration = await readPreviewDeclaration(deps, target, app.id);
  if (declaration === null) return null;
  const screens: PhonePreview["screens"] = [];
  for (const screen of declaration.screens.filter(isPhoneScreen)) {
    const manifest = await readManifest(deps, target, screen.key);
    if (manifest === null) continue;
    screens.push({
      screen: screen.key,
      label: screen.label,
      ...(screen.params ? { params: screen.params } : {}),
      manifest,
    });
  }
  if (screens.length === 0) return null;
  return {
    app: app.id as never,
    app_name: app.name,
    icon: declaration.icon ?? null,
    release: preview.release as never,
    bundle_hash: preview.bundle_hash as never,
    process_nonce: preview.process_nonce as never,
    screens,
  };
}

// 보관하지 않은 앱 가운데 active release가 있는 앱의 `phone` 화면을 앱 id 순으로 싣는다. manifest가 없거나 틀린 화면은
// 뺀다: 준비 단계가 phone.json을 짓고 검사해서 정상 앱에는 없고, 하나가 틀려도 나머지 앱은 폰에 가야 한다.
export async function readPhoneScreens(
  deps: PhoneScreensDeps,
  sql: Pick<Sql, "get" | "all">,
): Promise<Result<{ screens: PhoneScreen[]; previews: PhonePreview[] }>> {
  const apps = loadApps(sql, "active");
  if (!apps.ok) return apps;
  const screens: PhoneScreen[] = [];
  const previews: PhonePreview[] = [];
  for (const app of apps.value) {
    const preview = await readPreview(deps, app);
    if (preview !== null) previews.push(preview);
    const active = loadActiveDeclaration(sql, app.id);
    if (!active.ok) return active;
    if (active.value === null) continue;
    const { release, declaration } = active.value;
    const phone = declaration.screens.filter(isPhoneScreen);
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
      const manifest = await readManifest(
        deps,
        { mode: "live", app: app.id as never, release: null },
        screen.key,
      );
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
  return ok({ screens, previews });
}
