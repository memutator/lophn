// 임시 probe. restore-app-release flow의 app-detail Version 탭이 왜 서지 않는지 본다. 확인 뒤 지운다.
import { DatabaseSync } from "node:sqlite";

import { canonicalize, sha256Hex } from "../../packages/base/mod.ts";

import { declarationsOfBlueprint } from "../../packages/apps/releases/mod.ts";
import { prepareFromSource } from "../../packages/apps/releases/prepare/from-source.ts";
import {
  devImportMap,
  readTemplateDirectory,
} from "../../packages/apps/sdk/mod.ts";
import {
  installedHome,
  removeTree,
} from "../../packages/apps/sdk/testing/mod.ts";
import { e2eEnabled } from "../harness.ts";
import { delay, openFlowShell } from "../flow-support.ts";

const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
const OLDER = "rel_01h455vb4pex5v6nkc6gd5fdw1";
const NEWER = "rel_01h455vb4pex5v6nkc6gd5fdw2";
const FIXTURE = new URL("../../fixtures/apps/todo/", import.meta.url).pathname;

async function git(cwd: string, args: string[]): Promise<string> {
  const output = await new Deno.Command("git", {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) throw new Error(new TextDecoder().decode(output.stderr));
  return new TextDecoder().decode(output.stdout).trim();
}

Deno.test({
  name: "probe restore-app-release",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const home = await Deno.makeTempDir({ prefix: "lophn-probe-restore-" });
    await Deno.chmod(home, 0o700);
    const first = await openFlowShell({ home });
    await first.close();
    const installed = await installedHome(["@lophn/cap-fs"]);
    const parent = await Deno.makeTempDir({ prefix: "lophn-probe-src-" });
    const dir = `${parent}/app`;
    const config = JSON.parse(
      await Deno.readTextFile(`${FIXTURE}/deno.json.tmpl`),
    ) as { imports: Record<string, string> };
    const files = await readTemplateDirectory(FIXTURE, { stripSuffix: true });
    if (!files.ok) throw new Error(files.error.message);
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
    if (!prepared.ok) throw new Error(JSON.stringify(prepared.error));
    const blueprint = await Deno.readTextFile(
      `${prepared.value.copyPath}/blueprint.json`,
    );
    const db = new DatabaseSync(`${home}/lophn.db`);
    db.prepare(
      `INSERT INTO apps (id, slug, name, description, planning_version, source_path, active_release, run_enabled, revision, status)
       VALUES (?, 'todos', 'Todo', 'A todo app', NULL, NULL, ?, 1, '1', 'active')`,
    ).run(APP, NEWER);
    const insert = db.prepare(
      `INSERT INTO releases (id, app, number, code_commit, bundle_hash, blueprint_hash, data_schema, data_changes, ticket_source, created_by, created_at, status, activation, failure, blueprint, declarations)
       VALUES (?, ?, ?, ?, ?, ?, ?, '[]', NULL, 'machine', ?, ?, NULL, NULL, ?, ?)`,
    );
    const declarations = JSON.stringify(
      declarationsOfBlueprint(NEWER, JSON.parse(blueprint)),
    );
    for (
      const [id, number, status] of [
        [OLDER, 1, "superseded"],
        [NEWER, 2, "active"],
      ] as const
    ) {
      insert.run(
        id,
        APP,
        number,
        "a".repeat(40),
        prepared.value.bundleHash,
        prepared.value.blueprintHash,
        2,
        "2026-10-01T00:00:00.000Z",
        status,
        blueprint,
        declarations,
      );
      db.prepare(
        "INSERT INTO release_tests (release, verification) VALUES (?, ?)",
      ).run(id, `vrf_01h455vb4pex5v6nkc6gd5fdw${number}`);
    }
    db.close();
    await removeTree(parent);
    await installed.dispose();

    const flow = await openFlowShell({ home, start: `app:${APP}` });
    try {
      await flow.click('[data-app-bar="app-details"]');
      await delay(5_000);
      const listed = await flow.call({
        kind: "read",
        resource: "releases",
        method: "list",
        body: { app: APP },
      });
      console.log("releases/list:", JSON.stringify(listed).slice(0, 1200));
      const app = await flow.call({
        kind: "read",
        resource: "apps",
        method: "get",
        body: { app: APP },
      });
      console.log("apps/get:", JSON.stringify(app).slice(0, 600));
      const runtime = await flow.call({
        kind: "read",
        resource: "apps",
        method: "runtime",
        body: { app: APP },
      });
      console.log("apps/runtime:", JSON.stringify(runtime).slice(0, 600));
      const previews = await flow.call({
        kind: "read",
        resource: "previews",
        method: "get",
        body: { app: APP },
      });
      console.log("previews/get:", JSON.stringify(previews).slice(0, 400));
      console.log(
        "versions:",
        await flow.count("[data-version]"),
        JSON.stringify(
          await flow.evaluate(
            `JSON.stringify([...document.querySelectorAll("[data-version]")].map((el) => [el.getAttribute("data-version"), el.getAttribute("data-status")]))`,
          ),
        ),
      );
      console.log(
        "panel:",
        String(
          await flow.evaluate(
            `document.querySelector('[data-ops-panel]')?.innerHTML?.slice(0, 3000) ?? "none"`,
          ),
        ),
      );
      // 결정 창 갈래. OLDER를 골라 창이 무엇을 그리는지 본다.
      console.log(
        "versions:",
        JSON.stringify(
          await flow.evaluate(
            `JSON.stringify([...document.querySelectorAll("[data-version]")].map((el) => [el.getAttribute("data-version"), el.getAttribute("data-status"), el.querySelector("[data-use-version]") !== null]))`,
          ),
        ),
      );
      await flow.click(`[data-version="${OLDER}"] [data-version-expand]`);
      await flow.click(`[data-version="${OLDER}"] [data-use-version]`);
      await delay(5_000);
      console.log(
        "windows:",
        JSON.stringify(
          await flow.shell.mainEvaluate(
            `electron.BrowserWindow.getAllWindows().map((w) => w.webContents.getURL())`,
          ),
        ),
      );
      const compare = await flow.call({
        kind: "read",
        resource: "releases",
        method: "compare",
        body: { release: OLDER, previous_release: NEWER },
      });
      console.log("releases/compare:", JSON.stringify(compare).slice(0, 400));
      const approvals = await flow.call({
        kind: "read",
        resource: "approvals",
        method: "list",
        body: {},
      });
      console.log("approvals/list:", JSON.stringify(approvals).slice(0, 600));
      const page = await flow.shell.connect(
        "lophn-shell://confirmation/index.html",
      );
      // main의 appDecisions.prepare를 사람 token으로 그대로 흉내 내 어디서 막히는지 본다.
      const appRead = await flow.call({
        kind: "read",
        resource: "apps",
        method: "get",
        body: { app: APP },
      });
      const previous = (appRead.value as { app: { active_release: string } })
        .app.active_release;
      const grants = await flow.call({
        kind: "read",
        resource: "grants",
        method: "list",
        body: { app: APP },
      });
      const seq = Number((grants.value as { grants_seq: string }).grants_seq);
      const approval = "apr_01h455vb4pex5v6nkc6gd5fdw9";
      const value = {
        release: OLDER,
        approval,
        previous_release: previous,
        expected_grants_seq: seq,
        expected_schema: 2,
        key: approval,
      };
      const basis = {
        concern: "apps/releases",
        command: "release.start_activation",
        caller: "user",
        targets: [OLDER],
        input_hash: await sha256Hex(canonicalize(value)),
        comparison: {},
      };
      const created = await flow.call({
        kind: "command",
        resource: "approvals",
        method: "create",
        body: {
          input: {
            id: approval,
            requester: "user",
            run: null,
            reason: "Requested from the app details.",
            effect: {
              changes: "Changes the exact version.",
              external: null,
              reversible: false,
              reversibility: "Choose another version to switch back.",
            },
            action: {
              ...basis,
              input: { kind: "inline", value },
              binding_hash: await sha256Hex(canonicalize(basis)),
            },
            expires_at: null,
          },
          idempotency_key: `probe:${approval}`,
          compare: {},
          prepared: [],
        },
      });
      console.log("approvals/create:", JSON.stringify(created).slice(0, 500));
      if (created.ok) {
        const got = await flow.call({
          kind: "read",
          resource: "approvals",
          method: "get",
          body: { approval },
        });
        console.log("approvals/get:", JSON.stringify(got).slice(0, 400));
        const text = await flow.call({
          kind: "read",
          resource: "approvals",
          method: "text",
          body: { approval },
        });
        console.log("approvals/text:", JSON.stringify(text).slice(0, 400));
      }
      console.log(
        "display:",
        String(
          await page.evaluate(
            `window.lophnConfirmation.getDisplay().then((v) => JSON.stringify(v)).catch((e) => "ERR " + String(e))`,
          ),
        ).slice(0, 3000),
      );
      // 사람이 허락을 눌러 activation이 어디서 멈추는지 본다.
      await page.evaluate(
        `(() => { const b = document.querySelector('[data-decision="grant_approval_request"]'); if (b) b.click(); return true; })()`,
      );
      for (let i = 0; i < 6; i++) {
        await delay(15_000);
        const release = await flow.call({
          kind: "read",
          resource: "releases",
          method: "get",
          body: { release: OLDER },
        });
        const found = (release.value as {
          release: { status: string; activation: unknown; failure: unknown };
        }).release;
        const runtime = await flow.call({
          kind: "read",
          resource: "apps",
          method: "runtime",
          body: { app: APP },
        });
        const state = (runtime.value as { state: unknown }).state;
        console.log(
          `t=${(i + 1) * 15}s`,
          JSON.stringify({ found, state }),
        );
      }
      for await (const entry of Deno.readDir(`${home}/logs`)) {
        if (!entry.isFile) continue;
        const text = await Deno.readTextFile(`${home}/logs/${entry.name}`);
        console.log(`log ${entry.name}:`, text.slice(-3000));
      }
      for await (const entry of Deno.readDir(`${home}/apps/${APP}/data`)) {
        console.log("data:", entry.name);
      }
    } finally {
      await flow.close();
      await removeTree(home);
    }
  },
});
