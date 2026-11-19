// Linux 설치본의 native addon(*.node)이 Ubuntu 22.04 LTS(GLIBC 2.35)보다 높은 glibc symbol을 요구하지 않는지 검사한다.
import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

/** Linux 배포본의 기준 glibc 상한(Ubuntu 22.04 LTS). */
export const MAX_LINUX_GLIBC = "2.35";

/** `readelf -V` 출력의 `.gnu.version_r` 절에서 필요한 `GLIBC_<version>` 목록을 중복 없이 뽑는다. */
export function parseGlibcVersions(readelfOutput: string): string[] {
  const versions = new Set<string>();
  let inNeeds = false;
  for (const line of readelfOutput.split(/\r?\n/)) {
    if (/^Version needs section\b/.test(line)) {
      inNeeds = true;
      continue;
    }
    if (inNeeds && /^(Version |Symbol table |Dynamic section |\S)/.test(line)) {
      if (!/^\s/.test(line) && line.trim() !== "") inNeeds = false;
    }
    if (!inNeeds) continue;
    const match = /\bName:\s+GLIBC_(\d+(?:\.\d+)+)\b/.exec(line);
    if (match?.[1] !== undefined) versions.add(match[1]);
  }
  return [...versions].sort(compareGlibcVersion);
}

/** glibc 숫자 버전을 자리별로 비교한다(`2.9` < `2.17`, `2.35` < `2.42`). */
export function compareGlibcVersion(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** `maxVersion`을 넘는 GLIBC 버전만 오름차순으로 돌려준다. */
export function exceedingGlibcVersions(
  readelfOutput: string,
  maxVersion: string = MAX_LINUX_GLIBC,
): string[] {
  return parseGlibcVersions(readelfOutput).filter(
    (version) => compareGlibcVersion(version, maxVersion) > 0,
  );
}

async function findNodeAddons(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await findNodeAddons(full)));
    } else if (entry.isFile() && entry.name.endsWith(".node")) {
      found.push(full);
    }
  }
  return found.sort();
}

async function readelfVersions(file: string): Promise<string> {
  const child = spawn("readelf", ["-V", file], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const chunks: Buffer[] = [];
  const errors: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
  const code = await new Promise<number | null>((resolve, reject) => {
    child.on("close", resolve);
    child.on("error", reject);
  });
  if (code !== 0) {
    throw new Error(
      `readelf -V ${file} failed (${code}): ${Buffer.concat(errors).toString().trim()}`,
    );
  }
  return Buffer.concat(chunks).toString();
}

/** `rootDir` 아래 모든 `*.node` 파일이 `maxVersion` 이하의 GLIBC만 요구하는지 검증한다. */
export async function verifyLinuxNativeModules(
  rootDir: string,
  maxVersion: string = MAX_LINUX_GLIBC,
): Promise<void> {
  const addons = await findNodeAddons(rootDir);
  const violations: string[] = [];
  for (const file of addons) {
    const output = await readelfVersions(file);
    const tooNew = exceedingGlibcVersions(output, maxVersion);
    if (tooNew.length > 0) {
      violations.push(
        `${file}: requires ${tooNew.map((v) => `GLIBC_${v}`).join(", ")} (max GLIBC_${maxVersion})`,
      );
    }
  }
  if (violations.length > 0) {
    throw new Error(
      `Linux native module glibc check failed:\n${violations.join("\n")}`,
    );
  }
}
