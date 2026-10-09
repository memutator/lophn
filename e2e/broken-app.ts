// 깨진 앱 fixture(fixtures/apps/broken)를 실제 shell·core 앱 공간에 띄우는 E2E 공용 조립.
// flow report-app-problem(e2e/flows/report-app-problem_test.ts)과 Issues 화면 시험(e2e/shell/issues-*)이
// 같이 쓴다. fixture source를 commit한 봉인 bundle을 준비하고, ledger에는 등록 transaction이 남기는
// 모양으로 앱·release 행을 심는다. 사람 데이터 root(~/.lophn)는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";

import { prepareFromSource } from "../packages/apps/releases/prepare/from-source.ts";
import { declarationsOfBlueprint } from "../packages/apps/releases/mod.ts";
import {
  devImportMap,
  readTemplateDirectory,
} from "../packages/apps/sdk/mod.ts";
import { installedHome, removeTree } from "../packages/apps/sdk/testing/mod.ts";
import { delay, type FlowShell } from "./flow-support.ts";

export const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
export const RELEASE = "rel_01h455vb4pex5v6nkc6gd5fdw1";
export const VERIFICATION = "vrf_01h455vb4pex5v6nkc6gd5fdw1";
export const DATA_SCHEMA = 3;
export const FIXTURE = new URL("../fixtures/apps/broken/", import.meta.url)
  .pathname;

async function git(cwd: string, args: string[]): Promise<string> {
  const output = await new Deno.Command("git", {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  assert(output.success, new TextDecoder().decode(output.stderr));
  return new TextDecoder().decode(output.stdout).trim();
}

/** fixture source를 commit하고 봉인 bundle로 준비해 `home` 아래에 둔다. 그 blueprint를 돌려준다. */
export async function prepareBrokenApp(
  home: string,
): Promise<{ bundleHash: string; blueprintHash: string; blueprint: string }> {
  const installed = await installedHome();
  const parent = await Deno.makeTempDir({ prefix: "lophn-e2e-broken-src-" });
  try {
    const dir = `${parent}/app`;
    const config = JSON.parse(
      await Deno.readTextFile(`${FIXTURE}/deno.json.tmpl`),
    ) as { imports: Record<string, string> };
    const files = await readTemplateDirectory(FIXTURE, { stripSuffix: true });
    assert(files.ok, files.ok ? "" : files.error.message);
    for (const file of files.value) {
      const target = `${dir}/${file.path}`;
      await Deno.mkdir(target.slice(0, target.lastIndexOf("/")), {
        recursive: true,
      });
      await Deno.writeFile(target, file.bytes);
    }
    await Deno.mkdir(`${dir}/.lophn`);
    await Deno.writeTextFile(
      `${dir}/.lophn/import-map.json`,
      JSON.stringify(devImportMap(config.imports, installed.sdkRoot, dir)),
    );
    await git(dir, ["init", "-q"]);
    await git(dir, ["config", "user.email", "dev@lophn.local"]);
    await git(dir, ["config", "user.name", "dev"]);
    await git(dir, ["add", "-A"]);
    await git(dir, ["commit", "-q", "-m", "init"]);
    const commit = await git(dir, ["rev-parse", "HEAD"]);
    const prepared = await prepareFromSource({
      dataRoot: home,
      app: APP,
      sourceRoot: dir,
      commit,
      sdkRoot: installed.sdkRoot,
    });
    assert(prepared.ok, prepared.ok ? "" : JSON.stringify(prepared.error));
    return {
      bundleHash: prepared.value.bundleHash,
      blueprintHash: prepared.value.blueprintHash,
      blueprint: await Deno.readTextFile(
        `${prepared.value.copyPath}/blueprint.json`,
      ),
    };
  } finally {
    await removeTree(parent);
    await installed.dispose();
  }
}

/** 등록 transaction이 남기는 모양으로 앱·release 행을 심는다(core를 멈춘 동안). */
export function seedLedger(
  home: string,
  bundle: { bundleHash: string; blueprintHash: string; blueprint: string },
): void {
  const blueprint = JSON.parse(bundle.blueprint);
  const declarations = declarationsOfBlueprint(RELEASE, blueprint);
  assert(declarations !== undefined, "선언 사실을 만들지 못했다");
  const db = new DatabaseSync(`${home}/lophn.db`);
  try {
    db.prepare(
      `INSERT INTO apps (id, slug, name, description, planning_version, source_path, active_release, run_enabled, revision, status)
       VALUES (?, 'broken', 'Broken', 'A deliberately broken app', NULL, NULL, ?, 1, '1', 'active')`,
    ).run(APP, RELEASE);
    db.prepare(
      `INSERT INTO releases (id, app, number, code_commit, bundle_hash, blueprint_hash, data_schema, data_changes, ticket_source, created_by, created_at, status, activation, failure, blueprint, declarations)
       VALUES (?, ?, 1, ?, ?, ?, ?, '[]', NULL, 'machine', ?, 'active', NULL, NULL, ?, ?)`,
    ).run(
      RELEASE,
      APP,
      "a".repeat(40),
      bundle.bundleHash,
      bundle.blueprintHash,
      DATA_SCHEMA,
      "2026-10-01T00:00:00.000Z",
      bundle.blueprint,
      JSON.stringify(declarations),
    );
    db.prepare(
      "INSERT INTO release_tests (release, verification) VALUES (?, ?)",
    ).run(RELEASE, VERIFICATION);
  } finally {
    db.close();
  }
}

export type Page = Awaited<ReturnType<FlowShell["shell"]["connect"]>>;

export async function untilPage(
  page: Page,
  expression: string,
  what: string,
  timeoutMs = 30_000,
): Promise<unknown> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      last = await page.evaluate(expression);
    } catch (error) {
      last = String(error);
    }
    if (last) return last;
    await delay(200);
  }
  throw new Error(`${what}: ${JSON.stringify(last)}`);
}

export async function pageClick(page: Page, selector: string): Promise<void> {
  const clicked = await page.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.click();
    return true;
  })()`);
  assertEquals(clicked, true, `누를 요소가 없다: ${selector}`);
}

/** 제어 입력(React)이 알도록 native setter와 input event로 글을 쓴다. */
export async function pageType(
  page: Page,
  selector: string,
  text: string,
): Promise<void> {
  const typed = await page.evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!input) return false;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")
      .set.call(input, ${JSON.stringify(text)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  assertEquals(typed, true, `입력칸이 없다: ${selector}`);
}
