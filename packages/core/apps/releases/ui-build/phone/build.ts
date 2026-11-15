// 앱 폰 화면 build. `app-build.ts`가 `src/screens/<key>/phone.tsx`가 있는 화면마다 부른다(그 dir에 `main.tsx`는
// 없다: 한 key에 program 둘을 두지 않는다). 같은 source를 두 번 묶어 `dist/screens/<key>/`에 쓴다.
// - `phone.js`(+`phone.js.map`): 폰의 guest runtime이 base bundle 위에서 돌리는 plain JS. iife·es2015(Hermes에
//   async와 class field를 맡기지 않는다)이고 진입은 `__lophnMount(Screen)`, 평가 전체를 try/catch로 감싸
//   `__lophnFatal`에 넘긴다(평가 중 예외가 폰 process를 죽이지 않게). `PHONE_HOST_MODULES`만 external이고 base가
//   `globalThis.require`로 내준다. 앱 자기 npm 의존(순수 JS)은 묶는다. desktop용 module(`react-dom`, `@lophn/ui`,
//   `@lophn/app-ui`), 목록 밖의 `react-native*`·`@react-native/*`·`expo*`·`@expo/*`, host module의 sub-path, node
//   내장은 build를 실패시킨다: AI가 쓴 code가 폰의 native module에 닿는 길을 여기서 막는다.
// - `phone.json`: `phoneManifestSchema`. kit 판은 앱이 pin한 `.lophn/sdk` 사본의 판, `modules`는 `phone.js`가
//   실제로 require하는 이름이다. 2 MiB를 넘는 `phone.js`는 실패다.
// - `index.html`·`preview.js`(+`preview.js.map`): desktop preview. react-dom이 화면을 kit의 `UiProvider`와 error
//   boundary 아래 그린다. `react-native`는 react-native-web으로 풀고(`web-shims.ts`), `.web.*`를 먼저 찾는다.
//   이 build가 쓰는 react-native-web·react-dom은 앱의 devDependencies에서 온다.
// 폰 화면 앱은 kit과 그 peer(react-native 등, 설치 약 470 MB)를 devDependencies로 둔다. 준비는 build 뒤 그것을
// `npm prune --omit=dev`로 빼서 bundle 상한(256 MiB, file 10,000개) 안에 든다(`prepare/from-source.ts`).
// 앱 code는 묶일 뿐 실행되지 않고, staging 밖 file은 `stagingGuard`가 막는다.
import { createHash } from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { isBuiltin } from "node:module";
import { join, sep } from "node:path";
import * as esbuild from "esbuild";
import {
  PHONE_BASE_FORMAT,
  PHONE_GUEST_GLOBALS,
  PHONE_HOST_MODULES,
  phoneManifestSchema,
} from "../../../../../protocol/apps/phone-screen.ts";
import { stagingGuard } from "../staging-guard.ts";
import { WEB_SHIMS } from "./web-shims.ts";

const PHONE_JS_MAX_BYTES = 2 * 1024 * 1024;
const DESKTOP_MODULES = ["react-dom", "@lophn/ui", "@lophn/app-ui"];
const KITS = ["@lophn/ui-native", "@lophn/app-ui-native"] as const;
const PRODUCTION = { "process.env.NODE_ENV": '"production"' };

function packageName(path: string): string {
  const parts = path.split("/");
  return (path.startsWith("@") ? parts.slice(0, 2) : parts.slice(0, 1)).join(
    "/",
  );
}

const HOST_MODULES = new Set<string>(PHONE_HOST_MODULES);
const HOST_PACKAGES = new Set(PHONE_HOST_MODULES.map(packageName));

// 폰 화면이 import할 수 없는 이유. 앱 자기 npm 의존처럼 묶어도 되는 이름은 undefined다.
function refusal(path: string): string | undefined {
  if (isBuiltin(path)) {
    return `${path} is a Node built-in module; a phone screen runs on the phone`;
  }
  const name = packageName(path);
  if (DESKTOP_MODULES.includes(name)) {
    return `${name} is for desktop screens. Phone screens use @lophn/ui-native and @lophn/app-ui-native`;
  }
  if (HOST_PACKAGES.has(name)) {
    return `a phone screen cannot import ${path}. Import ${name} by its package name`;
  }
  if (/^(react-native(-|$)|@react-native\/|expo(-|$)|@expo\/)/.test(name)) {
    return `a phone screen cannot use the module ${path}. It can import ${PHONE_HOST_MODULES.join(", ")} and plain JS packages`;
  }
  return undefined;
}

const phoneModules: esbuild.Plugin = {
  name: "phone-modules",
  setup(build) {
    build.onResolve({ filter: /^[^./]/ }, (args) => {
      if (HOST_MODULES.has(args.path))
        return { path: args.path, external: true };
      const why = refusal(args.path);
      return why === undefined ? undefined : { errors: [{ text: why }] };
    });
  },
};

// preview에서 module 이름을 core의 대체 source로 바꾼다. 대체 source의 import는 staging에서 푼다.
function webShims(base: string): esbuild.Plugin {
  const names = Object.keys(WEB_SHIMS).map((name) =>
    name.replace(/[/.-]/g, "\\$&"),
  );
  return {
    name: "phone-web-shims",
    setup(build) {
      build.onResolve(
        { filter: new RegExp(`^(${names.join("|")})$`) },
        (args) => ({
          path: args.path,
          namespace: "phone-web",
        }),
      );
      build.onLoad({ filter: /.*/, namespace: "phone-web" }, (args) => ({
        contents: WEB_SHIMS[args.path],
        loader: "js",
        resolveDir: base,
      }));
    },
  };
}

