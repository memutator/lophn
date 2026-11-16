// 폰이 받는 앱 backend file(`apps/phone_file`). 그 release의 `phone/backend.json`이 적은 file만 준다.
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type PhoneBackendManifest,
  phoneBackendManifestSchema,
} from "../../../protocol/apps/phone-backend.ts";
import type { appPhoneFile } from "../../../protocol/apps/phone.ts";
import type { Sql } from "../../../protocol/server/mod.ts";
import { bytesFileStream, type FileStreamHandler } from "../../server/mod.ts";
import { loadActiveDeclaration } from "../releases/store.ts";
import type { ScreenFileDeps } from "../screens/mod.ts";
import { serveFileUnder } from "../screens/mod.ts";

type PhoneFileInput = ReturnType<typeof appPhoneFile.input.parse>;

const MANIFEST_MAX_BYTES = 64 * 1024;
// 폰 package 안 file 하나의 상한이다(backend.js는 `PHONE_BACKEND_MAX_BYTES`, migration은 SQL 글).
const FILE_MAX_BYTES = 8 * 1024 * 1024;

const notFound = () =>
  err({ code: "not_found" as const, message: "file not found" });

// bundle 사본의 `phone/backend.json`. 없거나 schema에 맞지 않으면 null이다. `phone/`이 bundle 밖을 가리키는
// symlink여도 serveFileUnder가 없는 file로 본다.
export async function readBackendManifest(
  deps: Omit<ScreenFileDeps, "maxBytes">,
  app: string,
  release: string,
): Promise<PhoneBackendManifest | null> {
  const bundle = deps.bundles.dir({
    mode: "live",
    app: app as never,
    release: release as never,
  });
  if (!bundle.ok) return null;
  const root = await deps.realPath(bundle.value);
  if (root === null) return null;
  const served = await serveFileUnder(
    { ...deps, maxBytes: MANIFEST_MAX_BYTES },
    `${root}/phone`,
    "backend.json",
  );
  if (!served.ok) return null;
  try {
    const parsed = phoneBackendManifestSchema.safeParse(
      JSON.parse(new TextDecoder().decode(served.value.bytes)),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// 그 앱의 활성 release가 아니거나 manifest가 적지 않은 path는 없는 file과 같은 not_found다.
export async function readPhoneFile(
  deps: Omit<ScreenFileDeps, "maxBytes">,
  sql: Pick<Sql, "get" | "all">,
  input: PhoneFileInput,
): Promise<Result<{ bytes: Uint8Array }>> {
  const active = loadActiveDeclaration(sql, input.app);
  if (!active.ok) return active;
  if (active.value === null || active.value.release.id !== input.release) {
    return notFound();
  }
  const manifest = await readBackendManifest(deps, input.app, input.release);
  if (manifest === null) return notFound();
  const listed = [
    "phone/backend.js",
    "phone/backend.json",
    ...manifest.migrations.map((step) => step.file),
  ];
  if (!listed.includes(input.path)) return notFound();
  const bundle = deps.bundles.dir({
    mode: "live",
    app: input.app,
    release: input.release,
  });
  if (!bundle.ok) return bundle;
  const root = await deps.realPath(bundle.value);
  if (root === null) return notFound();
  const slash = input.path.lastIndexOf("/");
  const served = await serveFileUnder(
    { ...deps, maxBytes: FILE_MAX_BYTES },
    `${root}/${input.path.slice(0, slash)}`,
    input.path.slice(slash + 1),
  );
  return served.ok ? ok({ bytes: served.value.bytes }) : served;
}

// `app.phone_file`. 폰(사람)만 부른다.
export function phoneFileStream(
  deps: Omit<ScreenFileDeps, "maxBytes">,
  sql: Pick<Sql, "get" | "all">,
): FileStreamHandler {
  return async (_ctx, input) => {
    const read = await readPhoneFile(deps, sql, input as PhoneFileInput);
    return read.ok
      ? ok(bytesFileStream(read.value.bytes, "application/octet-stream"))
      : read;
  };
}
