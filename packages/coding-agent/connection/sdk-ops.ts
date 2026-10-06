// SDK tool의 공통 실행이다(T22, mcp#R22·R23, cli#R30). catalog·show·add가 같은
// credential·입력의 결과와 거절을 공유하도록 MCP와 CLI가 이 한 흐름을 지난다.
// (connection#R6, cli#R1). op마다 소유 route로만 보내는 것은 catalog와 show는
// app tool과 다르게 추가 로직이 없지만, add 작업은 app import map과 lock을 현재
// 앱 source에 반영해야 한다(apps#T22의 buildImportMap).
import type { LophnError } from "../../base/mod.ts";
import {
  packagesGuide,
  packagesList,
  packagesVersions,
} from "../../contracts/apps/mod.ts";
import type { FlowClient } from "./document-save.ts";

// SDK op의 공통 op table이다(T21 app-ops의 패턴, mcp#R22·R23, cli#R30).
export const SDK_OP_ROUTES = {
  catalog: packagesList,
  show: packagesVersions,
  add: packagesGuide, // version 존재 확인
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

export type SdkOpDeps = {
  client: Pick<FlowClient, "read">;
  surface?: "mcp" | "cli";
};

type Obj = Record<string, unknown>;

function obj(value: unknown): Obj {
  return typeof value === "object" && value !== null ? value as Obj : {};
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

function withoutOp(input: unknown): Obj {
  const { op: _op, ...rest } = obj(input);
  return rest;
}

async function catalogPackages(
  input: Obj,
  deps: SdkOpDeps,
): Promise<SdkOpOutput> {
  const read = await deps.client.read(packagesList, input);
  if (!read.ok) return failure(read.error, [refer(deps, "catalog")]);
  const value = obj(read.value);
  const packages = Array.isArray(value.packages) ? value.packages : [];
  const result = packages.map((pkg: Obj) => ({
    name: pkg.name,
    latest_version: Array.isArray(pkg.versions)
      ? ((pkg.versions as Obj[])[0]?.version ?? null)
      : null,
    kind: pkg.kind,
    description: pkg.description,
  }));
  return {
    summary: `catalog: SDK ${packages.length}개`,
    data: {
      packages: result,
      total: packages.length,
      next_cursor: value.next_cursor ?? null,
    },
    next: [
      refer(deps, "show", "로 상세 정보와 예제를 읽는다"),
      refer(deps, "add", "로 version을 앱에 더한다"),
    ],
  };
}

async function showPackage(
  input: Obj,
  deps: SdkOpDeps,
): Promise<SdkOpOutput> {
  const read = await deps.client.read(packagesVersions, input);
  if (!read.ok) return failure(read.error, [refer(deps, "catalog")]);
  const value = obj(read.value);
  return {
    summary: `SDK ${value.name}: ${
      Array.isArray(value.versions)
        ? `version ${value.versions.length}개`
        : "version 없음"
    }`,
    data: value,
    next: [
      refer(deps, "add", "로 exact version을 선택해 앱에 더한다"),
    ],
  };
}

async function addPackage(
  input: Obj,
  deps: SdkOpDeps,
): Promise<SdkOpOutput> {
  // add는 name·version을 받아 앱 import map에 반영한다(mcp#R23, cli#R30).
  // apply=true일 때만 deno.json을 수정한다(apps#T22 buildImportMap 패턴).
  // packagesGuide로 version 존재를 확인한다(contract mcp-app.ts).
  const name = str(input.name);
  if (name === undefined) {
    return failure({
      code: "invalid_input",
      message: "package name이 필요하다",
    }, [refer(deps, "catalog", "로 이름을 찾는다")]);
  }
  const version = str(input.version);
  if (version === undefined) {
    return failure({
      code: "invalid_input",
      message: "exact version이 필요하다(^·~ 없음)",
    }, [refer(deps, "show", "로 exact version을 보는다")]);
  }

  // 범위 버전인지 먼저 확인한다.
  if (/^[~^]/.test(version) || ["latest", "next", "x"].includes(version)) {
    return failure({
      code: "invalid_input",
      message: `범위 지정 version은 거절한다: ${version}`,
      details: { version },
    }, [refer(deps, "show", "로 exact version을 고른다")]);
  }

  // packagesGuide로 version 존재 확인한다.
  const read = await deps.client.read(packagesGuide, { name, version });
  if (!read.ok) {
    return failure(read.error, [
      refer(deps, "show", "로 설치된 version을 본다"),
    ]);
  }

  // 고정 import 안내를 만든다.
  const importKey = `lophn-sdk:${name}@${version}`;
  const importValue = `./sdk/${name}/${version}/`;

  // apply 없으면 안내만 돌려준다.
  if (input.apply !== true) {
    return {
      summary: `SDK ${name}@${version} 추가 안내`,
      data: {
        name,
        version,
        import_key: importKey,
        import_value: importValue,
        applied: false,
      },
      next: [
        `--apply로 자동 반영하려면 다시 부른다`,
      ],
    };
  }

  // apply=true이면 caller는 deno.json을 수정하고 lock을 재생성해야 한다.
  // 이 구현은 안내만 돌려주고, 실제 파일 수정과 lock 재생성은 앱 tool이 한다.
  return {
    summary: `SDK ${name}@${version} 추가 지시`,
    data: {
      name,
      version,
      import_key: importKey,
      import_value: importValue,
      applied: false,
      apply_required: true,
      instruction:
        "실제 deno.json 수정과 lock 재생성은 buildImportMap (apps#T22) 구현이 필요",
    },
    next: [
      "apps#T22의 buildImportMap 완료 후 이 기능을 활성화한다",
    ],
  };
}

export async function runSdkOp(
  rawInput: unknown,
  deps: SdkOpDeps,
): Promise<SdkOpOutput> {
  const op = obj(rawInput).op;
  if (!isSdkOp(op)) {
    return failure({
      code: "invalid_input",
      message: "sdk tool 표에 없는 op다",
      details: { op: typeof op === "string" ? op : null },
    }, [
      refer(deps, "catalog", "로 도움말을 본다"),
    ]);
  }
  const input = withoutOp(rawInput);
  switch (op) {
    case "catalog":
      return await catalogPackages(input, deps);
    case "show":
      return await showPackage(input, deps);
    case "add":
      return await addPackage(input, deps);
  }
}
