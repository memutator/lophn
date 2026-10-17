# coding-agent (닫음)

## harness 설치를 열 때마다 앱 폴더에 하지 않고 전역에 한 번 한다

```yaml
kind: defect
modules: [packages/coding-agent, packages/shell/main, packages/protocol]
closed: fixed
guard: install_test.ts
```

지금: coding agent 터미널을 열 때마다 `shell/main/terminal/coding/requests.ts`의 `install`이 `lophn harness install`을 돌려 앱 source 폴더에 skill 둘(`lophn-build-app`, `lophn-repair`)과 hook 설정(`.claude/settings.local.json` 등)을 놓는다. 사람이 고친 파일을 덮지 않으려고 `.lophn/installed.json`에 hash를 남기고(`coding-agent/harnesses/install.ts`, 247줄), 이 명령이 앱 폴더 하나에만 쓰게 Deno 권한을 계산한다(`cli/launch.ts`, `launch-entry.ts`). 결과는 읽지 않고 예외도 삼킨다. 모두 architecture의 "hook은 앱 source 폴더 안에만, 사용자 전역 설정은 건드리지 않는다"에서 나왔다. 이 원칙 때문에 hook 설정이 전역뿐인 Hermes와 OpenClaw는 맡길 수 없다.

영향: 열 때마다 설치 확인, hash, 권한 계산, 앱 폴더마다 쌓이는 설정 파일. 설치가 실패해도 아무도 모른다.

고치려면: orca 방식. orca는 사용자 전역 설정(`~/.claude/settings.json`, `~/.codex/hooks.json`)의 hook이 모두 `~/.orca/agent-hooks/<harness>-hook.sh` 하나를 부르게 한 번 등록하고, script는 orca가 띄울 때 넣는 환경 변수(port, token, pane key)가 없으면 바로 끝난다. 업데이트는 script 파일만 바꾸고 전역 설정은 다시 안 건드린다.
- hook: harness마다 전역 설정에 `lophn hook <harness> <event>`를 한 번 등록한다. lophn은 이미 coding session에 환경 변수 token을 넣으니 그 token이 없으면 바로 끝낸다. 처음 그 harness로 맡길 때 없으면 사람에게 한 번 묻고 등록한다. 등록 결과는 사람에게 보인다.
- skill: 전역 skill 폴더(`~/.claude/skills/lophn-*` 등)에 한 번 놓는다. 내용은 "`lophn guide`를 보라" 정도로 두고 실제 안내는 CLI가 그때그때 내준다. 그러면 lophn이 업데이트돼도 파일을 다시 쓸 일이 없다.
- 지운다: 열 때마다 도는 install, `.lophn/installed.json` hash, install 명령의 권한 계산, 앱 폴더 안의 harness 설정.
- `architecture/coding-agent.md`의 "skill과 hook은 앱 source 폴더 안에만"과 Hermes·OpenClaw를 맡길 수 없다는 문장을 같은 변경에서 고친다.

정한 것: 전역에 한 번 설치하고 lophn 환경 변수로 켠다. 사용자 전역 설정을 건드리는 대신 처음 한 번 사람에게 묻는다.

닫음: `lophn harness install {harness, dry_run?}`가 hook과 얇은 skill(본문은 `lophn guide <name>`을 따르라는 말뿐)을 사용자 home의 전역 위치에 한 번 놓는다. `.lophn/installed.json` hash, `kept_user_edit`, 앱 폴더 권한 계산, `releaseExcludes`, `SKILL_RELEASES`를 지웠다. CLI 권한은 그 harness의 hook 설정 폴더와 skill 폴더로 좁혔다. 새 `lophn guide <name>`이 skill 원문을 내준다. token 없는 `lophn hook`은 아무것도 안 하고 exit 0이고, launcher는 deno도 띄우지 않는다. 사람에게 묻는 일은 `harness-global-confirm`이 한다.

## harness 7종의 감지·설치 표

```yaml
kind: defect
modules: [packages/protocol, packages/coding-agent]
closed: fixed
guard: 없음
```

지금: `HARNESS_ADAPTERS`(`protocol/coding-agent/harness-adapter.ts`)에 claude, codex, opencode, gemini, pi, hermes, openclaw 7개가 있다. hermes와 openclaw는 `prompt`, `skill_dir`, `hook`이 모두 null이라 감지만 되고 맡길 수 없다. 설치 코드(`harnesses/install.ts`)는 json hook과 pi extension 둘을 다룬다. `format`의 `"toml"`은 어느 adapter도 쓰지 않는다.

영향: 제품마다 조사 근거 없는 칸(pi extension 원문의 확인 못한 API, OpenCode hook 위치)과 감지·Settings 행이 따라온다. MVP에 비해 종류가 많다.

고치려면:
- claude 하나만 두고 나머지 adapter, pi extension, hook event 표, Settings 행을 지운다(중간, 지우는 일이 대부분).
- hermes, openclaw 둘과 쓰지 않는 `toml` 형식만 지운다(작다).
- 추천: MVP는 claude 하나. 나머지는 쓰겠다는 요구가 생길 때 다시 조사해 붙인다.

정한 것: 7종을 유지한다. 전역 설치로 바꾸면 Hermes와 OpenClaw도 hook을 놓을 수 있다. 쓰지 않는 `toml` 형식만 지운다.

닫음: 7종을 유지하고 `hook.format`의 `"toml"`을 지웠다. hermes와 openclaw의 전역 위치는 확인하지 못해 null 그대로다(아래 열린 bug).
