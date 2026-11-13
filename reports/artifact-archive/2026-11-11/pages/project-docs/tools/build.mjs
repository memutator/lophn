// 실행: node tools/build.mjs  (artifact 폴더 어디서 불러도 된다)
// 저장소 project-docs의 이슈·journey·scenario와 wireframes gallery의 화면 목록을 읽어 data/latest.json 하나로 쓴다.
// 저장소는 읽기만 한다.
import { createRequire } from "node:module";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "/home/pyosechang/projects/lophn";
const DOCS = join(REPO, "project-docs");
const WIREFRAMES = join(REPO, "tools/wireframes");
const ARTIFACT = dirname(dirname(fileURLToPath(import.meta.url)));

const require = createRequire(join(REPO, "package.json"));
const YAML = require("yaml");
const esbuild = require("esbuild");

async function yamlFiles(dir) {
  const names = (await readdir(dir)).filter((n) => n.endsWith(".yaml")).sort();
  return Promise.all(
    names.map(async (n) => ({ name: n, doc: YAML.parse(await readFile(join(dir, n), "utf8")) })),
  );
}

const text = (v) => (typeof v === "string" ? v.trim() : undefined);

// 이슈
const issues = (await yamlFiles(join(DOCS, "issues"))).map(({ doc }) => ({
  id: doc.id,
  title: doc.title,
  status: doc.status,
  kind: doc.kind,
  topic: doc.topic,
  now: text(doc.now),
  impact: text(doc.impact),
  fix: text(doc.fix),
  decide: text(doc.decide),
  closed: text(doc.closed),
}));

// journey
const journeyGroups = (await yamlFiles(join(DOCS, "flows/journeys"))).map(({ doc }) => ({
  group: doc.group,
  journeys: (doc.journeys ?? []).map((j) => ({
    id: j.id,
    title: j.title,
    actor: j.actor,
    goal: j.goal,
    steps: (j.steps ?? []).map((s) => ({ do: s.do, screen: s.screen ?? null })),
    gaps: j.gaps ?? [],
  })),
}));

// scenario
const scenarioGroups = (await yamlFiles(join(DOCS, "flows/scenarios"))).map(({ doc }) => ({
  group: doc.group,
  scenarios: (doc.scenarios ?? []).map((s) => ({
    id: s.id,
    who: s.who,
    situation: s.situation,
    says: s.says ?? [],
    has: s.has,
    expects: s.expects,
    journeys: s.journeys ?? [],
    edges: s.edges ?? [],
  })),
}));

// gallery 화면 목록: pages/index.ts를 node용으로 묶어 GROUPS를 읽는다(CSS·글꼴은 비운다).
async function galleryPages() {
  const stub = {
    name: "stub",
    setup(b) {
      b.onLoad({ filter: /\.module\.css$/ }, () => ({
        contents: "export default new Proxy({}, { get: (_t, k) => String(k) })",
        loader: "js",
      }));
      b.onLoad({ filter: /\.(css|woff2?|ttf|eot|png)$/ }, () => ({
        contents: "export default ''",
        loader: "js",
      }));
    },
  };
  try {
    const result = await esbuild.build({
      absWorkingDir: WIREFRAMES,
      stdin: {
        contents: `export { GROUPS } from "./pages/index.ts";`,
        resolveDir: WIREFRAMES,
        loader: "ts",
      },
      bundle: true,
      write: false,
      format: "esm",
      platform: "node",
      jsx: "automatic",
      logLevel: "error",
      loader: { ".svg": "text" },
      define: { "process.env.NODE_ENV": '"production"' },
      plugins: [stub],
    });
    const code = result.outputFiles[0].text;
    const mod = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
    return mod.GROUPS.map((g) => ({
      id: g.id,
      title: g.title,
      summary: g.summary,
      areas: g.areas.map((a) => ({
        id: a.id,
        title: a.title,
        summary: a.summary,
        pages: a.pages.map((p) => ({ id: p.id, title: p.title, description: p.description })),
      })),
    }));
  } finally {
    await esbuild.stop();
  }
}
const gallery = await galleryPages();

const data = {
  collectedAt: new Date().toISOString(),
  issues,
  journeyGroups,
  scenarioGroups,
  gallery,
};
await mkdir(join(ARTIFACT, "data"), { recursive: true });
const out = JSON.stringify(data);
await writeFile(join(ARTIFACT, "data/latest.json"), out);
const pages = gallery.flatMap((g) => g.areas.flatMap((a) => a.pages)).length;
console.log(
  `issues ${issues.length}, journeys ${journeyGroups.flatMap((g) => g.journeys).length}, scenarios ${scenarioGroups.flatMap((g) => g.scenarios).length}, gallery pages ${pages}, ${(out.length / 1024).toFixed(0)} KiB`,
);
