// SDK tool의 공통 실행이다. catalog·show·add가 같은
// credential·입력의 결과와 거절을 공유하도록 MCP와 CLI가 이 한 흐름을 지난다.
// op마다 소유 읽기 route로만 보내고, 통로가 더한 입력
// field(query·version·apply·app)는 소유 route로 보내지 않는다.
//
// - catalog: 설치 catalog(packages.list)를 읽고 설명·API 이름 검색어로 거른다. 결과는
//   이름·최신 version·종류·한 줄 설명이다. 이름으로 찾았는데 없으면 비설치(@lophn)와
//   지원 범위 밖 개인 SDK(@me)를 구별한다.
// - show: version 목록과 고른 version의 사용 안내(version 행의 guide_hash)를 낸다.
//   안내 원문(API·type·permission·peer·예제)은 `package_version/guide` blob field 하나만 읽는 좁은 route
//   `packages.guide_body`로 읽어 `body`에 낸다(일반 `blobs/read`는 coding 연결에 열지 않는다). 읽지 못하면 body는 null이고 이유를 낸다(원문을 꾸미지 않는다).
// - add: exact version만 받는다. 범위·별칭 version, 설치 catalog에 없는 package·version은
//   거절이다. 결과는 고정 import 안내이고 `apply`일 때만 앱 source의 deno.json에 반영한다.
//   반영 결과는 changed·unchanged·conflict 셋이다. 다른 version이 이미 있으면 conflict로
//   멈추고 바꾸지 않는다(조용한 upgrade 없음).
import { err, type LophnError, ok, type Result } from "../../base/mod.ts";
import {
  appGet,
  packagesGuide,
  packagesGuideBody,
  packagesList,
  packagesVersions,
} from "../../protocol/apps/mod.ts";
import type { FlowClient } from "./document-save.ts";

// SDK op의 공통 op table이다(app-ops와 같은 패턴).
export const SDK_OP_ROUTES = {
  catalog: packagesList,
  show: packagesVersions,
  add: packagesGuide,
} as const;

export type SdkOp = keyof typeof SDK_OP_ROUTES;

export function isSdkOp(op: unknown): op is SdkOp {
  return typeof op === "string" && Object.hasOwn(SDK_OP_ROUTES, op);
}

// CLI command 이름이다.
export const SDK_OP_CLI_NAMES: Record<SdkOp, string> = {
  catalog: "sdk catalog",
  show: "sdk show",
  add: "sdk add",
};

export type SdkOpOutput = {
  summary: string;
  data: unknown;
  next: string[];
  isError?: true;
};

// 앱 source의 파일 통로다. MCP는 쓰기 권한 없이 뜨므로(mcp-server/launch.ts) 실행 entry가
// 이 port를 주입할 때만 `apply`가 된다. 없으면 apply는 실행 전 거절이다.
export type SdkSourcePort = {
  // 없는 파일은 ok(undefined)다.
  readText(path: string): Promise<Result<string | undefined, LophnError>>;
  writeText(path: string, text: string): Promise<Result<void, LophnError>>;
  // deno.json을 바꾼 뒤 개발 import map과 deno.lock을 다시 만든다.
  refreshLock(sourceDir: string): Promise<Result<void, LophnError>>;
};

export type SdkOpDeps = {
  client: Pick<FlowClient, "read">;
  surface?: "mcp" | "cli";
  source?: SdkSourcePort;
};

export const SDK_SUPPORT = {
  supported: "supported",
  // 개인 SDK(@me)는 현재 지원 범위 밖이다.
  personal: "personal_unsupported",
} as const;

type Obj = Record<string, unknown>;

function obj(value: unknown): Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Obj
    : {};
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function failure(error: LophnError, next: string[]): SdkOpOutput {
  return {
    summary: error.message,
    data: { code: error.code, details: error.details ?? {} },
    next,
    isError: true,
  };
}

function refer(deps: SdkOpDeps, op: SdkOp, note = ""): string {
  const name = deps.surface === "cli"
    ? `lophn ${SDK_OP_CLI_NAMES[op]}`
    : `lophn_sdk ${op}`;
  return note === "" ? name : `${name} ${note}`;
}

function pick(input: Obj, keys: readonly string[]): Obj {
  const out: Obj = {};
  for (const key of keys) {
    if (input[key] !== undefined) out[key] = input[key];
  }
  return out;
}

export function isPersonalSdk(name: string): boolean {
  return name.startsWith("@me/");
}

