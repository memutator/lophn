// 실행: node tools/build-wireframes.mjs  (artifact 폴더 어디서 불러도 된다)
// 저장소 tools/wireframes gallery를 minified bundle로 이 artifact의 gallery/ 폴더에 짓는다.
// 저장소는 읽기만 한다(tools/wireframes/dist도 건드리지 않는다). 설정은 tools/wireframes/build.ts와 같고
// 다른 점: minify, production React, 그리고 파일 하나가 4 MiB를 넘지 않게 무거운 library를 따로 chunk로 뺀다
// (esbuild splitting은 entry 둘이 함께 쓰는 module을 공유 chunk로 내므로, 무거운 module을 entry로 더한다).
import { createRequire } from "node:module";
import { readFile, readdir, rm, stat, copyFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "/home/pyosechang/projects/lophn";
const HERE = join(REPO, "tools/wireframes");
const ARTIFACT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ARTIFACT, "gallery");
const LIMIT = 4 * 1024 * 1024;

const require = createRequire(join(REPO, "package.json"));
const esbuild = require("esbuild");

// main.js에서 떼어 낼 무거운 module. 각자 공유 chunk가 된다.
const SPLIT = [
  "@xterm/xterm",
  "@xterm/addon-webgl",
  "katex",
  "@codemirror/view",
  "@codemirror/state",
  "react-dom/client",
  "zod",
  "@iconify-json/catppuccin/icons.json",
  "@codemirror/language",
  "@codemirror/commands",
  "@lezer/javascript",
  "@lezer/markdown",
  "@xterm/addon-unicode11",
];

const assetPlugin = {
  name: "wireframes-assets",
  setup(build) {
    build.onLoad({ filter: /\.(css|woff2?|ttf|eot|svg)$/ }, async (args) => {
      if (args.namespace !== "file") return undefined;
      const loader = args.path.endsWith(".svg")
        ? "text"
        : args.path.endsWith(".module.css")
          ? "local-css"
          : args.path.endsWith(".css")
            ? "css"
            : "file";
      return { contents: await readFile(args.path), loader, resolveDir: dirname(args.path) };
    });
  },
};

const resolveFrom = createRequire(join(HERE, "main.tsx"));
const extra = [];
for (const name of SPLIT) {
  try {
    extra.push({ in: resolveFrom.resolve(name), out: `lib/${name.replace(/[@/]/g, "_")}` });
  } catch {
    // 그 library가 더는 없으면 그냥 넘어간다.
  }
}

await rm(OUT, { recursive: true, force: true });
try {
  await esbuild.build({
    absWorkingDir: HERE,
    entryPoints: [{ in: join(HERE, "main.tsx"), out: "main" }, ...extra],
    outdir: OUT,
    bundle: true,
    format: "esm",
    splitting: true,
    chunkNames: "chunks/[name]-[hash]",
    jsx: "automatic",
    assetNames: "[name]",
    legalComments: "external",
    minify: true,
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "error",
    plugins: [assetPlugin],
  });
  await copyFile(join(HERE, "index.html"), join(OUT, "index.html"));
} finally {
  await esbuild.stop();
}

async function* files(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else yield path;
  }
}
let total = 0;
let largest = { path: "", size: 0 };
const over = [];
for await (const path of files(OUT)) {
  const { size } = await stat(path);
  total += size;
  if (size > largest.size) largest = { path: relative(OUT, path), size };
  if (size > LIMIT) over.push(`${relative(OUT, path)} ${size}`);
}
console.log(`gallery: ${(total / 1048576).toFixed(1)} MiB, largest ${largest.path} ${(largest.size / 1048576).toFixed(2)} MiB`);
if (over.length > 0) {
  console.error(`over 4 MiB:\n${over.join("\n")}\nSPLIT 목록에 무거운 module을 더한다.`);
  process.exit(1);
}
