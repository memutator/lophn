# hooks-install

사람의 harness 설정 file(`~/.claude/settings.json`, `~/.codex/hooks.json`·`config.toml` 등)에 hook을 놓거나 지울 때 tmp file에 쓰고 rename한다. 읽은 뒤 다른 도구가 고친 file은 덮지 않고 다시 읽는다. Codex는 trust를 먼저 쓴다. `lophn hook`이 stdin을 기다리느라 사람의 coding agent를 붙잡지 않게 한다.

- 단위: term (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/coding-agent/local/{harness-run,hook}.ts`
  - `packages/coding-agent/local/harness-run_test.ts`
  - `packages/coding-agent/harnesses/{install-common,install,uninstall}.ts`
  - `packages/coding-agent/harnesses/install_test.ts`
- 읽을 것:
  - 계획 README "정한 것"의 첫 줄(atomic write는 같은 file을 고치는 김에 넣는 G3다)
  - architecture: `project-docs/architecture/coding-agent.md` 목표("쓸 때는 우리 항목만 바꾸고 나머지는 byte 그대로 둔다"), 지키는 것 7·8(Codex trust)·9·12, `project-docs/architecture/terminal-agent.md` 지키는 것 4("CLI는 1초 안에 끝내고, 실패해도 출력 없이 성공한다")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `coding-agent`, `external-coding-agent`. `project-docs/module-catalog.yaml`의 `packages/coding-agent`
  - `.claude/skills/write-test/SKILL.md`
- 계약:
  - 쓰는 것: `InstallPorts`(`packages/coding-agent/harnesses/install-common.ts`). 모양(`read`·`write`·`list`·`remove`)은 바꾸지 않는다. `HARNESS_INSTALL_OUTCOMES`·`HARNESS_UNINSTALL_OUTCOMES`(`packages/protocol/coding-agent/harness-install.ts`)도 바꾸지 않는다. 바뀐 file이 두 번 이어지면 지금 있는 `failed`다.
  - 내놓는 것: 없음. hook command 꼴(`lophn hook <harness> <event>`)과 우리 항목을 알아보는 `ownedCommand`·`placedCommand` regex는 바꾸지 않는다(term #25, #30은 이 계획 밖이다).

**test와 확인은 사람의 home을 건드리지 않는다.** 이 file들은 사람의 `~/.claude`, `~/.codex`에 쓴다. test는 `install_test.ts`의 `memory()` 같은 주입한 port를 쓰거나, `runHarnessInstall`에 `mkdtemp`로 만든 임시 home을 넘긴다. `lophn harness install`을 실제 home에 돌려 보지 않는다.

## 할 일

1. **설정 file 쓰기를 tmp + rename으로 바꾼다(term #27).** 사람 harness 설정에 쓰는 길은 `harness-run.ts`의 `nodePorts.write` 하나다(`editFiles`, uninstall의 `changeFiles`, `skill-copies.ts`가 모두 이것을 쓴다). 지금은 `writeFile(path, text)`로 자리에서 덮는다. 쓰는 중에 process가 끝나거나 disk가 차면 사람의 `settings.json`이 반쯤 쓰인 채 남고, 그 harness는 다음 실행에서 설정을 못 읽는다.
   - `write(path, text, executable)`:
     - 있는 file이면 `realpath`로 실제 대상을 찾는다. symlink인 dotfile을 보통 file로 바꾸지 않게 하려는 것이다.
     - 실제 대상과 같은 폴더에 tmp(`<대상>.<pid>.tmp` 꼴)를 쓰고, 권한을 맞춘 뒤 `rename`한다. 권한은 있던 file의 mode다. 새 file이면 기본 mode, `executable`이면 `0o755`다.
     - 쓰기나 rename이 실패하면 tmp를 지우고 던진다. 던지면 지금처럼 `installGlobal`이 `unavailable`로 바꾼다.
     - 폴더가 없을 때(ENOENT) `mkdir` 뒤 다시 쓰는 지금 동작은 둔다.
     - 다른 곳에 일반 helper를 만들지 않는다. coding-agent는 shell의 `atomic-file.ts`를 import하지 못한다.
   - **Codex 쓰는 순서를 바꾼다.** 지금 `install.ts`의 codex 갈래는 `editFiles` jobs에 `hooks.json`을 먼저, `config.toml`(trust)을 뒤에 둔다. 둘 사이에서 끊기면 trust 없는 lophn hook이 남는다. 그러면 Codex는 그 hook을 건너뛰고 사람에게 `/hooks`에서 trust하라고 보인다. 순서를 바꿔 `config.toml`을 먼저 쓴다. 그 사이에서 끊기면 아직 없는 handler를 가리키는 trust 기록만 남는다. Codex는 hash가 맞는 handler만 믿어서 해가 없고, `dry_run`은 `missing`이라 다음 설치가 마저 놓는다. trust 계산(`codexTrustOf`)은 쓰기 전에 `nextHooks`로 끝나므로 순서와 상관없다.
   - uninstall의 codex 갈래(`uninstall.ts`의 `uninstallHook`)는 지금 순서(`hooks.json` 먼저, trust 지우기 뒤)를 둔다. 끊기면 남는 것이 쓰이지 않는 trust 기록이라 해가 없다.
2. **읽은 뒤 바뀐 file을 덮지 않는다(term #28).** 지금 `install-common.ts`의 `editFiles`와 `uninstall.ts`의 `changeFiles`는 file을 모두 읽고 새 본문을 계산한 뒤 다시 보지 않고 쓴다. 그 사이 다른 도구(사람의 editor, harness 자신)가 같은 file을 고치면 그 고침을 지운다.
   - 두 함수에서 쓰기 직전에, 쓸 file(`planned`)을 모두 다시 읽어 계산에 쓴 본문과 견준다. 모두 같을 때만 쓴다. 하나라도 다르면 아무것도 쓰지 않고 읽기부터 한 번 다시 한다. 두 번째도 다르면 아무것도 쓰지 않고 `failed`다. `dry_run`은 쓰지 않으므로 다시 읽지 않는다.
   - codex 갈래는 `hooks.json`을 `editFiles` 밖에서 먼저 읽어(`hooksText`) trust를 계산한다. 그래서 `hooks.json` job의 `make`가 받은 글을 무시한다(`make: () => nextHooks`). 이것을 `make: (text) => (text === hooksText ? nextHooks : null)`로 바꾼다. 그사이 바뀌었으면 `failed`로 쓰지 않는다. uninstall의 codex 갈래도 같다. `hooks.json` job이 받은 글이 trust 변경(`codexTrustChange`)을 계산한 `hooksText`와 다르면 `null`이다.
   - lock file이나 file lock은 두지 않는다.
3. **`lophn hook`의 stdin 읽기에 기한을 둔다(term #7).** 지금 `hook.ts`의 `runHook`은 `await ctx.stdin()`(`packages/cli/main.ts`의 `readProcessStdin`, EOF까지 읽는다)을 기한 없이 기다린다. 1초 기한(`HOOK_DEADLINE_MS`)은 socket 쓰기에만 걸려 있다. harness가 hook stdin을 닫지 않으면 event마다 harness 자신의 hook timeout까지 사람의 agent가 멈춘다.
   - `runHook`이 시작할 때 기한 하나(`HOOK_DEADLINE_MS`, 1초)를 잡는다. stdin 읽기와 socket 쓰기를 모두 그 안에서 한다. stdin이 기한 안에 끝나지 않으면 아무것도 보내지 않고 지금처럼 `ok(stdout)`로 끝난다. `writeLine`은 남은 시간을 기한으로 받는다.
   - 기한 뒤 매달린 stdin 읽기는 그대로 둔다. `cliMain`이 끝에서 `process.exit(...)`하므로 process를 붙잡지 않는다. `packages/cli`는 고치지 않는다.

## 정한 것

- 바뀐 file이 두 번 이어지면 `conflict` 오류가 아니라 `failed`다. 새 outcome·오류를 만들면 protocol과 Settings 화면이 바뀐다. 지금 `failed`의 뜻(아무것도 쓰지 않았다)과 같다.
- `.lophn-bak` 같은 backup은 만들지 않는다. tmp + rename이면 반쯤 쓴 file이 남지 않고, backup은 사람 home에 file을 하나 더 남긴다.
- stdin 기한을 따로 두지 않고 hook 전체에 1초 하나를 둔다. `project-docs/architecture/terminal-agent.md` 지키는 것 4가 CLI를 1초 안에 끝낸다고 적는다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test(`packages/coding-agent/harnesses/install_test.ts`, `memory()` port를 감싸 첫 `read` 뒤 map의 본문을 바꾼다): "설치가 설정을 읽은 뒤 다른 도구가 그 file을 고치면, 그 고침을 지우지 않고 다시 읽어 우리 항목만 더한다"
- 위험 test(`packages/coding-agent/local/harness-run_test.ts`, `mkdtemp` 임시 home에서 `runHarnessInstall({ harness: "claude" }, home, now)`): "`.claude/settings.json`이 symlink면 설치 뒤에도 symlink이고 대상 file에 우리 hook이 들며, 대상 file의 mode(0600)가 그대로다"
- 남지 않음: `grep -n "make: () => nextHooks" packages/coding-agent/harnesses/install.ts`가 0줄이다.

## 보고

`.claude/skills/orchestrate/brief-template.md` "보고" 꼴. 특히:
- 등록할 것: `project-docs/flows/tests/libs-tooling.yaml`의 `install_test.ts`·`harness-run_test.ts` 줄의 `covers`·`note`에 새 case를 더할지 lead가 정한다. 바뀐 쓰기 규칙(tmp + rename, 바뀐 file은 다시 읽기, Codex trust 먼저)은 lead가 `project-docs/architecture/coding-agent.md`에 맞춘다.
- Windows에서 열린 file 위로 `rename`하면 EPERM이 날 수 있다. 이 기계에서 확인할 수 없다. 다시 시도하는 code는 넣지 않는다. 확인하지 못한 것으로 적는다.
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