function support(name: string): string {
  return isPersonalSdk(name) ? SDK_SUPPORT.personal : SDK_SUPPORT.supported;
}

// 범위·별칭 version이다. 계약의 exact SemVer 검사보다 먼저 이유를 분명히 한다.
export function isRangeVersion(version: string): boolean {
  const core = version.split(/[-+]/)[0];
  return /^[~^<>=*]/.test(version) || /\s|\|\|/.test(version) ||
    /(^|\.)[xX*](\.|$)/.test(core) || ["latest", "next"].includes(version);
}

// SemVer 2.0.0 precedence 비교다. build metadata는 무시한다.
export function compareSemver(a: string, b: string): number {
  const split = (value: string) => {
    const [core, pre] = value.split("+")[0].split(/-(.*)/s);
    return { core: core.split(".").map(Number), pre };
  };
  const x = split(a);
  const y = split(b);
  for (let i = 0; i < 3; i++) {
    const d = (x.core[i] ?? 0) - (y.core[i] ?? 0);
    if (d !== 0) return d;
  }
  if (x.pre === undefined || y.pre === undefined) {
    return x.pre === y.pre ? 0 : x.pre === undefined ? 1 : -1;
  }
  const xp = x.pre.split(".");
  const yp = y.pre.split(".");
  for (let i = 0; i < Math.max(xp.length, yp.length); i++) {
    if (xp[i] === undefined) return -1;
    if (yp[i] === undefined) return 1;
    const xn = /^\d+$/.test(xp[i]);
    const yn = /^\d+$/.test(yp[i]);
    if (xn && yn) {
      const d = Number(xp[i]) - Number(yp[i]);
      if (d !== 0) return d;
    } else if (xn !== yn) {
      return xn ? -1 : 1;
    } else if (xp[i] !== yp[i]) {
      return xp[i] < yp[i] ? -1 : 1;
    }
  }
  return 0;
}

function versionNames(versions: unknown): string[] {
  return (Array.isArray(versions) ? versions : [])
    .map((item) => str(obj(item).version))
    .filter((value): value is string => value !== undefined)
    .sort((a, b) => compareSemver(b, a));
}

function catalogEntry(pkg: Obj) {
  const name = str(pkg.name) ?? "";
  return {
    name,
    latest_version: versionNames(pkg.versions)[0] ?? null,
    kind: pkg.kind,
    description: pkg.description,
    support: support(name),
  };
}

function matches(pkg: Obj, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return [pkg.name, pkg.description].some((value) =>
    typeof value === "string" && value.toLowerCase().includes(needle)
  );
}

// 설치 catalog에서 찾지 못한 이름의 판정이다: 개인 SDK는 지원 범위 밖, 그 밖은 비설치.
function absence(name: string) {
  return isPersonalSdk(name)
    ? {
      name,
      status: SDK_SUPPORT.personal,
      reason: "개인 SDK(@me)는 현재 지원 범위 밖이다",
    }
    : {
      name,
      status: "not_installed",
      reason: "설치 catalog에 없는 package다",
    };
}

function absentFailure(
  deps: SdkOpDeps,
  name: string,
): SdkOpOutput {
  const found = absence(name);
  return failure({
    code: "not_found",
    message: `${name}: ${found.reason}`,
    details: found,
  }, [refer(deps, "catalog", "로 설치된 package를 찾는다")]);
}

async function catalogPackages(
  input: Obj,
  deps: SdkOpDeps,
): Promise<SdkOpOutput> {
  const read = await deps.client.read(
    packagesList,
    pick(input, ["name", "cursor", "limit"]),
  );
  if (!read.ok) return failure(read.error, [refer(deps, "catalog")]);
  const value = obj(read.value);
  const all = (Array.isArray(value.packages) ? value.packages : []).map(obj);
  const query = str(input.query);
  const found = query === undefined
    ? all
    : all.filter((pkg) => matches(pkg, query));
  const packages = found.map(catalogEntry);
  const name = str(input.name);
  const lookup = name !== undefined && packages.length === 0
    ? absence(name)
    : undefined;
  const nextCursor = value.next_cursor ?? null;
  return {
    summary: lookup !== undefined
      ? `${name}: ${lookup.reason}`
      : `catalog: SDK ${packages.length}개${
        nextCursor === null ? "" : ", 더 있음"
      }`,
    data: {
      packages,
      ...(query === undefined ? {} : { query }),
      ...(lookup === undefined ? {} : { lookup }),
      next_cursor: nextCursor,
    },
    next: [
      refer(deps, "show", "로 version과 사용 안내를 읽는다"),
      refer(deps, "add", "로 exact version을 앱에 더한다"),
    ],
  };
}

