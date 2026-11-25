import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PRODUCT_FLOOR_RULES } from "../../../../protocol/approvals/mod.ts";
import { evaluatePermission } from "../../../approvals/gate/judge.ts";
import { createFileTools } from "../bundles/file.ts";
import type { ToolContext } from "../tool-context.ts";
import { classifyFilePath, type Mode, resolveInWorkspace } from "./scope.ts";
import { grepFiles } from "./search.ts";

test("file tool은 workspace 폴더 밖과 밖으로 나가는 symlink를 거절한다", async (t) => {
  const temp = await mkdtemp(join(tmpdir(), "lophn-scope-"));
  try {
    const workspace = join(temp, "workspace");
    const outside = join(temp, "outside");
    await mkdir(join(workspace, "sub"), { recursive: true });
    await mkdir(outside);
    await writeFile(join(workspace, "inside.txt"), "in");
    await writeFile(join(outside, "secret.txt"), "out");
    // symlink는 Windows에서 개발자 모드나 관리자 권한이 있어야 만들어진다. 없으면 건너뛴다.
    try {
      await symlink(outside, join(workspace, "link"));
    } catch (thrown) {
      if (process.platform !== "win32") throw thrown;
      return t.skip("Windows에서 symlink 권한이 없다(개발자 모드 꺼짐)");
    }
    await symlink(join(outside, "secret.txt"), join(workspace, "linkfile"));
    await symlink(join(outside, "missing"), join(workspace, "dangling"));
    await symlink(join(workspace, "inside.txt"), join(workspace, "same"));

    const roots = { read: [workspace], write: [workspace] };
    const cases: [string, string, Mode, boolean][] = [
      ["상대 경로", "inside.txt", "read", true],
      ["새 파일", "sub/new.txt", "write", true],
      ["없는 폴더 아래 새 파일", "a/b/new.txt", "write", true],
      ["안쪽 절대 경로", join(workspace, "inside.txt"), "read", true],
      ["폴더 안을 가리키는 symlink", "same", "read", true],
      ["..로 나감", "../outside/secret.txt", "read", false],
      [
        "안에서 ..로 나갔다 들어옴",
        "sub/../../outside/secret.txt",
        "read",
        false,
      ],
      ["바깥 절대 경로", join(outside, "secret.txt"), "read", false],
      ["밖을 가리키는 폴더 symlink", "link/secret.txt", "read", false],
      [
        "밖을 가리키는 폴더 symlink 아래 새 파일",
        "link/new.txt",
        "write",
        false,
      ],
      ["밖을 가리키는 파일 symlink", "linkfile", "write", false],
      ["끊어진 symlink에 쓰기", "dangling", "write", false],
    ];
    for (const [name, path, mode, allowed] of cases) {
      const resolved = await resolveInWorkspace(roots, path, mode);
      assert.equal(resolved.ok, allowed, name);
      if (!resolved.ok) assert.equal(resolved.error.code, "forbidden", name);
    }

    // 읽기만 열린 workspace(lophn)는 쓰기를 거절한다.
    const readOnly = { read: [workspace], write: [] };
    assert.equal(
      (await resolveInWorkspace(readOnly, "inside.txt", "read")).ok,
      true,
    );
    assert.equal(
      (await resolveInWorkspace(readOnly, "inside.txt", "write")).ok,
      false,
    );

    // 폴더 없는 project workspace의 session: 상대 경로는 base(project의 data 폴더)에서 풀리고 base 자체는 허락이 아니다.
    const data = join(temp, "projects", "prj_a");
    await mkdir(join(data, "skills"), { recursive: true });
    const noFolder = {
      read: [join(data, "skills"), join(data, "kinds.yaml")],
      write: [join(data, "skills"), join(data, "kinds.yaml")],
      base: data,
    };
    const skill = await resolveInWorkspace(
      noFolder,
      "skills/x/SKILL.md",
      "write",
    );
    assert.deepStrictEqual(
      skill.ok && skill.value.path,
      join(await realpath(data), "skills", "x", "SKILL.md"),
    );
    const kindsFile = await resolveInWorkspace(noFolder, "kinds.yaml", "write");
    assert.deepStrictEqual(
      kindsFile.ok && kindsFile.value.path,
      join(await realpath(data), "kinds.yaml"),
    );
    assert.equal(
      (await resolveInWorkspace(noFolder, "other.md", "write")).ok,
      false,
    );
  } finally {
    await rm(temp, { recursive: true });
  }
});

