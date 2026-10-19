// 재사용 확인. 켜진 release의 code만 센다: source는 working tree가 아니라 active release의 code_commit이다.
// 선언(blueprint)·연결 선언·실제 import·새로 만들지 않음·core가 고정한 사용처를 따로 봐서 어느 단계에서 새는지 보인다.
import { appGet } from "../../../../packages/protocol/apps/mod.ts";
import { appTools } from "../../../../packages/protocol/apps/blueprint/read.ts";
import {
  packagesUsage,
  packagesVersions,
} from "../../../../packages/protocol/apps/mod.ts";
import { releasesGetRecord } from "../../../../packages/protocol/apps/activation/activation.ts";
import type { Core } from "../../../support/core/mod.ts";
import type { CheckOutcome, ProgramCheck } from "../../types.ts";
import { findApp, liveCheck, oneLine } from "./live.ts";

export type ReuseSpec = {
  app: string;
  notify: { app: string; api: string };
  pkg: { name: string; exports: string[] };
};

// packages/core/apps/packages/template/app/blueprint.ts.tmpl의 sdk_dependencies와 같아야 한다.
export const TEMPLATE_SDK_NAMES = [
  "@lophn/blueprint",
  "@lophn/cap-problem",
  "@lophn/cap-tool",
  "@lophn/cap-store",
  "@lophn/ui",
  "@lophn/app-ui",
  "@lophn/wording",
];

// blueprint.ts의 `sdk_dependencies: [ ... ]` 블록에서 `name: "..."`들을 뽑는다.
export function blueprintSdkNames(text: string): string[] {
  const key = text.indexOf("sdk_dependencies");
  const open = key === -1 ? -1 : text.indexOf("[", key);
  if (open === -1) return [];
  let depth = 0;
  let close = text.length;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "[") depth++;
    else if (text[i] === "]" && --depth === 0) {
      close = i;
      break;
    }
  }
  return [...text.slice(open, close).matchAll(/\bname:\s*["']([^"']+)["']/g)]
    .map((m) => m[1]!);
}

const escapeRe = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");

// 한 줄이 패키지를 import하는 줄인가. 의존 선언(`{ name: "..." }`), 주석, 문자열은 아니다.
// 여러 줄 import의 마지막 줄(`} from "..."`)과 `import("...")`, `from "name/sub"`는 import다.
export function importsPackage(line: string, name: string): boolean {
  if (/^\s*(\/\/|\/\*|\*)/.test(line)) return false;
  const spec = `["']${escapeRe(name)}(?:/[^"']*)?["']`;
  return new RegExp(`^\\s*(?:(?:import|export)\\b.*?|\\}\\s*)from\\s*${spec}`)
    .test(line) ||
    new RegExp(`^\\s*import\\s*${spec}`).test(line) ||
    new RegExp(`\\bimport\\(\\s*${spec}\\s*\\)`).test(line);
}

// 한 줄이 name을 정의하는 줄인가. `import { name }`은 정의가 아니다.
export function definesName(line: string, name: string): boolean {
  return new RegExp(
    `^\\s*(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?` +
      `(?:function\\s*\\*\\s*|function\\s+|const\\s+|let\\s+|var\\s+|class\\s+|type\\s+|interface\\s+|enum\\s+)` +
      `${escapeRe(name)}(?![\\w$])`,
  ).test(line);
}

async function git(dir: string, args: string[]): Promise<string> {
  const out = await new Deno.Command("git", {
    args: ["-C", dir, ...args],
    stdout: "piped",
    stderr: "piped",
  }).output();
  const text = new TextDecoder().decode(out.stdout);
  // git grep은 일치가 없으면 1로 끝난다.
  if (out.code !== 0 && !(args[0] === "grep" && out.code === 1)) {
    throw new Error(
      `git ${args[0]}: ${oneLine(new TextDecoder().decode(out.stderr), 200)}`,
    );
  }
  return text;
}

type Hit = { path: string; line: number; text: string };

async function grep(
  dir: string,
  commit: string,
  needle: string,
  paths: string[],
): Promise<Hit[]> {
  const out = await git(dir, [
    "grep",
    "-n",
    "-I",
    "-F",
    "-e",
    needle,
    commit,
    "--",
    ...paths,
  ]);
  return out.split("\n").flatMap((raw) => {
    const m = raw.slice(commit.length + 1).match(/^(.*?):(\d+):(.*)$/);
    return m === null ? [] : [{ path: m[1]!, line: Number(m[2]), text: m[3]! }];
  });
}

