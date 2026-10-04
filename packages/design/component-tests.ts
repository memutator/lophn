// Deno는 CSS Modules를 직접 읽지 못한다. 주어진 폴더의 *_test.tsx를 renderer와 같은
// esbuild local-css loader로 한 bundle에 묶고(React 한 벌), happy-dom 위에서 그 bundle을
// 불러 test를 등록한다. 부른 test 파일이 import되는 동안 등록하므로 test 이름은 원본 그대로다.
import * as esbuild from "esbuild";
import { denoPlugins } from "@luca/esbuild-deno-loader";
import { Window } from "happy-dom";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const design = new URL("./", import.meta.url);
const root = new URL("../../", design);

async function testFiles(directory: URL): Promise<URL[]> {
  const found: URL[] = [];
  for await (const entry of Deno.readDir(directory)) {
    const url = new URL(
      `${entry.name}${entry.isDirectory ? "/" : ""}`,
      directory,
    );
    if (entry.isDirectory) found.push(...await testFiles(url));
    else if (entry.name.endsWith("_test.tsx")) found.push(url);
  }
  return found.sort((a, b) => a.href.localeCompare(b.href));
}

async function readConfig(url: URL): Promise<Record<string, unknown>> {
  return JSON.parse(await Deno.readTextFile(url));
}

// 고정 imports와 공통 UI·SDK의 공개 exports를 한 map에 모아 React 중복과 판 충돌을 막는다.
async function importMap(
  configs: readonly URL[],
): Promise<Record<string, string>> {
  const imports: Record<string, string> = {};
  const add = (key: string, value: string) => {
    if (imports[key] !== undefined && imports[key] !== value) {
      throw new Error(`import map conflict for ${key}`);
    }
    imports[key] = value;
  };
  const wording = new URL("wording/", design);
  const sdk = new URL("../sdk/", design);
  const packages = [
    design,
    wording,
    ...["tokens/", "ui-table/", "ui-chart/"].map((path) => new URL(path, sdk)),
  ];
  const files = [
    new URL("deno.json", root),
    ...packages.map((dir) => new URL("deno.json", dir)),
    ...configs,
  ];
  for (const url of files) {
    const config = await readConfig(url);
    for (const [key, value] of Object.entries(config.imports ?? {})) {
      const text = value as string;
      add(key, text.startsWith(".") ? new URL(text, url).href : text);
    }
  }
  for (const directory of packages) {
    const config = await readConfig(new URL("deno.json", directory));
    const name = config.name as string;
    const exports = typeof config.exports === "string"
      ? { ".": config.exports }
      : config.exports as Record<string, string>;
    for (const [key, value] of Object.entries(exports)) {
      add(
        key === "." ? name : `${name}/${key.slice(2)}`,
        new URL(value, directory).href,
      );
    }
  }
  return imports;
}

function componentAssets(imports: Record<string, string>): esbuild.Plugin {
  return {
    name: "component-assets",
    setup(build) {
      build.onResolve({ filter: /\.(css|woff2)$/ }, (args) => {
        const mapped = imports[args.path];
        const base = args.importer.startsWith("file:")
          ? args.importer
          : pathToFileURL(args.importer).href;
        const url = new URL(mapped ?? args.path, base);
        if (url.protocol !== "file:") return undefined;
        return { path: fileURLToPath(url), namespace: "component-asset" };
      });
      build.onLoad(
        { filter: /.*/, namespace: "component-asset" },
        async (args) => ({
          contents: await Deno.readFile(args.path),
          loader: args.path.endsWith(".module.css")
            ? "local-css"
            : args.path.endsWith(".css")
            ? "css"
            : "file",
          resolveDir: dirname(args.path),
        }),
      );
    },
  };
}

async function bundleTests(
  outdir: string,
  files: readonly URL[],
  configs: readonly URL[],
): Promise<{ js: string; css: string }> {
  const configPath = join(outdir, "deno.json");
  const imports = await importMap(configs);
  await Deno.writeTextFile(configPath, JSON.stringify({ imports }));
  const entry = join(outdir, "entry.ts");
  await Deno.writeTextFile(
    entry,
    files.map((file) => `import ${JSON.stringify(file.href)};`).join("\n"),
  );
  try {
    await esbuild.build({
      entryPoints: [entry],
      outdir,
      bundle: true,
      format: "esm",
      jsx: "automatic",
      // act()는 React development build에서만 동작한다.
      define: { "process.env.NODE_ENV": '"development"' },
      logLevel: "error",
      assetNames: "[name]",
      plugins: [
        componentAssets(imports),
        ...(denoPlugins({ configPath }) as esbuild.Plugin[]),
      ],
    });
  } finally {
    await esbuild.stop();
  }
  return { js: join(outdir, "entry.js"), css: join(outdir, "entry.css") };
}

// happy-dom window의 DOM API를 globalThis에 올린다. Deno의 timer·fetch는 그대로 둔다.
// 되돌리는 함수는 잠깐만 DOM이 필요한 build probe가 쓴다.
export function installDom(window: Window): () => void {
  const target = globalThis as Record<string, unknown>;
  const source = window as unknown as Record<string, unknown>;
  const replace = new Set(["Event", "EventTarget", "CustomEvent", "navigator"]);
  const names = new Set<string>();
  for (
    let proto: object | null = window;
    proto && proto !== Object.prototype;
    proto = Object.getPrototypeOf(proto)
  ) {
    for (const name of Object.getOwnPropertyNames(proto)) names.add(name);
  }
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const define = (name: string, value: unknown) => {
    previous.set(name, Object.getOwnPropertyDescriptor(target, name));
    Object.defineProperty(target, name, {
      value,
      configurable: true,
      writable: true,
    });
  };
  for (const name of names) {
    if (name === "constructor" || (name in target && !replace.has(name))) {
      continue;
    }
    const value = source[name];
    define(
      name,
      typeof value === "function" && !("prototype" in value)
        ? (value as (...args: unknown[]) => unknown).bind(window)
        : value,
    );
  }
  define("window", window);
  define("IS_REACT_ACT_ENVIRONMENT", true);
  return () => {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(target, name, descriptor);
      else delete target[name];
    }
  };
}

// 한 process에서 여러 test 파일이 부르면 처음 올린 happy-dom을 같이 쓰고 stylesheet만 더한다.
function sharedDocument(): Document {
  if (!("document" in globalThis)) {
    installDom(new Window({ url: "http://localhost/" }));
  }
  return globalThis.document;
}

export async function registerComponentTests(
  roots: readonly URL[],
  configs: readonly URL[] = [],
): Promise<{ js: string; css: string }> {
  const outdir = await Deno.makeTempDir({ prefix: "design-components-" });
  try {
    const files = (await Promise.all(roots.map(testFiles))).flat();
    const { js, css } = await bundleTests(outdir, files, configs);
    const bundled = {
      js: await Deno.readTextFile(js),
      css: await Deno.readTextFile(css),
    };
    const document = sharedDocument();
    const sheet = document.createElement("style");
    sheet.textContent = [
      await Deno.readTextFile(new URL("generated/tokens.css", design)),
      bundled.css,
    ].join("\n");
    document.head.append(sheet);
    await import(pathToFileURL(js).href);
    return bundled;
  } finally {
    await Deno.remove(outdir, { recursive: true });
  }
}
