// 앱의 `main.ts`를 폰에서 도는 backend(`phone/backend.js` + `phone/backend.json`)로 묶는다. 폰은 Node 내장 module이
// 없는 JS 런타임이라 SDK는 조건 `lophn-phone`의 폰 entry로 풀고, Node 내장과 폰 entry가 없는 SDK는 build가
// 거절한다. esbuild는 앱 code를 묶을 뿐 실행하지 않는다(load 검사가 child에서 실행한다).
// import는 staging 안에서만 푼다(`stagingGuard`): staging 밖 file(저장소 node_modules 등)이 묶이면 build가 실패한다.
import {
  mkdir,
  readdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { isBuiltin } from "node:module";
import { join, relative } from "node:path";
import * as esbuild from "esbuild";
import {
  err,
  type LophnError,
  ok,
  type Result,
  sha256Hex,
} from "../../../../base/mod.ts";
import {
  PHONE_BACKEND_FORMAT,
  PHONE_BACKEND_MAX_BYTES,
  type PhoneBackendManifest,
} from "../../../../protocol/apps/mod.ts";
import { stagingGuard } from "../ui-build/staging-guard.ts";

// 폰 entry가 없는 SDK다(파일과 flow는 컴퓨터에서만 돈다).
const NO_PHONE_ENTRY = ["@lophn/cap-fs", "@lophn/flow"];
// 묶인 SDK 사본(`.lophn/sdk/<part>/<version>/`)의 판을 manifest에 싣는다.
const SDK_PARTS = ["cap-store", "cap-tool"] as const;

export type PhoneBackendDeclaration = {
  operations: readonly {
    name: string;
    effect: "read" | "write" | "external";
  }[];
  commands: readonly { name: string }[];
  subscriptions?: readonly { source: string; event: string }[];
};

export type PhoneBackendBuild = {
  // staging 기준으로 쓴 file이다.
  files: string[];
  manifest: PhoneBackendManifest;
};

function invalid(message: string): Result<never, LophnError> {
  return err({ code: "invalid_input", message });
}

const PLUGIN = "phone-backend";

function importGuard(root: string): esbuild.Plugin {
  const rejected = (name: string, importer: string) => ({
    errors: [
      {
        text: `a backend that runs on the phone cannot import ${name} (${relative(root, importer)})`,
      },
    ],
  });
  return {
    name: PLUGIN,
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        const name = args.path;
        if (
          name.startsWith("node:") ||
          isBuiltin(name) ||
          NO_PHONE_ENTRY.some(
            (sdk) => name === sdk || name.startsWith(`${sdk}/`),
          )
        ) {
          return rejected(name, args.importer);
        }
        return undefined;
      });
    },
  };
}

// esbuild 실패의 첫 오류를 한 줄로 만든다. 위치는 staging 기준이다.
function firstError(thrown: unknown): string {
  const first = (thrown as esbuild.BuildFailure).errors?.[0];
  if (first === undefined) return "the backend build failed";
  // 거절 문장은 이미 file을 말한다.
  const at =
    first.location && first.pluginName !== PLUGIN
      ? ` (${first.location.file}:${first.location.line})`
      : "";
  return `${first.text}${at}`;
}

async function migrationsOf(
  root: string,
): Promise<PhoneBackendManifest["migrations"]> {
  const found: PhoneBackendManifest["migrations"] = [];
  let names: string[] = [];
  try {
    names = await readdir(join(root, "migrations"));
  } catch {
    // DB를 쓰지 않는 앱이다.
  }
  for (const name of names) {
    const match = /^(\d+)-(\d+)\.sql$/.exec(name);
    if (match === null) continue;
    found.push({
      from: Number(match[1]),
      to: Number(match[2]),
      file: `migrations/${name}`,
      sha256: await sha256Hex(await readFile(join(root, "migrations", name))),
    });
  }
  return found.sort((a, b) => a.from - b.from);
}

export async function buildPhoneBackend(
  staging: string,
  declaration: PhoneBackendDeclaration,
): Promise<Result<PhoneBackendBuild, LophnError>> {
  const root = await realpath(staging);
  let built: esbuild.BuildResult<{ write: false; metafile: true }>;
  try {
    built = await esbuild.build({
      absWorkingDir: root,
      entryPoints: [join(root, "main.ts")],
      outfile: join(root, "phone/backend.js"),
      write: false,
      metafile: true,
      bundle: true,
      platform: "neutral",
      // neutral은 package.json의 main을 읽지 않는다. npm 의존이 exports 없이 main만 가질 때를 위해 연다.
      mainFields: ["module", "main"],
      conditions: ["lophn-phone"],
      format: "iife",
      target: "es2015",
      minify: true,
      // source map은 싣지 않는다. 폰은 manifest가 적은 file만 받고 map을 읽는 곳이 없다.
      define: { "process.env.NODE_ENV": '"production"' },
      logLevel: "silent",
      plugins: [importGuard(root), stagingGuard(root)],
    });
  } catch (thrown) {
    return invalid(firstError(thrown));
  }
  const js = built.outputFiles.find((file) => file.path.endsWith("backend.js"));
  if (js === undefined) {
    return err({
      code: "internal",
      message: "the backend build wrote no output",
    });
  }
  if (js.contents.length > PHONE_BACKEND_MAX_BYTES) {
    return invalid(
      `backend.js is ${js.contents.length} bytes; a phone backend must stay under ${PHONE_BACKEND_MAX_BYTES} bytes`,
    );
  }

  // 묶인 SDK 사본에서 판을 읽는다(npm이 둔 node_modules 링크가 아니라 실제로 묶인 file 기준).
  const sdk: Record<string, string> = {};
  for (const part of SDK_PARTS) {
    const pattern = new RegExp(
      `(?:^|/)\\.lophn/sdk/${part}/(\\d+\\.\\d+\\.\\d+)/`,
    );
    const version = Object.keys(built.metafile.inputs)
      .map((path) => pattern.exec(path)?.[1])
      .find((found) => found !== undefined);
    if (version === undefined) {
      return invalid(
        `a phone backend must import @lophn/${part} (main.ts does not reach it)`,
      );
    }
    sdk[`@lophn/${part}`] = version;
  }

  const migrations = await migrationsOf(root);
  const manifest: PhoneBackendManifest = {
    format: PHONE_BACKEND_FORMAT,
    entry: "backend.js",
    size: js.contents.length,
    sha256: await sha256Hex(js.contents),
    data_schema: migrations.reduce((high, step) => Math.max(high, step.to), 0),
    migrations,
    operations: Object.fromEntries(
      declaration.operations.map((operation) => [
        operation.name,
        operation.effect,
      ]),
    ),
    sdk: sdk as PhoneBackendManifest["sdk"],
  };
  await mkdir(join(root, "phone"), { recursive: true });
  await writeFile(join(root, "phone/backend.js"), js.contents);
  await writeFile(
    join(root, "phone/backend.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return ok({
    files: ["phone/backend.js", "phone/backend.json"],
    manifest,
  });
}
