// 폰에 내려주는 remote 화면 bundle(renderer build의 `dist/remote`). 설치본은 `platform/remote-ui`에 두고
// (tools/package/main.ts) 개발은 renderer의 dist를 바로 쓴다. 내장 skill처럼 이 source의 자리에서 찾는다.
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ok, type Result } from "../../base/mod.ts";
import type { FileStreamHandler } from "../server/mod.ts";

// 설치본은 platform/, 개발은 저장소 root다.
const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const REMOTE_UI_DIRS = [
  join(ROOT, "remote-ui"),
  join(ROOT, "packages", "shell", "renderer", "dist", "remote"),
];

type ManifestFile = { path: string; hash: string; size: number };
type RemoteUi = {
  dir: string;
  manifest: { hash: string; files: ManifestFile[] };
};

const sha256 = (data: Uint8Array | string) =>
  createHash("sha256").update(data).digest("hex");

// 일반 file만 담는다. symlink는 따라가지 않는다(serve도 폴더 밖을 가리키는 것은 내주지 않는다).
async function walk(dir: string, prefix: string, out: ManifestFile[]) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      await walk(join(dir, entry.name), path, out);
    } else if (entry.isFile()) {
      const bytes = await readFile(join(dir, entry.name));
      out.push({ path, hash: sha256(bytes), size: bytes.byteLength });
    }
  }
}

// 앞 자리부터 처음 있는 bundle의 manifest다. 어디에도 없으면 undefined다.
export async function loadRemoteUi(
  dirs: readonly string[] = REMOTE_UI_DIRS,
): Promise<RemoteUi | undefined> {
  for (const dir of dirs) {
    const files: ManifestFile[] = [];
    try {
      await walk(dir, "", files);
    } catch {
      continue;
    }
    if (files.length === 0) continue;
    files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const hash = sha256(
      files.map((file) => `${file.path} ${file.hash}\n`).join(""),
    );
    return { dir, manifest: { hash, files } };
  }
  return undefined;
}

// `remote_ui.file`. media type 형식은 `type/subtype`만 받으므로 매개변수(charset)는 뗀다.
export function remoteUiFileStream(
  serve: (
    path: string,
  ) => Promise<Result<{ bytes: Uint8Array; contentType: string }>>,
): FileStreamHandler {
  return async (_ctx, input) => {
    const served = await serve((input as { path: string }).path);
    if (!served.ok) return served;
    const { bytes, contentType } = served.value;
    return ok({
      contentType: contentType.split(";")[0].trim(),
      length: bytes.byteLength,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
    });
  };
}