test("파일 entry는 그 파일(아직 없는 파일 포함)만 열고 같은 폴더의 다른 파일과 하위 경로는 거절한다", async () => {
  const temp = await mkdtemp(join(tmpdir(), "lophn-scope-"));
  try {
    const project = join(temp, "projects", "p");
    await mkdir(project, { recursive: true });
    await writeFile(join(project, "extensions.json"), "{}");
    const kinds = join(project, "kinds.yaml");
    const cases: [string, string, boolean][] = [
      ["아직 없는 파일", kinds, true],
      ["같은 폴더의 다른 파일", join(project, "extensions.json"), false],
      ["같은 폴더의 새 파일", join(project, "other.yaml"), false],
      ["파일 아래 경로", join(kinds, "x"), false],
      ["밖", join(temp, "kinds.yaml"), false],
    ];
    for (const mode of ["read", "write"] as const) {
      for (const [name, path, allowed] of cases) {
        const resolved = await resolveInWorkspace(
          { read: [kinds], write: [kinds] },
          path,
          mode,
        );
        assert.equal(resolved.ok, allowed, `${mode} ${name}`);
      }
    }

    // 있는 파일이 되어도 root는 부모 폴더, relative는 파일 이름이다(rewind 기록이 쓴다).
    await writeFile(kinds, "kinds: []");
    const resolved = await resolveInWorkspace(
      { read: [kinds], write: [kinds] },
      kinds,
      "write",
    );
    assert.deepStrictEqual(
      resolved.ok && [resolved.value.root, resolved.value.relative],
      [await realpath(project), "kinds.yaml"],
    );
  } finally {
    await rm(temp, { recursive: true });
  }
});