// 이름의 version 목록이다. 없는 package는 비설치·개인 SDK로 구별한 거절이다.
async function readVersions(
  name: string,
  deps: SdkOpDeps,
  nextOp: SdkOp,
): Promise<
  Result<{ names: string[]; guideHashes: Record<string, string> }, SdkOpOutput>
> {
  const read = await deps.client.read(packagesVersions, { name });
  if (!read.ok) {
    return err(
      read.error.code === "not_found"
        ? absentFailure(deps, name)
        : failure(read.error, [refer(deps, nextOp)]),
    );
  }
  const rows = obj(read.value).versions;
  const versions = versionNames(rows);
  if (versions.length === 0) return err(absentFailure(deps, name));
  // 안내 hash는 version 행이 이미 싣는다. 서버에 따로 서빙하지 않는 worker route를 거치지 않는다.
  const guideHashes: Record<string, string> = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const version = str(obj(row).version);
    const hash = str(obj(row).guide_hash);
    if (version !== undefined && hash !== undefined) {
      guideHashes[version] = hash;
    }
  }
  return ok({ names: versions, guideHashes });
}

function versionNotInstalled(
  deps: SdkOpDeps,
  name: string,
  version: string,
  installed: string[],
): SdkOpOutput {
  return failure({
    code: "not_found",
    message: `${name}@${version}은 설치된 version이 아니다`,
    details: { name, version, status: "version_not_installed", installed },
  }, [refer(deps, "show", "로 설치된 exact version을 고른다")]);
}

// 안내 원문 한 번의 읽기 상한이다. 더 길면 잘렸다고 표시한다(출력 예산).
export const GUIDE_BODY_LIMIT_BYTES = 16 * 1024;

type GuideBody = {
  body: string | null;
  body_truncated?: boolean;
  body_unavailable?: string;
};

// 안내 blob(`package_version/guide`)을 읽는다. 권한 밖·미등록·보존 byte 없음은 모두 "읽을 수 없음"이고
// 이유만 다르게 낸다. 어떤 경우에도 본문을 만들어 내지 않는다.
async function readGuideBody(
  deps: SdkOpDeps,
  name: string,
  version: string,
): Promise<GuideBody> {
  const read = await deps.client.read(packagesGuideBody, {
    name,
    version,
    offset_bytes: 0,
    length_bytes: GUIDE_BODY_LIMIT_BYTES,
  });
  if (!read.ok) {
    return {
      body: null,
      body_unavailable: read.error.code === "unavailable"
        ? "안내 원문을 지금 읽지 못했다"
        : "안내 원문을 이 연결로 읽을 수 없다",
    };
  }
  const result = obj(read.value);
  if (result.status !== "available" || typeof result.bytes !== "string") {
    return {
      body: null,
      body_unavailable: `안내 원문 byte를 읽지 못했다(${
        str(result.reason) ?? "unavailable"
      })`,
    };
  }
  try {
    const bytes = Uint8Array.from(atob(result.bytes), (c) => c.charCodeAt(0));
    return {
      body: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      body_truncated: result.truncated === true,
    };
  } catch {
    return { body: null, body_unavailable: "안내 원문이 UTF-8 글이 아니다" };
  }
}

async function showPackage(
  input: Obj,
  deps: SdkOpDeps,
): Promise<SdkOpOutput> {
  const name = str(input.name) ?? "";
  const versions = await readVersions(name, deps, "catalog");
  if (!versions.ok) return versions.error;
  const asked = str(input.version);
  if (asked !== undefined && !versions.value.names.includes(asked)) {
    return versionNotInstalled(deps, name, asked, versions.value.names);
  }
  const version = asked ?? versions.value.names[0];
  return {
    summary:
      `SDK ${name}: version ${versions.value.names.length}개, ${version} 안내`,
    data: {
      name,
      support: support(name),
      versions: versions.value.names,
      latest_version: versions.value.names[0],
      version,
      guide: {
        guide_hash: versions.value.guideHashes[version] ?? null,
        // API·type·permission·peer·예제는 안내 원문에 있다.
        ...await readGuideBody(deps, name, version),
      },
    },
    next: [refer(deps, "add", "로 이 exact version을 앱에 더한다")],
  };
}

export const SDK_IMPORT_PREFIX = "lophn-sdk:";