// esbuild 오류를 한 줄씩 `file:line:column: 이유`로 낸다. 준비가 stderr 앞부분을 agent에게 넘긴다.
export function describeBuildFailure(thrown: unknown): string {
  const errors = (thrown as { errors?: esbuild.Message[] }).errors;
  if (!Array.isArray(errors) || errors.length === 0) {
    return thrown instanceof Error ? thrown.message : String(thrown);
  }
  return errors
    .map((error) =>
      error.location === null
        ? error.text
        : `${error.location.file}:${error.location.line}:${error.location.column + 1}: ${error.text}`,
    )
    .join("\n");
}

// `phone.js`와 `phone.js.map`을 out에 쓰고 `phone.js`가 require하는 host module 이름을 돌려준다.
export async function bundlePhone(
  base: string,
  key: string,
  out: string,
): Promise<string[]> {
  const { mount, fatal } = PHONE_GUEST_GLOBALS;
  const built = await esbuild.build({
    absWorkingDir: base,
    stdin: {
      contents: `import Screen from "./src/screens/${key}/phone.tsx";\nglobalThis.${mount}(Screen);\n`,
      resolveDir: base,
      sourcefile: `src/screens/${key}/phone-entry.js`,
      loader: "js",
    },
    outfile: join(out, "phone.js"),
    bundle: true,
    format: "iife",
    target: "es2015",
    jsx: "automatic",
    minify: true,
    sourcemap: "external",
    banner: { js: "try{" },
    footer: { js: `}catch(e){globalThis.${fatal}&&globalThis.${fatal}(e)}` },
    define: PRODUCTION,
    metafile: true,
    logLevel: "silent",
    plugins: [phoneModules, stagingGuard(base)],
  });
  const output = Object.entries(built.metafile.outputs).find(([path]) =>
    path.endsWith("phone.js"),
  )?.[1];
  const modules = (output?.imports ?? [])
    .filter((item) => item.external)
    .map((item) => item.path);
  return [...new Set(modules)].sort();
}

const PREVIEW_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./preview.js"></script>
  </body>
</html>
`;

function previewEntry(key: string): string {
  return `import { Component, createElement } from "react";
import { createRoot } from "react-dom/client";
import { UiProvider } from "@lophn/ui-native";
import Screen from "./src/screens/${key}/phone.tsx";
class Boundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    const error = this.state.error;
    if (error === null) return this.props.children;
    return createElement("pre", { style: { margin: 16, whiteSpace: "pre-wrap", color: "#b42318" } }, String(error?.stack ?? error));
  }
}
createRoot(document.getElementById("root")).render(
  createElement(UiProvider, null, createElement(Boundary, null, createElement(Screen))),
);
`;
}

async function bundlePreview(base: string, key: string, out: string) {
  await esbuild.build({
    absWorkingDir: base,
    stdin: {
      contents: previewEntry(key),
      resolveDir: base,
      sourcefile: `src/screens/${key}/preview-entry.js`,
      loader: "js",
    },
    outfile: join(out, "preview.js"),
    bundle: true,
    format: "esm",
    jsx: "automatic",
    minify: true,
    sourcemap: "linked",
    resolveExtensions: [
      ".web.tsx",
      ".web.ts",
      ".web.jsx",
      ".web.js",
      ".tsx",
      ".ts",
      ".jsx",
      ".js",
      ".json",
    ],
    define: { ...PRODUCTION, global: "globalThis" },
    logLevel: "silent",
    plugins: [webShims(base), stagingGuard(base)],
  });
  await writeFile(join(out, "index.html"), PREVIEW_HTML);
}

// 앱이 pin한 kit 판. npm이 건 `node_modules/<이름>`이 `.lophn/sdk`의 설치 사본이어야 한다.
async function kitVersion(base: string, name: string): Promise<string> {
  let real: string;
  try {
    real = await realpath(join(base, "node_modules", name));
  } catch {
    throw new Error(
      `phone screens need ${name}. Add it to devDependencies as file:.lophn/sdk/${name.slice("@lophn/".length)}/<version>`,
    );
  }
  if (!real.startsWith(join(base, ".lophn/sdk") + sep)) {
    throw new Error(
      `${name} must be the lophn SDK copy (file:.lophn/sdk/${name.slice("@lophn/".length)}/<version>)`,
    );
  }
  const manifest = JSON.parse(
    await readFile(join(real, "package.json"), "utf8"),
  ) as { version: string };
  return manifest.version;
}

// 폰 화면 하나를 `out`(`dist/screens/<key>/`)에 짓는다. 실패는 agent가 읽을 한 줄짜리 Error다.
export async function buildPhoneScreen(
  base: string,
  key: string,
  out: string,
): Promise<void> {
  const modules = await bundlePhone(base, key, out);
  const js = await readFile(join(out, "phone.js"));
  if (js.byteLength > PHONE_JS_MAX_BYTES) {
    throw new Error(
      `src/screens/${key}/phone.tsx: screen bundle is too large (${js.byteLength} bytes, limit ${PHONE_JS_MAX_BYTES})`,
    );
  }
  const manifest = phoneManifestSchema.parse({
    format: 1,
    entry: "phone.js",
    size: js.byteLength,
    sha256: createHash("sha256").update(js).digest("hex"),
    base: PHONE_BASE_FORMAT,
    kit: {
      [KITS[0]]: await kitVersion(base, KITS[0]),
      [KITS[1]]: await kitVersion(base, KITS[1]),
    },
    modules,
  });
  await writeFile(join(out, "phone.json"), JSON.stringify(manifest));
  await bundlePreview(base, key, out);
}