test("session은 자기 tool-results 폴더만 읽고 쓰지 못하며 data root의 나머지는 거절한다", async (t) => {
  const temp = await mkdtemp(join(tmpdir(), "lophn-scope-"));
  try {
    const root = join(temp, "data");
    const workspace = join(temp, "workspace");
    await mkdir(join(root, "tool-results", "ses_other"), { recursive: true });
    await mkdir(join(root, "tool-results", "ses_me"));
    await mkdir(workspace);
    await writeFile(join(root, "tool-results", "ses_me", "tcl_1.json"), "{}");
    await writeFile(
      join(root, "tool-results", "ses_other", "tcl_2.json"),
      "{}",
    );
    await writeFile(join(root, "secrets.json"), "{}");
    // symlink는 Windows에서 개발자 모드나 관리자 권한이 있어야 만들어진다. 없으면 건너뛴다.
    try {
      await symlink(
        join(root, "secrets.json"),
        join(root, "tool-results", "ses_me", "link.json"),
      );
    } catch (thrown) {
      if (process.platform !== "win32") throw thrown;
      return t.skip("Windows에서 symlink 권한이 없다(개발자 모드 꺼짐)");
    }
    const mine = join(root, "tool-results", "ses_me");
    const roots = {
      read: [workspace],
      write: [workspace],
      base: workspace,
      results: mine,
    };

    const cases: [string, string, Mode, boolean][] = [
      ["자기 파일 읽기", join(mine, "tcl_1.json"), "read", true],
      ["자기 폴더 읽기", mine, "read", true],
      ["없는 자기 파일", join(mine, "tcl_9.json"), "read", true],
      ["자기 파일 쓰기", join(mine, "tcl_1.json"), "write", false],
      ["자기 폴더에 새 파일 쓰기", join(mine, "new.json"), "write", false],
      [
        "다른 session의 파일",
        join(root, "tool-results", "ses_other", "tcl_2.json"),
        "read",
        false,
      ],
      ["tool-results 폴더", join(root, "tool-results"), "read", false],
      ["data root의 다른 파일", join(root, "secrets.json"), "read", false],
      [
        "..로 다른 session",
        join(mine, "..", "ses_other", "tcl_2.json"),
        "read",
        false,
      ],
      ["밖을 가리키는 symlink", join(mine, "link.json"), "read", false],
    ];
    for (const [name, path, mode, allowed] of cases) {
      const resolved = await resolveInWorkspace(roots, path, mode);
      assert.equal(resolved.ok, allowed, name);
      if (!resolved.ok) assert.equal(resolved.error.code, "forbidden", name);
    }

    // 첫 spill 전에는 폴더가 없다. 읽기는 forbidden이 아니라 파일이 없는 것(not_found)이어야 한다.
    const fresh = join(temp, "fresh", "tool-results", "ses_new");
    const before = await resolveInWorkspace(
      {
        read: [workspace],
        write: [workspace],
        base: workspace,
        results: fresh,
      },
      join(fresh, "tcl_1.json"),
      "read",
    );
    assert.equal(before.ok, true);

    // 폴더 없는 home: results만 있어도 상대 경로는 풀리지 않고(base 없음) 절대 경로 읽기만 열린다.
    const home = { read: [], write: [], results: mine };
    assert.equal(
      (await resolveInWorkspace(home, "tcl_1.json", "read")).ok,
      false,
    );
    assert.equal(
      (await resolveInWorkspace(home, join(mine, "tcl_1.json"), "read")).ok,
      true,
    );
    assert.equal(
      (await resolveInWorkspace(home, join(mine, "tcl_1.json"), "write")).ok,
      false,
    );
  } finally {
    await rm(temp, { recursive: true });
  }
});