// 고정 import 안내다. bundle 준비(apps/releases/bundle/import-map.ts)가 같은 key를 bundle 안
// `sdk/<name>/<version>/`로 잠근다.
export function sdkImportEntry(name: string, version: string) {
  return {
    key: `${SDK_IMPORT_PREFIX}${name}@${version}`,
    value: `./sdk/${name}/${version}/`,
  };
}

// import key가 가리키는 SDK 이름·version이다. `lophn-sdk:<name>@<version>[/<subpath>]`와
// 맨 이름(`<name>`, `<name>/…`)을 본다.
function keyTarget(
  key: string,
  name: string,
): { version: string | undefined } | undefined {
  if (key.startsWith(`${SDK_IMPORT_PREFIX}${name}@`)) {
    const rest = key.slice(`${SDK_IMPORT_PREFIX}${name}@`.length);
    return { version: rest.split("/")[0] };
  }
  if (key === name || key.startsWith(`${name}/`)) return { version: undefined };
  return undefined;
}

export type ImportMapOutcome =
  | { outcome: "changed"; text: string; entry: { key: string; value: string } }
  | { outcome: "unchanged"; entry: { key: string; value: string } }
  | {
    outcome: "conflict";
    reason:
      | "missing_config"
      | "invalid_config"
      | "other_version"
      | "different_target";
    existing: Record<string, string>;
    entry: { key: string; value: string };
  };

// deno.json 원문에 SDK import 하나를 더한 결과다. 같은 항목이면 unchanged, 같은 이름의 다른
// version·다른 대상이 있으면 conflict이고 원문을 바꾸지 않는다.
export function planImportMap(
  text: string | undefined,
  name: string,
  version: string,
): ImportMapOutcome {
  const entry = sdkImportEntry(name, version);
  if (text === undefined) {
    return {
      outcome: "conflict",
      reason: "missing_config",
      existing: {},
      entry,
    };
  }
  let config: unknown;
  try {
    config = JSON.parse(text);
  } catch {
    return {
      outcome: "conflict",
      reason: "invalid_config",
      existing: {},
      entry,
    };
  }
  const root = obj(config);
  if (
    typeof config !== "object" || config === null || Array.isArray(config) ||
    (root.imports !== undefined &&
      (typeof root.imports !== "object" || root.imports === null ||
        Array.isArray(root.imports)))
  ) {
    return {
      outcome: "conflict",
      reason: "invalid_config",
      existing: {},
      entry,
    };
  }
  const imports = obj(root.imports);
  const existing: Record<string, string> = {};
  for (const [key, value] of Object.entries(imports)) {
    if (keyTarget(key, name) !== undefined) existing[key] = String(value);
  }
  if (imports[entry.key] === entry.value) {
    return { outcome: "unchanged", entry };
  }
  for (const key of Object.keys(existing)) {
    const target = keyTarget(key, name);
    if (target?.version !== undefined && target.version !== version) {
      return { outcome: "conflict", reason: "other_version", existing, entry };
    }
  }
  if (Object.keys(existing).length > 0) {
    return { outcome: "conflict", reason: "different_target", existing, entry };
  }
  const next = { ...root, imports: { ...imports, [entry.key]: entry.value } };
  return {
    outcome: "changed",
    text: `${JSON.stringify(next, null, 2)}\n`,
    entry,
  };
}

const CONFLICT_REASONS: Record<
  Extract<ImportMapOutcome, { outcome: "conflict" }>["reason"],
  string
> = {
  missing_config: "앱 source에 deno.json이 없다",
  invalid_config: "deno.json을 JSON 객체로 읽지 못했다",
  other_version: "같은 SDK의 다른 version이 이미 있다. 조용히 바꾸지 않는다",
  different_target: "같은 SDK 이름의 import가 다른 대상을 가리킨다",
};

