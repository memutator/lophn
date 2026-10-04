// Deno는 CSS Modules를 직접 읽지 못한다. components/의 *_test.tsx를 renderer와 같은
// esbuild local-css loader로 한 bundle에 묶고(React 한 벌), happy-dom 위에서 그 bundle을
// 불러 test를 등록한다. 이 파일이 import되는 동안 등록하므로 test 이름은 원본 그대로다.
import { assert, assertEquals } from "@std/assert";
import * as esbuild from "esbuild";
import { denoPlugins } from "@luca/esbuild-deno-loader";
import { Window } from "happy-dom";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const design = new URL("./", import.meta.url);
const components = new URL("./components/", design);
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

// workspace root·design·wording의 고정 import와 wording 이름을 한 map으로 합친다.
async function importMap(): Promise<Record<string, string>> {
  const imports: Record<string, string> = {};
  const add = (key: string, value: string) => {
    if (imports[key] !== undefined && imports[key] !== value) {
      throw new Error(`import map conflict for ${key}`);
    }
    imports[key] = value;
  };
  const wording = new URL("wording/", design);
  for (
    const url of [new URL("deno.json", root), new URL("deno.json", design)]
  ) {
    const config = await readConfig(url);
    for (const [key, value] of Object.entries(config.imports ?? {})) {
      add(key, value as string);
    }
  }
  const wordingConfig = await readConfig(new URL("deno.json", wording));
  for (const [key, value] of Object.entries(wordingConfig.imports ?? {})) {
    add(key, value as string);
  }
  for (
    const [key, value] of Object.entries(
      wordingConfig.exports as Record<string, string>,
    )
  ) {
    const name = wordingConfig.name as string;
    add(
      key === "." ? name : `${name}/${key.slice(2)}`,
      new URL(value, wording).href,
    );
  }
  return imports;
}

function cssModules(): esbuild.Plugin {
  return {
    name: "component-css",
    setup(build) {
      build.onResolve({ filter: /\.css$/ }, (args) => {
        const base = args.importer.startsWith("file:")
          ? args.importer
          : pathToFileURL(args.importer).href;
        const path = fileURLToPath(new URL(args.path, base));
        return { path, namespace: "component-css" };
      });
      build.onLoad(
        { filter: /.*/, namespace: "component-css" },
        async (args) => ({
          contents: await Deno.readTextFile(args.path),
          loader: args.path.endsWith(".module.css") ? "local-css" : "css",
          resolveDir: dirname(args.path),
        }),
      );
    },
  };
}

async function bundleTests(
  outdir: string,
  files: readonly URL[],
): Promise<{ js: string; css: string }> {
  const configPath = join(outdir, "deno.json");
  await Deno.writeTextFile(
    configPath,
    JSON.stringify({ imports: await importMap() }),
  );
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
      plugins: [
        cssModules(),
        ...(denoPlugins({ configPath }) as esbuild.Plugin[]),
      ],
    });
  } finally {
    await esbuild.stop();
  }
  return { js: join(outdir, "entry.js"), css: join(outdir, "entry.css") };
}

// happy-dom window의 DOM API를 globalThis에 올린다. Deno의 timer·fetch는 그대로 둔다.
function installDom(window: Window): void {
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
  for (const name of names) {
    if (name === "constructor" || (name in target && !replace.has(name))) {
      continue;
    }
    const value = source[name];
    const bound = typeof value === "function" && !("prototype" in value)
      ? (value as (...args: unknown[]) => unknown).bind(window)
      : value;
    Object.defineProperty(target, name, {
      value: bound,
      configurable: true,
      writable: true,
    });
  }
  target.window = window;
  target.IS_REACT_ACT_ENVIRONMENT = true;
}

const outdir = await Deno.makeTempDir({ prefix: "design-components-" });
let bundled = { js: "", css: "" };
try {
  const { js, css } = await bundleTests(outdir, await testFiles(components));
  bundled = {
    js: await Deno.readTextFile(js),
    css: await Deno.readTextFile(css),
  };
  const window = new Window({ url: "http://localhost/" });
  installDom(window);
  const sheet = window.document.createElement("style");
  sheet.textContent = [
    await Deno.readTextFile(new URL("generated/tokens.css", design)),
    bundled.css,
  ].join("\n");
  window.document.head.append(sheet);
  await import(pathToFileURL(js).href);
} finally {
  await Deno.remove(outdir, { recursive: true });
}

Deno.test("shell/design-system#R43: 컴포넌트 test bundle은 React 한 벌과 scope된 CSS Modules class map을 쓴다", () => {
  const react = bundled.js.match(
    /exports\.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE =/g,
  );
  assertEquals(react?.length, 1);
  const scoped = bundled.css.match(/^\.(button_[A-Za-z]+)/m)?.[1];
  assert(scoped && scoped !== "button", "button class is not scoped");
  assert(bundled.js.includes(`"${scoped}"`), "class map is missing");
  assert(!/^\.button\s*\{/m.test(bundled.css));
});