async function grepFiles(
  dir: string,
  commit: string,
  needle: string,
): Promise<Set<string>> {
  const out = await git(dir, ["grep", "-l", "-I", "-F", "-e", needle, commit]);
  return new Set(
    out.split("\n").filter((l) => l !== "").map((l) =>
      l.slice(commit.length + 1)
    ),
  );
}

const isTest = (path: string) => path.endsWith("_test.ts");

async function source(core: Core, name: string) {
  const app = await findApp(core, name);
  const { app: got } = await core.call(appGet, { app: app.id });
  if (got.active_release === null || got.source_path === null) {
    throw new Error("active release나 source가 없음");
  }
  const { release } = await core.call(releasesGetRecord, {
    release: got.active_release,
  });
  if (release === null) throw new Error("release 기록 없음");
  return {
    app: got,
    release: got.active_release,
    dir: got.source_path,
    commit: release.code_commit,
  };
}

function reuseCheck(
  id: string,
  spec: ReuseSpec,
  run: (
    core: Core,
    src: Awaited<ReturnType<typeof source>>,
  ) => Promise<CheckOutcome>,
): ProgramCheck {
  return liveCheck(id, async (core) => run(core, await source(core, spec.app)));
}

export function reuseChecks(spec: ReuseSpec): ProgramCheck[] {
  const { pkg, notify } = spec;
  return [
    reuseCheck("reuse-sdk-dependency", spec, async (_core, src) => {
      const names = blueprintSdkNames(
        await git(src.dir, ["show", `${src.commit}:blueprint.ts`]),
      );
      const extra = names.filter((n) => !TEMPLATE_SDK_NAMES.includes(n));
      return {
        pass: extra.includes(pkg.name),
        reason: `template 밖 의존: ${
          extra.join(", ") || "없음"
        } (기대 ${pkg.name})`,
      };
    }),
    reuseCheck("reuse-app-connection", spec, async (core, src) => {
      const target = await findApp(core, notify.app);
      const blueprint = await core.call(appTools, { app: src.app.id });
      const hit = blueprint.declarations.app_connections.some((c) =>
        c.app === target.id && c.tools.includes(notify.api)
      );
      return {
        pass: hit,
        reason: hit
          ? `${notify.app}의 ${notify.api} 연결을 선언함`
          : `${notify.app}의 ${notify.api} 연결 선언이 없음`,
      };
    }),
    // 의존만 걸고 안 쓰면 떨어진다.
    reuseCheck("reuse-imports", spec, async (_core, src) => {
      const lines = await grep(src.dir, src.commit, pkg.name, [
        ".",
        ":(exclude)blueprint.ts",
        ":(exclude)deno.json",
        ":(exclude)deno.lock",
        ":(exclude)tests",
      ]);
      const importing = lines.filter((h) =>
        !isTest(h.path) && importsPackage(h.text, pkg.name)
      );
      const connecting = await grepFiles(src.dir, src.commit, "connectTools");
      const naming = await grepFiles(src.dir, src.commit, notify.api);
      const calling = [...connecting].filter((f) =>
        naming.has(f) && !isTest(f)
      );
      const pass = importing.length > 0 && calling.length > 0;
      return {
        pass,
        reason:
          `${pkg.name} import ${importing.length}줄, ${notify.api} 호출 file ${calling.length}개`,
      };
    }),
    reuseCheck("reuse-no-recreate", spec, async (_core, src) => {
      const defined: string[] = [];
      for (const name of pkg.exports) {
        for (const h of await grep(src.dir, src.commit, name, ["src"])) {
          if (definesName(h.text, name)) {
            defined.push(`${h.path}:${h.line} ${name}`);
          }
        }
      }
      return {
        pass: defined.length === 0,
        reason: defined.length === 0
          ? "package의 export를 다시 정의하지 않음"
          : `다시 정의함: ${defined.join(", ")}`,
      };
    }),
    reuseCheck("reuse-usage", spec, async (core, src) => {
      const { versions } = await core.call(packagesVersions, {
        name: pkg.name,
      });
      const last = versions.at(-1);
      if (last === undefined) {
        return { pass: false, reason: `${pkg.name}의 version이 없음` };
      }
      const { usages } = await core.call(packagesUsage, {
        name: pkg.name,
        version: last.version,
      });
      const hit = usages.some((u) =>
        u.app === src.app.id && u.release === src.release
      );
      return {
        pass: hit,
        reason:
          `${pkg.name}@${last.version} 사용처 ${usages.length}개 중 이 앱의 active release ${
            hit ? "있음" : "없음"
          }`,
      };
    }),
  ];
}
