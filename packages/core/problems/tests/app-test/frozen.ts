// app test의 고정 시험(FrozenTest)을 봉인 bundle 사본에서 정한다. 요청한 쪽과 runner가
// 같은 함수로 같은 시험·hash를 얻으므로 RequestTest의 `test`와 runner가 돌린 시험이 어긋나면 runner가
// 실행하지 않는다. FrozenTest의 모든 hash는 이 함수가 내는 blob의 sha256이고, Verification이 영구 등록하는
// blob(hash→bytes)도 여기서 같이 낸다: 저장하지 않은 blob의 hash를 적지 않는다.
import { createHash } from "node:crypto";
import type { Blueprint } from "../../../../protocol/apps/blueprint/mod.ts";
import { bundleManifestSchema } from "../../../../protocol/apps/mod.ts";
import type { FrozenTest } from "../../../../protocol/problems/mod.ts";
import { canonicalHash, canonicalJson } from "../canonical.ts";
import {
  CHECK_DEFINITIONS_VERSION,
  EXAMPLES_CHECK,
  REQUIRED_CHECKS,
} from "../harness/definitions.ts";
import type { HarnessExample } from "../harness/driver.ts";
import { type BundleDependency, dependenciesHash } from "./generate.ts";

const APP_TEST_TIMEOUT_MS = 240_000;
const EXPECTED_TEXT = "every required check passes";
const EXAMPLES_EXPECTED_TEXT = "every example matches";
const ENVIRONMENT_TEXT = "problems/tests runner environment";

type BundleFacts = {
  blueprintBytes: Uint8Array;
  blueprint: Blueprint;
  entrypoint: string;
  dependencies: BundleDependency[];
  // bundle import map의 specifier → 값.
  imports: Record<string, string>;
};

type DerivedAppTest = {
  frozen: FrozenTest;
  test_hash: string;
  facts: BundleFacts;
  // FrozenTest가 가리키는 모든 blob. hash는 bytes의 sha256이다.
  blobs: ReadonlyMap<string, Uint8Array>;
  // runner 환경을 적은 blob의 hash(method.environment, execution.environment).
  environment: string;
};

function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const encode = (text: string) => new TextEncoder().encode(text);

function environmentBytes(): Uint8Array {
  return encode(ENVIRONMENT_TEXT);
}

type DeriveResult =
  | { ok: true; value: DerivedAppTest }
  | { ok: false; reason: string };

// 봉인 bundle 사본의 blueprint·manifest·import map을 읽는다.
export async function readBundleFacts(
  bundle: string,
): Promise<{ ok: true; value: BundleFacts } | { ok: false; reason: string }> {
  try {
    const blueprintBytes = await Deno.readFile(`${bundle}/blueprint.json`);
    const blueprint = JSON.parse(
      new TextDecoder().decode(blueprintBytes),
    ) as Blueprint;
    const manifest = bundleManifestSchema.parse(
      JSON.parse(await Deno.readTextFile(`${bundle}/manifest.json`)),
    );
    const map = JSON.parse(
      await Deno.readTextFile(`${bundle}/import-map.json`),
    ) as { imports?: Record<string, string> };
    return {
      ok: true,
      value: {
        blueprintBytes,
        blueprint,
        entrypoint: manifest.entrypoint,
        dependencies: manifest.dependencies,
        imports: map.imports ?? {},
      },
    };
  } catch {
    return {
      ok: false,
      reason: "bundle 사본의 blueprint·manifest·import map을 읽을 수 없다",
    };
  }
}

// bundle 사본에서 고정 시험을 만든다. 읽을 수 없으면 이유를 돌려준다.
export async function deriveAppTest(
  bundle: string,
  bundleHash: string,
  options: { examples?: readonly HarnessExample[] } = {},
): Promise<DeriveResult> {
  const read = await readBundleFacts(bundle);
  if (!read.ok) return read;
  const facts = read.value;
  try {
    const blobs = new Map<string, Uint8Array>();
    const store = (bytes: Uint8Array): string => {
      const hash = sha256Bytes(bytes);
      blobs.set(hash, bytes);
      return hash;
    };
    const sorted = [...facts.dependencies].sort((a, b) =>
      a.name.localeCompare(b.name) || a.version.localeCompare(b.version)
    );
    const dependencies = store(encode(canonicalJson(sorted)));
    if (dependencies !== dependenciesHash(facts.dependencies)) {
      return { ok: false, reason: "의존 hash를 정할 수 없다" };
    }
    const environment = store(environmentBytes());
    const frozen: FrozenTest = {
      code: store(
        encode(canonicalJson({ kind: "bundle", bundle_hash: bundleHash })),
      ),
      // 예시 검증 실행은 예시를 고정 입력에 넣어, 요청한 쪽과 runner가 같은 예시를 돌리게 한다.
      input: store(encode(canonicalJson(
        options.examples === undefined
          ? { version: CHECK_DEFINITIONS_VERSION, checks: REQUIRED_CHECKS }
          : {
            version: CHECK_DEFINITIONS_VERSION,
            checks: [EXAMPLES_CHECK],
            examples: options.examples,
          },
      ))),
      expected: store(
        encode(
          options.examples === undefined
            ? EXPECTED_TEXT
            : EXAMPLES_EXPECTED_TEXT,
        ),
      ),
      method: {
        argv: ["test", "child_test.ts"],
        cwd: ".",
        timeout_ms: APP_TEST_TIMEOUT_MS,
        expected_exit_code: 0,
        environment,
      },
      blueprint: store(facts.blueprintBytes),
      sdk_dependencies: dependencies,
      // app test에서는 비워 둔다.
      failure_paths: [],
    };
    const test = store(encode(canonicalJson(frozen)));
    if (test !== canonicalHash(frozen)) {
      return { ok: false, reason: "고정 시험 hash를 정할 수 없다" };
    }
    return {
      ok: true,
      value: { frozen, test_hash: test, facts, blobs, environment },
    };
  } catch {
    return { ok: false, reason: "고정 시험을 만들 수 없다" };
  }
}
