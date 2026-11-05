// 재료는 `tests/eval/materials/<이름>/<n>/`의 `material.json`과 `files/`다. 내용 hash의 정본은 여기다.
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { err, errorCode, ok, type Result } from "../../../packages/base/mod.ts";
import { idSchema } from "../../../packages/protocol/base/mod.ts";
import type { MaterialKind, MaterialManifest } from "../types.ts";
import { contentHash } from "./hash.ts";

export const MATERIALS_ROOT = fileURLToPath(
  new URL("../materials", import.meta.url),
);

export type MaterialFile = { path: string; bytes: Uint8Array };
export type Material = {
  ref: string;
  manifest: MaterialManifest;
  files: MaterialFile[];
};

const ID_PREFIX = {
  app: "app",
  project: "prj",
  agent: "agt",
} as const satisfies Record<MaterialKind, string>;

export function splitRef(ref: string): { name: string; n: number } {
  const at = ref.lastIndexOf("@");
  const n = Number(ref.slice(at + 1));
  if (at < 1 || !Number.isInteger(n) || n < 1) {
    throw new Error(`invalid material ref: ${ref}`);
  }
  return { name: ref.slice(0, at), n };
}

async function readFiles(dir: string, prefix = ""): Promise<MaterialFile[]> {
  const found: MaterialFile[] = [];
  for (const entry of await readdir(`${dir}/${prefix}`, {
    withFileTypes: true,
  })) {
    const path = `${prefix}${entry.name}`;
    if (entry.isDirectory()) found.push(...(await readFiles(dir, `${path}/`)));
    else found.push({ path, bytes: await readFile(`${dir}/${path}`) });
  }
  return found.sort((a, b) => (a.path < b.path ? -1 : 1));
}

export async function loadMaterial(
  root: string,
  ref: string,
): Promise<Material> {
  const { name, n } = splitRef(ref);
  const dir = `${root}/${name}/${n}`;
  const manifest = JSON.parse(
    await readFile(`${dir}/material.json`, "utf8"),
  ) as MaterialManifest;
  // 오타를 일찍 잡는다.
  const prefix = ID_PREFIX[manifest.kind];
  for (const id of Object.values(manifest.ids)) idSchema(prefix).parse(id);
  return { ref, manifest, files: await readFiles(`${dir}/files`) };
}

export async function verifyMaterial(
  material: Material,
): Promise<Result<void>> {
  if ((await contentHash(material.files)) !== material.manifest.content_hash) {
    return err({
      code: "conflict",
      message: `material ${material.ref} content hash differs`,
    });
  }
  return ok(undefined);
}

// needs를 깊이 우선으로 따라 중복 없이 되살릴 순서로 늘어놓는다.
export async function orderMaterials(
  root: string,
  refs: string[],
): Promise<Result<Material[]>> {
  const done = new Map<string, Material>();
  const visiting = new Set<string>();
  async function visit(ref: string): Promise<Result<void>> {
    if (done.has(ref)) return ok(undefined);
    if (visiting.has(ref)) {
      return err({
        code: "invalid_input",
        message: `material cycle at ${ref}`,
      });
    }
    visiting.add(ref);
    const material = await loadMaterial(root, ref);
    for (const need of material.manifest.needs) {
      const result = await visit(need);
      if (!result.ok) return result;
    }
    visiting.delete(ref);
    done.set(ref, material);
    return ok(undefined);
  }
  for (const ref of refs) {
    const result = await visit(ref);
    if (!result.ok) return result;
  }
  return ok([...done.values()]);
}

export function textOf(material: Material, path: string): string {
  const file = material.files.find((item) => item.path === path);
  if (file === undefined) {
    throw new Error(`material ${material.ref} has no ${path}`);
  }
  return new TextDecoder().decode(file.bytes);
}
