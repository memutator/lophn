import { mkdir, readFile, writeFile } from "node:fs/promises";
import { err, errorCode, ok, type Result } from "../../../packages/base/mod.ts";
import type { RegistryEntry, VersionKind, VersionRef } from "../types.ts";

// 다른 checkout(variant)의 workspace prompt. import는 지금 프로세스의 checkout 것이라 따로 읽어 넘긴다.
export type VariantTexts = {
  workspace_prompts: Record<string, string>;
};

// 경로를 받는 함수의 마지막 인자. test가 임시 폴더를 준다.
// checksRoot는 checks를 잴 checkout이다(기본 root). variant를 재도 grader는 지금 checkout 것이다.
// texts가 있으면 instruction을 import 대신 이 글로 잰다.
export type Deps = {
  root?: string;
  registryDir?: string;
  checksRoot?: string;
  texts?: VariantTexts;
};

// 이 repo의 root. tests/eval/versions/에서 세 단계 위다.
export const REPO_ROOT = new URL("../../../", import.meta.url).pathname.replace(
  /\/$/,
  "",
);
export const REGISTRY_DIR = new URL("../registry", import.meta.url).pathname;

export const TEXT_KINDS: readonly VersionKind[] = [
  "instruction",
  "skill",
  "skill-description",
  "template",
  "criterion",
  "judge",
  "cli",
];

export type Measured = {
  kind: VersionKind;
  name: string;
  hash: string;
  content?: string;
};

// 호출하는 쪽의 입력이 틀렸다. 경계에서 invalid_input으로 바뀐다.
export class InvalidInput extends Error {}

const NAME = /^[A-Za-z0-9._-]+$/;

function entryFile(dir: string, kind: VersionKind, name: string): string {
  // `.`·`..`는 이 규칙을 지나지만 폴더 밖을 가리킨다.
  if (!NAME.test(name) || name === "." || name === "..") {
    throw new InvalidInput(`invalid version name: ${name}`);
  }
  return `${dir}/${kind}/${name}.json`;
}

export async function readEntries(
  dir: string,
  kind: VersionKind,
  name: string,
): Promise<RegistryEntry[]> {
  const file = entryFile(dir, kind, name);
  try {
    return JSON.parse(await readFile(file, "utf8")) as RegistryEntry[];
  } catch (e) {
    if (errorCode(e) === "ENOENT") return [];
    throw e;
  }
}

async function append(
  dir: string,
  entries: RegistryEntry[],
  entry: RegistryEntry,
): Promise<void> {
  await mkdir(`${dir}/${entry.kind}`, { recursive: true });
  await writeFile(
    entryFile(dir, entry.kind, entry.name),
    JSON.stringify([...entries, entry], null, 2) + "\n",
  );
}

function entryOf(
  ref: VersionRef,
  hash: string,
  content: string | undefined,
): RegistryEntry {
  const entry: RegistryEntry = {
    kind: ref.kind,
    name: ref.name,
    n: ref.n,
    hash,
  };
  if (content !== undefined && TEXT_KINDS.includes(ref.kind)) {
    entry.content = content;
  }
  return entry;
}

const maxN = (entries: RegistryEntry[]) =>
  entries.reduce((max, e) => Math.max(max, e.n), 0);

// checkout에서 재서 registry가 n을 붙이는 종류(component, core, checks)용이다.
export async function resolveVersion(
  dir: string,
  measured: Measured,
): Promise<{ ref: VersionRef; created: boolean }> {
  const { kind, name } = measured;
  const entries = await readEntries(dir, kind, name);
  const found = entries.find((e) => e.hash === measured.hash);
  if (found !== undefined) {
    return { ref: { kind, name, n: found.n }, created: false };
  }
  const ref = { kind, name, n: maxN(entries) + 1 };
  await append(dir, entries, entryOf(ref, measured.hash, measured.content));
  return { ref, created: true };
}

// 작성자가 n을 정한 종류(scenario, criterion, judge, material)용이다.
export async function registerAuthored(
  dir: string,
  ref: VersionRef,
  hash: string,
  content?: string,
): Promise<Result<{ created: boolean }>> {
  try {
    const entries = await readEntries(dir, ref.kind, ref.name);
    const same = entries.find((e) => e.n === ref.n);
    if (same !== undefined) {
      if (same.hash === hash) return ok({ created: false });
      return err({
        code: "conflict",
        message: `${ref.kind}:${ref.name}@${ref.n} 내용이 바뀌었다. n을 올려라`,
      });
    }
    // 빈 n을 건너뛰어도 받는다. 시나리오 file의 n이 registry보다 앞서는 일이 흔하다.
    if (ref.n <= maxN(entries)) {
      return err({
        code: "invalid_input",
        message: `${ref.kind}:${ref.name}@${ref.n}의 n은 ${maxN(
          entries,
        )}보다 커야 한다`,
      });
    }
    await append(dir, entries, entryOf(ref, hash, content));
    return ok({ created: true });
  } catch (e) {
    if (e instanceof InvalidInput) {
      return err({ code: "invalid_input", message: e.message });
    }
    throw e;
  }
}

export async function latestEntry(
  dir: string,
  kind: VersionKind,
  name: string,
): Promise<RegistryEntry | null> {
  const entries = await readEntries(dir, kind, name);
  return entries.reduce<RegistryEntry | null>(
    (best, e) => (best === null || e.n > best.n ? e : best),
    null,
  );
}

// skill과 template은 content가 `{경로: 글}`의 JSON이다.
export function contentFiles(entry: RegistryEntry): Record<string, string> {
  if (entry.content === undefined) return {};
  if (entry.kind === "skill" || entry.kind === "template") {
    return JSON.parse(entry.content) as Record<string, string>;
  }
  return { "": entry.content };
}
