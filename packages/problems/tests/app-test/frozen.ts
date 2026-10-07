// app test의 고정 시험(FrozenTest)을 봉인 bundle 사본에서 정한다(problems/tests#R6, R12). 요청한 쪽과 runner가
// 같은 함수로 같은 시험·hash를 얻으므로 RequestTest의 `test`와 runner가 돌린 시험이 어긋나면 runner가
// 실행하지 않는다. FrozenTest의 모든 hash는 이 함수가 내는 blob의 sha256이고, Verification이 영구 등록하는
// blob(hash→bytes)도 여기서 같이 낸다: 저장하지 않은 blob의 hash를 적지 않는다.
import { createHash } from "node:crypto";
import type { Blueprint } from "../../../contracts/apps/mod.ts";
import type { FrozenTest } from "../../../contracts/problems/mod.ts";
import { canonicalHash, canonicalJson } from "../canonical.ts";
import type { HarnessFailurePath } from "../harness/mod.ts";
import { sdkDependenciesHash } from "./generate.ts";

// 앱이 bundle에 넣은 시험 자료(`tests/app-test.json`)다.
export type AppTestFile = {
  failure_paths: HarnessFailurePath[];
  inputs?: Record<string, unknown>;
  prepare?: Record<
    string,
    { command: string; input?: unknown; bind?: Record<string, string> }
  >;
  journal_tables?: string[];
  domain?: {
    name: string;
    command: string;
    input?: unknown;
    fault?: "store" | "net" | "none";
  }[];
};

export const APP_TEST_TIMEOUT_MS = 240_000;
const EXPECTED_TEXT = "every required check passes";
const ENVIRONMENT_TEXT = "problems/tests runner environment";

export type DerivedAppTest = {
  frozen: FrozenTest;
  test_hash: string;
  blueprint: Blueprint;
  file: AppTestFile;
  // FrozenTest가 가리키는 모든 blob. hash는 bytes의 sha256이다.
  blobs: ReadonlyMap<string, Uint8Array>;
  // runner 환경을 적은 blob의 hash(method.environment, execution.environment).
  environment: string;
};

export function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const encode = (text: string) => new TextEncoder().encode(text);

export function environmentBytes(): Uint8Array {
  return encode(ENVIRONMENT_TEXT);
}

export type DeriveResult =
  | { ok: true; value: DerivedAppTest }
  | { ok: false; reason: string };

// bundle 사본에서 고정 시험을 만든다. 읽을 수 없거나 시험 자료가 없으면 이유를 돌려준다.
export async function deriveAppTest(
  bundle: string,
  bundleHash: string,
): Promise<DeriveResult> {
  let blueprintBytes: Uint8Array;
  let blueprint: Blueprint;
  try {
    blueprintBytes = await Deno.readFile(`${bundle}/blueprint.json`);
    blueprint = JSON.parse(new TextDecoder().decode(blueprintBytes));
  } catch {
    return { ok: false, reason: "bundle 사본의 blueprint를 읽을 수 없다" };
  }
  let file: AppTestFile;
  try {
    file = JSON.parse(
      await Deno.readTextFile(`${bundle}/tests/app-test.json`),
    ) as AppTestFile;
  } catch {
    return { ok: false, reason: "bundle에 앱 시험 자료(tests/app-test.json)가 없다" };
  }
  if (!Array.isArray(file.failure_paths)) {
    return { ok: false, reason: "앱 시험 자료에 실패 경로 목록이 없다" };
  }
  try {
    const blobs = new Map<string, Uint8Array>();
    const store = (bytes: Uint8Array): string => {
      const hash = sha256Bytes(bytes);
      blobs.set(hash, bytes);
      return hash;
    };
    const dependencies = [...blueprint.sdk_dependencies].map((
      { name, version },
    ) => ({ name, version })).sort((a, b) =>
      a.name.localeCompare(b.name) || a.version.localeCompare(b.version)
    );
    const sdk = store(encode(canonicalJson(dependencies)));
    if (sdk !== sdkDependenciesHash(blueprint.sdk_dependencies)) {
      return { ok: false, reason: "SDK 의존 hash를 정할 수 없다" };
    }
    const failurePaths = file.failure_paths.map((path) => ({
      code: path.code,
      test_hash: store(encode(canonicalJson(path))),
    }));
    const environment = store(environmentBytes());
    const frozen: FrozenTest = {
      code: store(encode(canonicalJson({ kind: "bundle", bundle_hash: bundleHash }))),
      input: store(encode(canonicalJson({
        inputs: file.inputs ?? {},
        prepare: file.prepare ?? {},
        journal_tables: file.journal_tables ?? [],
        domain: file.domain ?? [],
      }))),
      expected: store(encode(EXPECTED_TEXT)),
      method: {
        argv: ["test", "child_test.ts"],
        cwd: ".",
        timeout_ms: APP_TEST_TIMEOUT_MS,
        expected_exit_code: 0,
        environment,
      },
      blueprint: store(blueprintBytes),
      sdk_dependencies: sdk,
      failure_paths: failurePaths,
      symptom: null,
    };
    const test = store(encode(canonicalJson(frozen)));
    if (test !== canonicalHash(frozen)) {
      return { ok: false, reason: "고정 시험 hash를 정할 수 없다" };
    }
    return {
      ok: true,
      value: { frozen, test_hash: test, blueprint, file, blobs, environment },
    };
  } catch {
    return { ok: false, reason: "고정 시험을 만들 수 없다" };
  }
}