test("classifyFilePath는 바깥 경로, 자기 보호 경로, 민감 workspace 경로를 정확히 분류하고 onceTarget을 허용한다", async () => {
  const temp = await mkdtemp(join(tmpdir(), "lophn-classify-"));
  try {
    const workspace = join(temp, "workspace");
    const outside = join(temp, "outside");
    const fakeHome = join(temp, "home");
    const fakeDataRoot = join(temp, "lophn-data");
    await mkdir(join(workspace, ".git", "hooks"), { recursive: true });
    await mkdir(join(workspace, ".lophn", "tools"), { recursive: true });
    await mkdir(outside, { recursive: true });
    await mkdir(join(fakeHome, ".ssh"), { recursive: true });
    await mkdir(join(fakeHome, ".aws"), { recursive: true });
    await mkdir(join(fakeHome, ".gnupg"), { recursive: true });
    await mkdir(join(fakeDataRoot, "agents"), { recursive: true });
    await writeFile(join(workspace, "app.ts"), "export {};\n");
    await writeFile(join(workspace, ".env"), "SECRET=1\n");
    await writeFile(join(workspace, ".env.local"), "SECRET=2\n");
    await writeFile(join(workspace, ".env.example"), "SECRET=\n");
    await writeFile(join(workspace, ".env.sample"), "SECRET=\n");
    await writeFile(join(outside, "note.txt"), "hello\n");
    await writeFile(join(fakeHome, ".ssh", "id_ed25519"), "key\n");
    await writeFile(join(fakeDataRoot, "settings.json"), "{}\n");
    await writeFile(join(fakeDataRoot, "secrets.json"), "{}\n");
    await writeFile(join(fakeDataRoot, "agents", "lophn_home.md"), "# hi\n");

    const roots = { read: [workspace], write: [workspace] };
    const opts = { homeDir: fakeHome, dataRoot: fakeDataRoot };

    // 일반 workspace 파일
    const normalRead = await classifyFilePath(roots, "app.ts", "read", opts);
    assert.equal(normalRead.outsideWorkspace, false);
    assert.equal(normalRead.sensitive, false);
    assert.equal(normalRead.selfProtection, false);

    // .env* 읽기는 민감, .env.example / .env.sample은 제외
    const envRead = await classifyFilePath(roots, ".env", "read", opts);
    assert.equal(envRead.outsideWorkspace, false);
    assert.equal(envRead.sensitive, true);
    assert.equal(envRead.selfProtection, false);

    const envLocal = await classifyFilePath(roots, ".env.local", "read", opts);
    assert.equal(envLocal.sensitive, true);

    const envExample = await classifyFilePath(
      roots,
      ".env.example",
      "read",
      opts,
    );
    assert.equal(envExample.sensitive, false);

    const envSample = await classifyFilePath(
      roots,
      ".env.sample",
      "read",
      opts,
    );
    assert.equal(envSample.sensitive, false);

    // workspace 민감 쓰기: .git/hooks/*, .git/config, .lophn/tools/*
    for (const rel of [
      ".git/hooks/pre-commit",
      ".git/config",
      ".lophn/tools/run.ts",
    ]) {
      const c = await classifyFilePath(roots, rel, "write", opts);
      assert.equal(c.outsideWorkspace, false, rel);
      assert.equal(c.sensitive, true, rel);
      assert.equal(c.selfProtection, false, rel);
    }

    // 바깥 일반 폴더
    const outRead = await classifyFilePath(
      roots,
      join(outside, "note.txt"),
      "read",
      opts,
    );
    assert.equal(outRead.outsideWorkspace, true);
    assert.equal(outRead.sensitive, false);
    assert.equal(outRead.folder, await realpath(outside));

    // 자기 보호 경로 (~/.ssh, ~/.aws, ~/.gnupg, data root 설정·agent·secret)
    for (const target of [
      join(fakeHome, ".ssh", "id_ed25519"),
      join(fakeHome, ".aws", "credentials"),
      join(fakeHome, ".gnupg", "secring.gpg"),
      join(fakeDataRoot, "settings.json"),
      join(fakeDataRoot, "secrets.json"),
      join(fakeDataRoot, "secrets"),
      join(fakeDataRoot, "secrets.bak"),
      join(fakeDataRoot, "agents", "lophn_home.md"),
    ]) {
      const c = await classifyFilePath(roots, target, "write", opts);
      assert.equal(c.selfProtection, true, target);
      assert.equal(c.sensitive, true, target);
    }

    // data root 읽기: secrets*만 자기 보호(sensitive)이고 settings.json·agents/*는 바깥 일반 읽기로 분류한다.
    for (const target of [
      join(fakeDataRoot, "secrets.json"),
      join(fakeDataRoot, "secrets"),
      join(fakeDataRoot, "secrets.bak"),
    ]) {
      const c = await classifyFilePath(roots, target, "read", opts);
      assert.equal(c.selfProtection, true, `read ${target}`);
      assert.equal(c.sensitive, true, `read ${target}`);
    }
    for (const target of [
      join(fakeDataRoot, "settings.json"),
      join(fakeDataRoot, "agents", "lophn_home.md"),
    ]) {
      const c = await classifyFilePath(roots, target, "read", opts);
      assert.equal(c.outsideWorkspace, true, `read ${target}`);
      assert.equal(c.selfProtection, false, `read ${target}`);
      assert.equal(c.sensitive, false, `read ${target}`);
    }

    // onceTarget으로 승인된 바깥 파일은 resolveInWorkspace가 정확히 그 파일만 연다
    const notePath = await realpath(join(outside, "note.txt"));
    const noteFolder = await realpath(outside);
    const withOnce = {
      ...roots,
      onceTarget: {
        path: notePath,
        folder: noteFolder,
        mode: "read" as const,
      },
    };
    const okNote = await resolveInWorkspace(withOnce, notePath, "read");
    assert.equal(okNote.ok, true);
    assert.equal(okNote.ok && okNote.value.root, noteFolder);
    assert.equal(okNote.ok && okNote.value.relative, "note.txt");
    // 같은 바깥 폴더의 다른 파일은 onceTarget으로 열리지 않는다
    const otherDenied = await resolveInWorkspace(
      withOnce,
      join(outside, "other.txt"),
      "read",
    );
    assert.equal(otherDenied.ok, false);
  } finally {
    await rm(temp, { recursive: true });
  }
});

