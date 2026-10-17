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

닫음: `lophn harness install {harness, dry_run?}`가 hook과 얇은 skill(본문은 `lophn guide <name>`을 따르라는 말뿐)을 사용자 home의 전역 위치에 한 번 놓는다. `.lophn/installed.json` hash, `kept_user_edit`, 앱 폴더 권한 계산, `releaseExcludes`, `SKILL_RELEASES`를 지웠다. CLI 권한은 그 harness의 hook 설정 폴더와 skill 폴더로 좁혔다. 새 `lophn guide <name>`이 skill 원문을 내준다. token 없는 `lophn hook`은 아무것도 안 하고 exit 0이고, launcher는 deno도 띄우지 않는다. 사람에게 묻는 일은 shell 쪽이 따로 한다.

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

## 텍스트 출력의 data fence

```yaml
kind: defect
modules: [packages/coding-agent]
closed: fixed
guard: 없음
```

지금: `coding-agent/cli/output.ts`의 `renderLines`가 공백 없는 짧은 token(`isPlainToken`: 128자 이하, `[\w.:/@+#=-]`)이 아닌 문자열은 모두 `fence.ts`의 `fenceBlock`으로 감싼다. 자료 안의 `<<<`는 깬다.

영향: 출력 규칙이 두 갈래다. 그러나 이 규칙은 ticket 본문 같은 자료가 안내 글과 섞여 coding agent를 조종하지 못하게 하는 경계다(architecture "지키는 것").

고치려면: 규칙을 줄이면 prompt injection 방어가 약해진다. 추천: 남긴다. 이유를 `fence.ts` 주석에 이미 적었으니 kept로 닫는다.

정한 것: 지운다. 사용자 앱과 사람이 쓴 글은 공격자로 보지 않는다(AGENTS.md). `fence.ts`와 `renderLines`의 분기를 지우고 값을 그대로 쓴다.

닫음: `cli/fence.ts`를 지우고 `output.ts`의 `renderLines`가 한 줄 문자열은 `key: value`, 여러 줄은 `key:` 아래 들여 쓰기로만 낸다. lophn-repair skill의 fence 문장도 지웠다. 문자열 끝 newline 하나와 `\r\n`은 정리되어 나간다.

## OpenCode 맡기기에서 메시지가 늘 `state_unknown`으로 거절된다

```yaml
kind: bug
modules: [packages/protocol, packages/coding-agent]
closed: fixed
guard: 없음
```

지금: `HARNESS_ADAPTERS.opencode.hook`이 `null`이라 `harness install`이 hook을 놓지 않는다(결과 `not_supported`). 그런데 `TURN_END_SIGNALS.opencode`는 `"session.status idle"`이라 `canDeliverMessages("opencode")`가 true다(`protocol/coding-agent/harness-adapter.ts`). 그래서 `core/apps/tickets/coding/transport.ts`의 `send`가 `no_turn_end_signal` 검사는 통과하고, hook이 한 번도 안 와 `row.heard`가 false인 채라 늘 `state_unknown`으로 거절한다. Settings에도 메시지를 받을 수 있는 제품으로 보인다.

영향: OpenCode로 맡기면 session은 뜨지만 App Engineer가 보내는 메시지는 전부 실패한다. 사람은 Settings 표시를 믿고 골랐다가 뒤에 안다.

고치려면:
- 신호 표에서 `opencode`를 `null`로 바꾼다(한 줄). 거절 이유가 `no_turn_end_signal`로 정직해지고 Settings도 맞게 보인다. `architecture/coding-agent.md`의 turn 끝 신호 목록에서 OpenCode를 같이 뺀다.
- project plugin 위치를 조사로 확인해 hook을 설치한다(조사 + install 코드, 중간).
- 추천: 앞쪽. hook 위치가 확인되면 그때 되살린다.

정한 것: 고친다. 전역 설치로 바꿀 때 OpenCode의 전역 plugin 위치를 확인해 hook을 놓는다.

닫음: `HARNESS_ADAPTERS.opencode.hook`을 전역 plugin `~/.config/opencode/plugins/lophn-status.ts`(opencode.ai/docs/plugins로 확인)로 채우고, `install.ts`의 `opencodePlugin`이 `HOOK_EVENT_TABLE.opencode`의 event 가운데 root session 것만 `lophn hook opencode <event>`로 넘긴다. token이 없으면 hook을 등록하지 않는다. 가짜 client와 가짜 `lophn`으로 plugin만 돌려 봤고 실제 OpenCode로는 확인하지 못했다(아래 열린 bug).