async function applyToSource(
  input: Obj,
  deps: SdkOpDeps,
  name: string,
  version: string,
): Promise<Result<Obj, SdkOpOutput>> {
  const app = str(input.app);
  if (app === undefined) {
    return err(failure({
      code: "invalid_input",
      message: "apply에는 반영할 앱(app)이 필요하다",
    }, [refer(deps, "add", "에 app을 넣거나 apply 없이 안내만 받는다")]));
  }
  if (deps.source === undefined) {
    return err(failure({
      code: "unavailable",
      message:
        "이 통로에서는 앱 source에 쓸 수 없다. 고정 import 안내로 직접 반영한다",
      details: { apply: "unavailable" },
    }, [
      refer(deps, "add", "를 apply 없이 불러 고정 import 안내를 받는다"),
      `lophn sdk add --apply --app ${app}로 source에 반영한다`,
    ]));
  }
  const read = await deps.client.read(appGet, { app });
  if (!read.ok) {
    return err(failure(read.error, ["lophn_app show로 앱을 읽는다"]));
  }
  const sourceDir = str(obj(obj(read.value).app).source_path);
  if (sourceDir === undefined) {
    return err(failure({
      code: "conflict",
      message: "앱에 연결된 source가 없다",
      details: { app },
    }, ["lophn_app source로 구현 시작 source를 연결한다"]));
  }
  const path = `${sourceDir.replace(/\/+$/, "")}/deno.json`;
  const text = await deps.source.readText(path);
  if (!text.ok) return err(failure(text.error, [refer(deps, "add")]));
  const planned = planImportMap(text.value, name, version);
  if (planned.outcome === "conflict") {
    return ok({
      outcome: "conflict",
      reason: planned.reason,
      message: CONFLICT_REASONS[planned.reason],
      existing: planned.existing,
      config: path,
    });
  }
  if (planned.outcome === "unchanged") {
    return ok({ outcome: "unchanged", config: path });
  }
  const wrote = await deps.source.writeText(path, planned.text);
  if (!wrote.ok) return err(failure(wrote.error, [refer(deps, "add")]));
  const lock = await deps.source.refreshLock(sourceDir);
  return ok({
    outcome: "changed",
    config: path,
    lock: lock.ok ? "refreshed" : "failed",
    ...(lock.ok ? {} : { lock_error: lock.error.message }),
  });
}

async function addPackage(
  input: Obj,
  deps: SdkOpDeps,
): Promise<SdkOpOutput> {
  const name = str(input.name);
  if (name === undefined) {
    return failure({
      code: "invalid_input",
      message: "package name이 필요하다",
    }, [refer(deps, "catalog", "로 이름을 찾는다")]);
  }
  const version = str(input.version);
  if (version === undefined || isRangeVersion(version)) {
    return failure({
      code: "invalid_input",
      message: version === undefined
        ? "exact version이 필요하다"
        : `범위·별칭 version은 거절한다: ${version}`,
      details: { version: version ?? null },
    }, [refer(deps, "show", "로 설치된 exact version을 고른다")]);
  }
  if (isPersonalSdk(name)) return absentFailure(deps, name);
  const versions = await readVersions(name, deps, "add");
  if (!versions.ok) return versions.error;
  if (!versions.value.names.includes(version)) {
    return versionNotInstalled(deps, name, version, versions.value.names);
  }
  const entry = sdkImportEntry(name, version);
  const base = {
    name,
    version,
    import_key: entry.key,
    import_value: entry.value,
    guide_hash: versions.value.guideHashes[version] ?? null,
  };
  if (input.apply !== true) {
    return {
      summary: `SDK ${name}@${version} 고정 import 안내`,
      data: { ...base, apply: null },
      next: [
        `deno.json imports에 "${entry.key}": "${entry.value}"를 더하고 deno.lock을 다시 만든다`,
        refer(deps, "add", "에 apply를 켜면 앱 source에 반영한다"),
      ],
    };
  }
  const applied = await applyToSource(input, deps, name, version);
  if (!applied.ok) return applied.error;
  const outcome = applied.value.outcome;
  return {
    summary: outcome === "changed"
      ? `SDK ${name}@${version}을 deno.json에 더했다`
      : outcome === "unchanged"
      ? `SDK ${name}@${version}은 이미 deno.json에 있다(무변경)`
      : `SDK ${name}@${version} 충돌: ${applied.value.message}`,
    data: { ...base, apply: applied.value },
    next: outcome === "conflict"
      ? [
        "사람이 정한 source를 보존한다. 기존 항목을 사람과 정한 뒤 다시 add한다",
      ]
      : ["lophn_app validate로 blueprint와 import map을 검사한다"],
  };
}

export async function runSdkOp(
  rawInput: unknown,
  deps: SdkOpDeps,
): Promise<SdkOpOutput> {
  const { op, ...input } = obj(rawInput);
  if (!isSdkOp(op)) {
    return failure({
      code: "invalid_input",
      message: "sdk tool 표에 없는 op다",
      details: { op: typeof op === "string" ? op : null },
    }, [refer(deps, "catalog", "로 설치 SDK를 찾는다")]);
  }
  switch (op) {
    case "catalog":
      return await catalogPackages(input, deps);
    case "show":
      return await showPackage(input, deps);
    case "add":
      return await addPackage(input, deps);
  }
}