test("file.grep 디렉터리 탐색은 .env*와 보호 폴더를 건너뛰고 fileReadGate는 workspace 안 읽기도 Gate에 넘겨 file deny 규칙을 적용한다", async () => {
  const temp = await mkdtemp(join(tmpdir(), "lophn-grep-gate-"));
  try {
    const workspace = join(temp, "workspace");
    await mkdir(join(workspace, ".ssh"), { recursive: true });
    await writeFile(
      join(workspace, "app.ts"),
      "const TOP_SECRET = 'visible';\n",
    );
    await writeFile(join(workspace, ".env"), "TOP_SECRET=from-env\n");
    await writeFile(
      join(workspace, ".env.local"),
      "TOP_SECRET=from-env-local\n",
    );
    await writeFile(
      join(workspace, ".env.example"),
      "TOP_SECRET=example-placeholder\n",
    );
    await writeFile(join(workspace, ".ssh", "id_rsa"), "TOP_SECRET=ssh-key\n");

    const ctx = {
      scope: { read: [workspace], write: [workspace], base: workspace },
    } as unknown as ToolContext;

    // 1. 디렉터리 전체 grep과 glob: ".env*" 모두 .env·.env.local·.ssh를 건너뛰고 .env.example과 일반 파일만 본다.
    const allRes = await grepFiles({ pattern: "TOP_SECRET", path: "." }, ctx);
    assert.ok(allRes.ok);
    const allMatches = (allRes.value.content as { matches: string[] }).matches;
    assert.ok(allMatches.some((line) => line.startsWith("app.ts:")));
    assert.ok(allMatches.some((line) => line.startsWith(".env.example:")));
    assert.ok(
      !allMatches.some(
        (line) =>
          line.startsWith(".env:") ||
          line.startsWith(".env.local:") ||
          line.startsWith(".ssh/"),
      ),
      `sensitive files leaked in grep: ${JSON.stringify(allMatches)}`,
    );

    const envGlobRes = await grepFiles(
      { pattern: "TOP_SECRET", path: ".", glob: ".env*" },
      ctx,
    );
    assert.ok(envGlobRes.ok);
    const envMatches = (envGlobRes.value.content as { matches: string[] })
      .matches;
    assert.deepStrictEqual(envMatches, [
      ".env.example:1:TOP_SECRET=example-placeholder",
    ]);

    // 2. fileReadGate는 workspace 안 일반 파일도 file_read GateCall을 내서 사용자 file deny 규칙이 먹는다.
    const tools = createFileTools({
      aroundWrite: (_c, _t, run) => run(),
    });
    const fileRead = tools.find((t) => t.name === "file.read")!;
    const gateCall = await fileRead.gate?.({ path: "app.ts" }, ctx);
    assert.ok(gateCall !== null && gateCall !== undefined);
    assert.equal(gateCall.kind, "file_read");
    assert.equal(gateCall.outside_workspace, false);
    assert.equal(gateCall.sensitive, false);

    const denied = evaluatePermission(
      { call: gateCall, tool: "file.read" },
      {
        floor: PRODUCT_FLOOR_RULES,
        global: [
          {
            id: "r-deny-app",
            category: "file",
            pattern: "*/app.ts",
            action: "deny",
            source: "global",
          },
        ],
        project: [],
      },
      [],
      "full",
      "attended",
    );
    assert.equal(denied.kind, "deny");
    assert.equal(denied.denial.reason_kind, "user_deny");
  } finally {
    await rm(temp, { recursive: true });
  }
});
