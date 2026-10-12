// doctor의 무거운 검사. SDK 같은 version의 hash
// 차이, 실행 자격 보관의 권한, grant 위험, log의 미가공 key 패턴을 데이터 root에서
// 읽고 원문 없이 관측만 돌려준다. 결과에는 secret·token·경로·문서 원문이 없다.

import type {
  CredentialPermissionObservation,
  DoctorObservation,
  GrantRiskObservation,
  SdkHashObservation,
} from "../mod.ts";

const HASH = /^[0-9a-f]{64}$/;
const NAME = /^[A-Za-z0-9._@/-]{1,200}$/;
const VERSION = /^\d+\.\d+\.\d+$/;

export type DoctorFacts = {
  credentialPermission?: CredentialPermissionObservation;
  grants?: readonly GrantRiskObservation[];
  sdk?: readonly SdkHashObservation[];
};

export type DoctorFiles = {
  // 실행 자격 보관 파일. 권한만 보고 내용은 읽지 않는다.
  credentialPath?: string;
  // grant 위험 관측 JSON. 소유 concern이 만든 사실이다.
  grantsPath?: string;
  // SDK hash 관측 JSON. bundle과 설치본의 내용 hash만 담는다.
  sdkPath?: string;
  // 운영 log 디렉터리. 미가공 key 패턴만 찾는다.
  logDirectory?: string;
};

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await Deno.readTextFile(path));
  } catch {
    return undefined;
  }
}

async function credentialMode(
  path: string | undefined,
): Promise<CredentialPermissionObservation | undefined> {
  if (!path) return undefined;
  try {
    const info = await Deno.lstat(path);
    if (!info.isFile || info.isSymlink) return undefined;
    return { mode: (info.mode ?? 0) & 0o777 };
  } catch {
    return undefined;
  }
}

function grantsOf(value: unknown): GrantRiskObservation[] {
  if (!Array.isArray(value)) return [];
  const grants: GrantRiskObservation[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const grant = item as Record<string, unknown>;
    if (typeof grant.app !== "string" || typeof grant.kind !== "string") {
      continue;
    }
    grants.push({
      app: grant.app,
      kind: grant.kind,
      file: grant.file === true,
      network: grant.network === true,
      broad: grant.broad === true,
      last_used_at: typeof grant.last_used_at === "string"
        ? grant.last_used_at
        : null,
    });
  }
  return grants;
}

function sdkOf(value: unknown): SdkHashObservation[] {
  if (!Array.isArray(value)) return [];
  const sdk: SdkHashObservation[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    if (
      typeof entry.name !== "string" || !NAME.test(entry.name) ||
      typeof entry.version !== "string" || !VERSION.test(entry.version) ||
      typeof entry.bundle_hash !== "string" ||
      !HASH.test(entry.bundle_hash) ||
      typeof entry.installed_hash !== "string" ||
      !HASH.test(entry.installed_hash)
    ) continue;
    sdk.push({
      name: entry.name,
      version: entry.version,
      bundle_hash: entry.bundle_hash,
      installed_hash: entry.installed_hash,
    });
  }
  return sdk;
}

async function logLines(directory: string | undefined): Promise<string[]> {
  if (!directory) return [];
  let entries: Deno.DirEntry[];
  try {
    entries = [];
    for await (const entry of Deno.readDir(directory)) entries.push(entry);
  } catch {
    return [];
  }
  const lines: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile || !entry.name.endsWith(".jsonl")) continue;
    let text: string;
    try {
      text = await Deno.readTextFile(`${directory}/${entry.name}`);
    } catch {
      continue;
    }
    for (const line of text.split("\n")) if (line) lines.push(line);
  }
  return lines;
}

// 데이터 root의 관측 파일을 읽어 doctor 관측을 만든다. 파일 내용은 분류로만
// 남고 반환값에 원문이 없다.
// 이 관측 파일(grants.json, sdk.json, credential 파일, logs/)은 임시 입력이다.
// apps의 grant 위험 read와 SDK hash contract가 생기면 그 read로 바꾼다.
export async function observeDoctor(
  files: DoctorFiles,
  facts: DoctorFacts = {},
): Promise<DoctorObservation> {
  const [credentialPermission, grants, sdk, lines] = await Promise.all([
    credentialMode(files.credentialPath),
    files.grantsPath
      ? readJson(files.grantsPath).then(grantsOf)
      : Promise.resolve(facts.grants ?? []),
    files.sdkPath
      ? readJson(files.sdkPath).then(sdkOf)
      : Promise.resolve(facts.sdk ?? []),
    logLines(files.logDirectory),
  ]);
  return {
    credentialPermission: credentialPermission ?? facts.credentialPermission,
    grants,
    sdk,
    logLines: lines,
  };
}
