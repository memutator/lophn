import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type PermissionRuleLayers,
  PRODUCT_FLOOR_RULES,
} from "../../../protocol/approvals/mod.ts";
import {
  alwaysPatterns,
  evaluateShellUserRules,
  isBroadRulePattern,
  isReadOnlyShellCommand,
  MAX_SHELL_COMMAND_BYTES,
  matchFloorRules,
  scanShellCommand,
} from "./shell-match.ts";

const HOME = "/home/alice";

const FLOOR_ONLY: PermissionRuleLayers = {
  floor: PRODUCT_FLOOR_RULES,
  global: [],
  project: [],
};

test("shell 스캐너가 래퍼·flag 조합·경로 치환·heredoc·서브셸 우회를 벗겨 floor deny에 잡는다", () => {
  const bypasses = [
    'sh -c "rm -rf ~"',
    'bash -lc "rm -rf ~"',
    'zsh -ec "rm -fr /"',
    "env rm -rf ~",
    "env FOO=1 /bin/rm -rf ~",
    "command rm -rf ~",
    "exec rm -rf /",
    "nohup rm -rf ~",
    "time rm -rf ~",
    "timeout 10 rm -rf ~",
    "nice -n 5 rm -rf ~",
    "xargs rm -rf ~",
    "sudo rm -r -f /",
    "doas rm -rf ~",
    'su -c "rm -rf ~"',
    'eval "rm -rf ~"',
    "rm -r --force ~",
    "rm --recursive --force /",
    "rm -Rf ~/",
    "rm -rfv -- /",
    "rm -rf $HOME",
    'rm -rf "${HOME}/"',
    "rm -rf /home/alice",
    "rm -rf /home/alice/*",
    "rm -rf /tmp/foo ~",
    "rm -rf ///",
    "echo ok && (rm -rf ~)",
    "echo $(rm -rf ~)",
    "echo `rm -rf ~`",
    "bash <<EOF\nrm -rf ~\nEOF",
    ":(){ :|:& };:",
    "sudo /sbin/mkfs.ext4 /dev/sda1",
    "dd if=/dev/zero of=/dev/sda",
    'sh -c -- "rm -rf ~"',
    'bash -c -- "rm -rf ~"',
    'sh -c -e -- "rm -rf ~"',
    'env -S"rm -rf ~"',
    'env -iS"rm -rf ~"',
    "timeout -sKILL 10 rm -rf ~",
    "timeout -k5 10 rm -rf ~",
    "nice -n10 rm -rf ~",
    "{ rm -rf ~; }",
    "if true; then rm -rf ~; fi",
    "for x in /; do rm -rf ~; done",
    "while true; do rm -rf ~; done",
    "until false; do rm -rf ~; done",
    "! rm -rf ~",
    "coproc rm -rf ~",
    "coproc BG { rm -rf ~; }",
    "case x in *) rm -rf ~ ;; esac",
  ];

  for (const command of bypasses) {
    const scan = scanShellCommand(command, HOME);
    const hit = matchFloorRules(PRODUCT_FLOOR_RULES, scan);
    assert.notStrictEqual(hit, null, `expected floor hit for: ${command}`);
  }

  // 대조: 작업 폴더 안 임시 디렉터리 삭제는 floor가 아니다.
  for (const safe of ["rm -rf ./dist", "rm -rf /tmp/build-cache"]) {
    const scan = scanShellCommand(safe, HOME);
    assert.strictEqual(matchFloorRules(PRODUCT_FLOOR_RULES, scan), null, safe);
  }
});

test("opaque·입력 상한 초과·닫히지 않은 따옴표·동적 eval 명령은 allow 규칙과 읽기 목록을 통과하지 못한다", () => {
  const layers: PermissionRuleLayers = {
    floor: PRODUCT_FLOOR_RULES,
    global: [
      {
        id: "r1",
        category: "shell",
        pattern: "*",
        action: "allow",
        source: "global",
      },
    ],
    project: [],
  };

  const opaqueCommands = [
    'echo "unclosed quote',
    "echo 'unclosed single",
    "echo $(unclosed",
    "echo `unclosed",
    "(ls",
    "cat <<EOF\nhello without end",
    'eval "$DYNAMIC_CMD"',
    "$DYNAMIC_CMD --flag",
    "$(printf ls) -la",
    "env env env env env env env env env ls",
    "a".repeat(MAX_SHELL_COMMAND_BYTES + 10),
  ];

  for (const command of opaqueCommands) {
    const scan = scanShellCommand(command, HOME);
    assert.strictEqual(
      scan.opaque,
      true,
      `expected opaque: ${command.slice(0, 60)}`,
    );
    assert.strictEqual(isReadOnlyShellCommand(scan), false);
    assert.strictEqual(evaluateShellUserRules(layers, scan).action, null);
    assert.deepStrictEqual(alwaysPatterns(FLOOR_ONLY, command, HOME), []);
  }
});

test("elevated 명령(sudo·doas·su)은 elevated로 표시되고 allow 규칙과 always를 받지 않는다", () => {
  const layers: PermissionRuleLayers = {
    floor: PRODUCT_FLOOR_RULES,
    global: [
      {
        id: "r1",
        category: "shell",
        pattern: "sudo *",
        action: "allow",
        source: "global",
      },
      {
        id: "r2",
        category: "shell",
        pattern: "ls *",
        action: "allow",
        source: "global",
      },
    ],
    project: [],
  };

  for (const command of ["sudo ls -la", "doas cat /etc/hosts", 'su -c "ls"']) {
    const scan = scanShellCommand(command, HOME);
    assert.strictEqual(scan.elevated, true, command);
    assert.strictEqual(isReadOnlyShellCommand(scan), false, command);
    assert.strictEqual(
      evaluateShellUserRules(layers, scan).action,
      null,
      command,
    );
    assert.deepStrictEqual(
      alwaysPatterns(FLOOR_ONLY, command, HOME),
      [],
      command,
    );
  }
});

