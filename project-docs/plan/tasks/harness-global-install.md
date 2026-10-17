# harness-global-install

harness의 hook과 skill을 앱 source 폴더가 아니라 사용자 전역에 한 번 놓는 `lophn harness install`로 바꾼다. 열 때마다 도는 설치, `.lophn/installed.json` hash, 앱 폴더용 권한 계산을 지운다. 사람에게 묻는 shell 쪽(`harness-global-confirm`)과 OpenCode hook(`harness-opencode`)은 이 task 뒤에 따로 한다.

- 단위: harness (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/coding-agent/{harness-adapter,cli-commands}.ts`
  - `packages/protocol/coding-agent/release-exclude.ts` (지운다)
  - `packages/core/apps/releases/prepare/git-extract.ts`
  - `packages/coding-agent/harnesses/{install,install_test}.ts`
  - `packages/coding-agent/cli/commands/{harness,harness-run,hook,guide,types}.ts` (`guide.ts`는 새 file)
  - `packages/coding-agent/cli/{registry,launch,launch-entry,main_test}.ts`
  - `packages/coding-agent/guides/{distribution,mod}.ts`, `packages/coding-agent/guides/manifest.ts` (지운다)
  - `packages/base/install/linux-install.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/coding-agent.md` ("지키는 것"의 skill과 hook 문장, "왜 이 모양인가"의 통로·hook·Hermes 문장). architecture 문서는 lead가 고친다.
  - 이슈: `project-docs/issues/coding-agent.md`의 "harness 설치를 열 때마다 앱 폴더에 하지 않고 전역에 한 번 한다", "harness 7종의 감지·설치 표"
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `coding-agent`, `coding-agent-cli`, `coding-agent-cli-interface`, `coding-agent-harness-api`, `project-docs/module-catalog.yaml`의 `packages/coding-agent`
- 계약:
  - 쓰는 것: `CODING_TOKEN_ENV`(`protocol/coding-agent/token.ts`), `HOOK_EVENT_TABLE`(`hook-signal.ts`), `codingHook` route(바꾸지 않는다)
  - 내놓는 것(바꾼다, 쓰는 쪽을 이 task가 모두 고친다):
    - `HarnessAdapter.skill_dir`, `HarnessAdapter.hook.path`는 **home 기준 상대 위치(전역)**가 된다. `hook.format`은 `"json" | "plugin_file"`(`toml` 삭제).
    - `harness install` 입력: `{ harness, dry_run?: boolean }`(`folder` 삭제). 출력: `{ skill, hook, files: string[] }`. outcome은 `installed | unchanged | missing | not_supported | failed`(`kept_user_edit` 삭제, `missing`은 `dry_run`일 때만). `files`는 쓴 (dry_run이면 쓸) 절대 경로다.
    - 새 local 명령 `guide`: `lophn guide <name>`, `name`은 `CODING_SKILL_NAMES` 중 하나, 출력은 string 하나.
    - `lophn hook`: token이 없으면 stdin도 읽지 않고 아무것도 안 내고 exit 0.
    - `releaseExcludes`와 `release-exclude.ts`는 지운다.
  - 이 계약을 `harness-global-confirm`(shell)과 `harness-opencode`가 쓴다.

## 할 일

근거는 위 이슈 두 절이다. 아래 위치·이름은 지금 코드에서 확인했다.

1. `packages/protocol/coding-agent/harness-adapter.ts`
   - `HarnessAdapter.skill_dir`/`hook` 주석을 "home 기준 전역 위치"로 고친다. `hook.format`에서 `"toml"` 삭제.
   - 값을 전역으로 바꾼다. 제안(확인한 것만 남기고, 못 한 것은 코드 주석에 "확인 못함"이라 적고 보고에도 적는다):
     - claude: skill `.claude/skills`, hook `.claude/settings.json`(json). 이 컴퓨터에 `~/.claude/settings.json`이 있어 모양을 볼 수 있다.
     - codex: skill `.agents/skills`, hook `.codex/hooks.json`(json). 확인 못함: codex가 hook을 읽으려고 `~/.codex/config.toml`의 feature flag를 요구하는지. 요구하면 toml을 쓰는 코드를 만들지 말고 보고에 적는다(알려진 미완 동작).
     - gemini: skill `.gemini/skills`, hook `.gemini/settings.json`(json). 확인 못함.
     - pi: skill `.pi/agent/skills`, hook `.pi/agent/extensions/lophn-status.ts`(plugin_file). 확인 못함.
     - opencode: skill `.config/opencode/skills`, hook은 `null`로 둔다(`harness-opencode` task가 채운다).
     - hermes, openclaw: 지금대로 전부 null. 맡기는 방법(첫 prompt argv)을 확인하지 못해 맡길 수 없는 제품으로 남는다. 7종은 유지한다(이슈의 "정한 것").
   - `claude`/`codex`/`opencode`는 이 컴퓨터에 설치돼 있다(`--help`, `~/.claude`, 공식 문서 WebFetch로 확인해도 된다). 실제 `~/.claude`, `~/.codex`, `~/.config/opencode`는 **읽기만** 하고 쓰지 않는다.
2. `packages/coding-agent/harnesses/install.ts`를 전역용으로 다시 쓴다(`installIntoFolder` -> 예: `installGlobal`).
   - 입력 `{ harness, home, dryRun }`, ports는 지금 `InstallPorts`(read, write, skills) 그대로.
   - 지운다: `RECORD_PATH`, `.lophn/installed.json` 읽기·쓰기, `record`/hash 비교, `put`의 `kept_user_edit` 분기, `worst`의 `kept_user_edit`, `sha256Hex` import.
   - skill: `CODING_SKILL_NAMES` 둘을 `<home>/<skill_dir>/<name>/SKILL.md` 한 파일로 놓는다. 내용은 얇게: 원본 SKILL.md의 frontmatter(name, description)를 그대로 쓰고 본문은 "절차는 `lophn guide <name>`이 내준다. 그 출력을 따른다" 정도만. 원본의 다른 file(`references/`)은 놓지 않는다(guide가 내준다). 내용이 다르면 덮어쓴다(우리 폴더다).
   - hook(json): 지금 `installJsonHook`의 `ownedEntry`(command가 `lophn hook <harness> `로 시작) 방식을 그대로 쓰되 hash 비교만 뺀다. event마다 우리 항목을 하나 두고 다른 항목·다른 key·indent는 보존한다. 파싱 실패나 객체가 아니면 쓰지 말고 `failed`.
   - hook(plugin_file): pi extension 원문(`piExtension`)을 쓴다. 파일 전체가 우리 것이라 내용이 다르면 덮어쓴다. 원문 맨 앞에서 `process.env.LOPHN_CODING_TOKEN`이 없으면 spawn하지 않고 끝나게 한다(전역에 놓으면 lophn과 상관없는 pi 실행마다 `lophn`이 뜨기 때문). `pluginSource(harness)`처럼 harness별로 원문을 고르는 한 곳으로 둔다(`harness-opencode`가 case를 하나 더한다).
   - `dryRun`이면 아무것도 쓰지 않는다. skill은 SKILL.md가 둘 다 있으면 `unchanged`, 없으면 `missing`. hook은 json이면 모든 event 항목이 있을 때 `unchanged`, 아니면 `missing`. plugin_file이면 파일이 있을 때 `unchanged`. **내용이 달라도 있으면 `unchanged`**(lophn이 업데이트돼도 사람에게 다시 묻지 않기 위해서다). `skill_dir`/`hook`이 null이면 `not_supported`.
   - 쓰기 오류는 `err({code:"unavailable"})`로 돌려준다(지금처럼).
3. `packages/coding-agent/harnesses/install_test.ts`: 위험 test 하나로 다시 쓴다(아래 "끝남"). 옛 test는 폴더·hash 규칙이라 지운다.
4. `packages/protocol/coding-agent/cli-commands.ts`
   - `HARNESS_INSTALL_OUTCOMES`를 `installed, unchanged, missing, not_supported, failed`로. `harnessInstallInputSchema`는 `{ harness, dry_run: z.boolean().optional() }`. 출력 schema에 `files: z.array(z.string())`. `absolutePathSchema` import가 안 쓰이면 지운다. `kept_user_edit` 주석 삭제.
   - `CODING_CLI_COMMANDS`에 `guide`를 더한다: `auth: "local"`, 입력 `withCommon(z.strictObject({ name: z.enum(CODING_SKILL_NAMES) }))`, 출력 `z.string()`.
   - `hook` 위 주석("token이 없으면 보내지 않고 실패한다")을 "없으면 아무것도 하지 않고 성공한다"로.
5. `packages/coding-agent/cli/commands/hook.ts`: `ctx.client === undefined`이면 `ok(undefined)`로 바로 끝낸다(stdin 안 읽음). 파일 머리 주석도 맞춘다. `noToken`은 다른 명령이 쓰니 `types.ts`에 남긴다.
6. `packages/coding-agent/cli/main_test.ts`: "hook CLI는 token 없이 거절되고…"를 "token 없으면 아무것도 보내지 않고 stdin도 읽지 않고 exit 0, stdout·stderr 비어 있음"으로 고친다(core로 아무것도 안 나가는 token 경계 test라 남긴다).
7. `packages/coding-agent/cli/commands/{harness,harness-run}.ts`
   - `harness install` 요약을 "harness의 전역 설정에 hook과 skill을 놓는다"로. 입력은 `harnessInstallInputSchema`. `runHarnessInstall`이 `local.home`을 넘겨 install을 부른다. `Deno.mkdir`/`writeTextFile`/read는 지금 ports 그대로.
   - 함수 앞 주석("폴더 안만 쓴다")과 파일 머리 주석을 고친다.
8. 새 `packages/coding-agent/cli/commands/guide.ts`: `entryOf("guide", ...)`으로 `lophn guide <name>`(`positional: ["name"]`). 출력은 `loadSkills()`에서 해당 skill의 모든 file을 이어 붙인 문자열(SKILL.md 먼저, 다른 file은 `## <path>` 머리를 붙여 뒤에). `registry.ts`에 `GUIDE_COMMANDS`를 더한다(표와 어긋나면 기동 때 throw한다). `types.ts`의 `READ_WORDS`에 `"guide"`를 더한다(안 하면 help가 변경 명령으로 보인다).
   - 출력 쪽 `output.ts`/`fence.ts`는 이 task 소유가 아니다. 지금은 긴 문자열이 data fence로 감싸져 나오는데, fence 제거(trust 단위)가 merge되면 그대로 나온다. 이 task에서 건드리지 않고 `--json`으로 문자열이 온전한지만 확인한다.
9. `packages/coding-agent/guides/{distribution,mod}.ts`, `manifest.ts`
   - `manifest.ts`(`SKILL_RELEASES`, `skillContentHash`)를 지운다. 설치된 사본을 갱신하려고 version·hash를 올리던 장치인데 전역 skill은 얇아서 바뀌지 않는다.
   - `loadSkills`에서 hash 비교를 빼고 읽기만 한다. `mod.ts` export를 맞춘다. 원본 `guides/skills/**`는 고치지 않는다(guide가 그대로 내준다).
10. `packages/coding-agent/cli/launch.ts`, `launch-entry.ts`: `harness install`의 앱 폴더 권한을 지우고, 전역 위치로 바꾼다. `--no-prompt`로 도는 CLI는 flag가 없으면 전역에 못 쓰므로 계산 자체는 남기되 대상이 달라진다.
    - `CliSelection.folders`/`planSelection`의 `folder` 입력을 지우고 `planSelection(command, input, home)`이 `harness install`(`input.harness`)일 때 그 harness의 `<home>/dirname(hook.path)`와 `<home>/<skill_dir>`만 읽기·쓰기로 낸다(`exactPath`로 거른다). adapter 표에서 읽고 별도 목록을 두지 않는다.
    - `launch-entry.ts`는 `home`(`options.home ?? env HOME`)을 넘긴다. 머리 주석을 맞춘다. `harness refresh`의 실행 권한은 그대로.
11. `packages/base/install/linux-install.ts` (`cliLauncher`)
    - 주석의 "harness install의 앱 폴더"를 "harness install의 전역 설정 위치"로 고친다(두 곳).
    - `launcherHead` 다음, deno를 띄우기 전에 `hook`이고 `LOPHN_CODING_TOKEN`이 비어 있으면 `exit 0`하는 shell 두세 줄을 더한다. 전역 hook은 lophn과 상관없는 harness 실행마다 불리므로 deno 기동 비용을 안 내게 한다(`[ "$1" = hook ] && [ -z "${LOPHN_CODING_TOKEN:-}" ] && exit 0`). 이 file의 다른 부분은 건드리지 않는다.
12. 앱 폴더용 제외 목록을 지운다: `packages/protocol/coding-agent/release-exclude.ts` 삭제, `git-extract.ts`의 `releaseExcludes` import와 `excluded`의 사용을 지운다(앱 폴더에 harness 설정이 더는 안 생긴다). `protocol/coding-agent/mod.ts`의 `export { releaseExcludes }` 줄은 지운 것을 가리키는 등록 줄이니 이 줄만 뺀다.

## 정한 것

- 사람에게 묻는 일(`dry_run`으로 "없는지" 보기, 허락 뒤 install)은 shell 쪽 `harness-global-confirm` task가 한다. 이 task는 CLI까지다. 거절하면 session은 열리고 hook이 없어 state는 unknown(지금 설치 실패와 같다). 거절을 기억하지 않는다(저장할 곳이 없고 다음에 다시 묻는 편이 단순하다).
- 이슈는 "install 명령의 권한 계산을 지운다"고 했지만 CLI는 `--no-prompt`라 flag 없이는 전역에 못 쓴다. 설치를 shell main(Node)으로 옮기면 coding-agent 코드를 shell bundle에 넣어야 해서 더 무겁다. 그래서 앱 폴더 계산만 지우고 그 harness의 전역 위치 두 곳으로 좁힌다.
- `lophn`이 PATH에 있다고 본다(hook command는 `lophn hook <harness> <event>` 그대로). 개발 실행은 `LOPHN_CLI`를 쓰므로 전역 hook은 packaged 설치에서만 맞다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test(`write-test`): "전역 설정 install은 사람이 쓴 다른 key·다른 hook을 보존하고, 파싱되지 않는 설정 file은 건드리지 않고 `failed`로 끝낸다(두 번 돌려도 같다)." `install_test.ts`에 메모리 ports로 하나. `HOME`이나 실제 file을 쓰지 않는다.
- 위험 test: 없음 그 밖에. `main_test.ts`는 고친 test 하나뿐이다.
- 남지 않음:
  - `grep -rn "installed.json\|kept_user_edit\|installIntoFolder\|releaseExcludes\|RECORD_PATH" packages tools`가 0줄
  - `grep -rn '"toml"' packages/protocol/coding-agent packages/coding-agent`가 0줄
  - `grep -rn "SKILL_RELEASES\|skillContentHash" packages`가 0줄
- 수동 확인(실제 `~/.claude` 등을 건드리지 않는다): `mkdir -p $PWD/.dev-data/harness-global-install/home` 뒤 `HOME=<그 경로>`로 deno 직접 실행 또는 `lophn` entry를 불러 `harness install`(`dry_run` 포함)과 `guide lophn-build-app`을 한 번씩 돌려 결과 file을 본다. 진짜 `~/.lophn`, `~/.claude`는 쓰지 않는다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: `protocol/coding-agent/mod.ts`에서 `releaseExcludes` 줄을 뺀 것 확인
- 안 쓰게 된 export
- 정한 것
- 넘길 줄: `harness-global-confirm`이 쓸 `harness install` 입력·출력 모양(위 계약)이 바뀌었으면 알린다
- 계약 바꾸기 요청
- 확인 못한 전역 위치: harness마다 어느 칸이 확인됐고 어느 칸이 못 한 것인지(codex hook feature flag 포함)
- **무겁게 짠 것**
- **알려진 미완 동작**