test("내장 읽기 명령 목록은 안전한 읽기 파이프라인만 허용하고 리다이렉션·위험 flag·쓰기 git은 거른다", () => {
  const allowed = [
    "ls -la",
    "pwd",
    "git status",
    "git log --oneline -n 10 | head -n 5",
    "git diff HEAD~1",
    "git branch --show-current",
    "git branch -a",
    "git tag -l",
    "git remote -v",
    "git config --get user.name",
    "git stash list",
    "find src -name '*.ts'",
    "rg TODO packages 2>&1",
    "fd -e ts",
    "command -v node",
    "env",
    "cat README.md | wc -l",
    "cat .env.example",
    "cat .env.sample",
    "cat packages/core/main/daemon/wiring/secrets.ts",
  ];
  const pathOpts = { homeDir: HOME, dataRoot: `${HOME}/.lophn` };
  for (const command of allowed) {
    assert.strictEqual(
      isReadOnlyShellCommand(scanShellCommand(command, HOME), pathOpts),
      true,
      `expected read-only: ${command}`,
    );
  }

  const blocked = [
    "echo hi > out.txt",
    "ls >> list.txt",
    "find . -delete",
    "find . -exec rm {} +",
    "find . -fprint out.txt",
    "git branch -d old-branch",
    "git branch new-branch",
    "git tag -d v1",
    "git tag v1.0.0",
    "git commit -m test",
    "git push origin main",
    "git config user.name evil",
    "git -c core.fsmonitor=evil status",
    "git diff --output=evil.txt",
    "git diff --output evil.txt",
    "git log --output=.git/hooks/pre-commit",
    "git show --ext-diff HEAD",
    "git diff --textconv HEAD",
    "env npm test",
    "sort -o file.txt file.txt",
    "rg --pre sh foo",
    "rg --pre=sh foo",
    "rg --pre-glob '*.txt' foo",
    "rg --pre-glob=*.txt foo",
    "fd -x rm",
    "fd --exec=rm",
    "fd --exec-batch=rm",
    "fd -xrm",
    "fd -Xrm",
    "echo $(npm test)",
    "cat ~/.ssh/id_rsa",
    "cat .env",
    "grep SECRET .env.local",
    "cat ~/.lophn/secrets.json",
    `cat ${HOME}/.lophn/secrets`,
    "LD_PRELOAD=/tmp/x.so ls",
    "ls && npm test",
  ];
  for (const command of blocked) {
    assert.strictEqual(
      isReadOnlyShellCommand(scanShellCommand(command, HOME), pathOpts),
      false,
      `expected NOT read-only: ${command}`,
    );
  }
});

test("alwaysPatterns는 안전한 subcommand 접두사를 만들고 금지 접두사·여러 줄·민감 리다이렉션에는 빈 목록을 낸다", () => {
  const safeCases: [string, string[]][] = [
    ["npm test", ["npm test *"]],
    ["npm test -- --watch", ["npm test *"]],
    ["npm run build", ["npm run build *"]],
    ["git commit -m 'fix bug'", ["git commit *"]],
    ["docker compose up -d", ["docker compose up *"]],
    ["cargo test --workspace", ["cargo test *"]],
    ["kubectl get pods -A", ["kubectl get *"]],
    ["ls && npm test", ["npm test *"]],
    ["make", ["make"]],
  ];
  for (const [command, expected] of safeCases) {
    assert.deepStrictEqual(
      alwaysPatterns(FLOOR_ONLY, command, HOME),
      expected,
      command,
    );
  }

  const unsafeCommands = [
    "rm -rf ./dist",
    "rmdir empty",
    "sudo npm test",
    "sh script.sh",
    "bash -c 'npm test'",
    "curl https://example.com",
    "wget https://example.com",
    "chmod +x run.sh",
    "mv a b",
    "python3 script.py",
    "node index.js",
    "git push origin main",
    "git reset --hard HEAD",
    "git clean -fd",
    "git rebase main",
    "git checkout main",
    "npm publish",
    "docker run alpine",
    "kubectl delete pod foo",
    "kubectl apply -f manifest.yaml",
    "npm test\nnpm run build",
    "echo secret > ~/.bashrc",
    "echo x > .git/hooks/pre-commit",
  ];
  for (const command of unsafeCommands) {
    assert.deepStrictEqual(
      alwaysPatterns(FLOOR_ONLY, command, HOME),
      [],
      `expected empty alwaysPatterns for: ${command}`,
    );
  }
});

test("isBroadRulePattern은 위험하거나 지나치게 넓은 기존 규칙에 경고 표시를 낸다", () => {
  const broad = [
    "*",
    "rm -rf *",
    "rm *",
    "sudo *",
    "sh *",
    "bash *",
    "curl *",
    "python3 *",
    "node *",
    "git push *",
    "git reset *",
    "docker run *",
    "kubectl delete *",
    "git *",
    "npm *",
    "docker *",
  ];
  for (const pattern of broad) {
    assert.strictEqual(isBroadRulePattern(pattern), true, pattern);
  }

  const narrow = [
    "npm test *",
    "npm run build *",
    "git commit *",
    "docker compose up *",
    "cargo test *",
    "kubectl get *",
    "make",
  ];
  for (const pattern of narrow) {
    assert.strictEqual(isBroadRulePattern(pattern), false, pattern);
  }
});
