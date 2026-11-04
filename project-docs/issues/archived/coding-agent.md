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

## coding session을 메모리 대신 ledger 표 셋과 `ApplyCodingSignal`로 둔다

```yaml
kind: defect
modules: [packages/core/apps, packages/core/storage]
closed: kept
guard: 없음
```

지금: `coding_sessions`, `coding_lines`, `coding_inputs` 표(`core/apps/tickets/coding/schema.ts`)와 machine command `ApplyCodingSignal`(`signal.ts`)을 둔다. 이유는 schema 주석대로 command는 writer Worker에서 돌고 reader는 `CodingSessionLookup`과 줄을 읽어야 하는데 둘이 메모리를 같이 볼 수 없고, tx가 되돌아가면 표도 같이 되돌아가야 해서다. 값은 lophn이 꺼지면 의미를 잃어 켤 때 `recover`가 비운다. 감지 결과와 터미널 요청만 writer 메모리(`memory.ts`)에 있다.

영향: 표 셋, 상태 갱신 command, recover, 표를 읽는 `store.ts`·`lookup.ts`가 따로 늘었다. 휘발성 값에 schema step이 붙어 바꿀 때마다 표를 같이 고친다.

고치려면:
- main thread 한 곳에만 두고 core 읽기는 거기에 묻는다. Worker 경계를 넘는 port가 새로 필요하고, "상태·정산·call 닫기를 같은 transaction에서" 고치는 지금 불변 조건을 깨야 한다(큼).
- 남긴다. 표는 휘발성이지만 정산이 tx와 같이 가는 것이 이 구조의 이유다.
- 추천: 남기는 쪽. 이유가 schema 주석에 이미 있다.

닫음: 표는 휘발성이지만 정산이 tx와 같이 가는 것이 이 구조의 이유이고(command는 writer Worker, reader는 표를 읽는다), main thread로 옮기면 같은 transaction 불변 조건이 깨진다. 이유는 schema 주석에 있다.

## `mutates` 칸을 명령 이름 마지막 단어(`READ_WORDS`)로 가른다

```yaml
kind: defect
modules: [packages/coding-agent]
closed: kept
guard: 없음
```

지금: `coding-agent/cli/commands/types.ts`의 `isReadName`이 이름의 마지막 단어가 `READ_WORDS`(list, show, status, blueprint, invocations, logs, more, diff, detect)에 있으면 읽기로 본다. `entryOf`가 이걸로 `mutates`를 채우고 help가 읽기/변경 목록을 가른다(`help.ts`).

영향: 새 변경 명령 이름이 우연히 이 단어로 끝나면 help가 읽기로 표시한다. 현재는 틀린 곳이 없어 화면 안내만 걸린다.

고치려면: `entryOf`에 `mutates`를 명시 인자로 받고 `READ_WORDS`와 `isReadName`을 지운다(명령 수만큼 한 줄씩, 작다). 추천: 이대로.

닫음: 새 변경 명령 이름이 우연히 읽기 단어로 끝날 때 help 표시만 틀리고 지금은 틀린 곳이 없다. 명령 25개에 인자를 다는 값에 비해 얻는 것이 작다. `READ_WORDS` 주석이 규칙을 말한다.

## `ticket.cancel`이 transport의 active·waiting call을 찾아 멈춘다

```yaml
kind: defect
modules: [packages/core/apps]
closed: kept
guard: 없음
```

지금: `core/apps/tickets/commands.ts`의 `cancel`이 `stopCodingCalls`에서 `CodingTransport.lines()`를 돌며 이 ticket의 active·waiting call을 찾아 `stop(reason: "ticket_cancelled")`을 부른다. transport의 `stop`은 이 이유일 때 Router를 거치지 않으므로 call 상태도 직접 `cancelled`로 옮긴다(`transport.ts`).

영향: ticket 모듈이 coding session의 줄 구조를 알고, call 취소 책임이 Router와 transport로 갈라진다. transport 모양을 바꾸면 ticket 취소도 같이 고친다.

고치려면:
- ticket 취소는 domain event만 내고 transport 쪽 handler가 줄을 정리한다(Reactor handler 하나 더, 중간). 같은 tx 안 일관성이 약해진다.
- 남긴다. 지금 방식은 취소·claim 삭제·call 취소가 한 tx다.
- 추천: 남긴다.

닫음: 지금 방식은 취소·claim 삭제·call 취소가 한 tx이고, domain event로 나누면 같은 tx 안 일관성이 약해진다.

## ticket 표가 6개다

```yaml
kind: defect
modules: [packages/core/apps]
closed: kept
guard: 없음
```

지금: `tickets`, `ticket_references`, `ticket_claims`, `ticket_completions`, `ticket_check_results`, `ticket_verdicts`(`core/apps/tickets/schema.ts`). 보고마다 completion 한 줄(불변, trigger), check 결과 한 줄(Reactor가 나중에 한 번 기록), verdict 한 줄(불변).

영향: ticket 하나의 한 번 보고를 읽으려면 표 셋을 join한다. 표를 더하거나 바꿀 때 trigger와 외래 키까지 같이 본다.

고치려면: completion·check·verdict를 한 표의 열로 합친다. 그러면 completion 불변 trigger가 나중에 채워지는 열과 부딪쳐 열마다 트리거를 따로 걸어야 한다(중간). 추천: 남긴다. 세 줄은 쓰는 때와 쓰는 주체가 달라 따로 불변으로 두는 편이 단순하다.

닫음: completion·check·verdict는 쓰는 때와 주체가 달라 따로 불변으로 두는 편이 단순하다. 한 표로 합치면 불변 trigger가 나중에 채워지는 열과 부딪친다.

## 앱마다 coding session 하나와 call 줄, 실패 이유

```yaml
kind: defect
modules: [packages/core/apps]
closed: kept
guard: 없음
```

지금: 앱마다 끝나지 않은 session은 하나이고(`coding_sessions_active` unique index) 그동안 온 맡기기는 `coding_lines`에 줄을 선다. 실패 이유는 시작 4(`not_connected`, `cannot_launch`, `no_source_folder`, `ticket_unavailable`), 메시지 거절 3(`no_turn_end_signal`, `state_unknown`, `session_ended`), 터미널 4(`spawn_failed`, `no_terminal`, `folder_missing`, `host_lost`)다(`protocol/coding-agent/transport.ts`, `terminal-requests.ts`).

영향: 이유마다 문구와 호출처 처리가 있어 늘어난다. 줄은 같은 source 폴더에 session 둘이 부딪치는 것을 막는 장치다.

고치려면: 줄을 없애고 바쁨으로 돌려주면 다시 맡길 때를 보낸 쪽이 알 길이 없다(architecture "busy 실패 대신 줄에 세운다"). 이유는 호출처가 갈라 처리하는 것만 남긴다. 추천: 남긴다. 이유는 architecture에 있다.

닫음: 줄은 같은 source 폴더에 session 둘이 부딪치는 것을 막고, 없애면 바쁨으로 돌려받은 쪽이 다시 맡길 때를 알 길이 없다(architecture "busy 실패 대신 줄에 세운다").

## harness 감지 결과를 shell main 메모리에 쥔다

```yaml
kind: defect
modules: [packages/shell/main]
closed: kept
guard: 없음
```

지금: `shell/main/desktop/coding-connection.ts`가 마지막 성공 감지 결과(`last`)를 메모리에 쥐고, 실패한 결과는 쥐지 않아 다음 `read`가 다시 감지한다. core로 알리기(`report`)가 실패하면 다음 `read`에서 다시 알린다. 새로 감지는 `refresh`일 때만 한다.

영향: 결함이라기보다 결정 기록이다. 메모리에만 있어 shell을 다시 켜면 처음 읽을 때 감지를 한 번 더 한다.

고치려면: 저장하면 표와 무효화 규칙이 늘고 PATH가 바뀌면 낡는다. 추천: 남긴다. 이유는 `last` 위 주석에 있다.

닫음: 저장하면 표와 무효화 규칙이 늘고 PATH가 바뀌면 낡는다. 이유를 `last` 위 주석에 적었다.

## check는 test를 다시 돌리지 않고 기록된 Verification만 읽는다

```yaml
kind: defect
modules: [packages/core/apps]
closed: kept
guard: 없음
```

지금: `core/apps/tickets/checks.ts`의 `loadCheckWork`가 `verifications` 표에서 release의 bundle hash(`app_test`) 또는 이 ticket·completion의 `test_command` 기록만 읽어 `check_work`로 모은다. check 때 test를 다시 돌리지 않는다.

영향: 결함이라기보다 결정 기록이다. test는 앞 단계(app test, test command)가 이미 기록한다. 다시 돌리는 비용과 sandbox를 피한다.

고치려면: 다시 돌리면 sandbox·시간·부작용이 늘어 크다. 추천: 남긴다. 이유는 `loadCheckWork` 주석에 둔다.

닫음: 다시 돌리면 sandbox·시간·부작용이 늘어 크다. test는 앞 단계(app test, test command)가 이미 기록한다.

## harness 전역 install 코드가 단계마다 Step을 돌려준다

```yaml
kind: defect
modules: [packages/coding-agent]
closed: kept
guard: 없음
```

지금: `coding-agent/harnesses/install.ts`(315줄)가 dry_run, json hook, plugin file, skill마다 `Step`을 따로 만들어 합친다. `thinSkill`은 원본 SKILL.md의 frontmatter를 정규식으로 뽑고, 깨졌으면 name만 있는 frontmatter로 대신한다.

영향: 놓을 것이 셋뿐인데 길다. frontmatter 대체는 우리 원본이 깨질 때만 쓰이는 방어 코드다.

고치려면: dry_run을 "쓰기 port를 바꿔 끼우기"로 바꿔 Step을 없앤다(작음). frontmatter 대체는 지운다(작음).

닫음: 놓을 것이 셋(skill, json hook, plugin file)이고 `Step`으로 나뉜 지금 모양이 읽기 쉽다. frontmatter 대체는 한 식이라 지워도 얻는 것이 없다.

## 전역 hook command가 PATH의 `lophn`을 부른다

```yaml
kind: bug
modules: [packages/coding-agent]
closed: fixed
guard: packages/coding-agent/harnesses/install_test.ts "개발 command로 놓아도 사람이 쓴 hook은 남고 우리 항목은 event마다 하나다"
```

지금: 전역 hook은 `lophn hook <harness> <event>`이고 `lophn`이 PATH에 있다고 본다. 개발 실행(`LOPHN_CLI`)에서는 PATH의 `lophn`이 없거나 다른 판이라 전역 hook이 맞지 않는다.

영향: 개발 중에는 coding session의 turn 끝 신호가 안 오거나 설치된 판의 core로 간다.

고치려면: 개발 실행에서는 hook command에 `LOPHN_CLI` 경로를 쓴다(작음). 다만 전역 설정에 개발 경로가 남는다.

닫음: `harness install`이 `command`(공백·따옴표·`..` 없는 절대 경로)를 받는다. shell main은 개발 실행에서 `LOPHN_CLI` 경로를 `hookCommand`로 넘기고(packaged는 없다), `installGlobal`이 그 경로로 JSON hook과 pi·OpenCode plugin의 spawn을 쓴다. `lophn hook …`과 `<절대 경로> hook …`을 모두 우리 항목으로 보아 오가도 event마다 하나다. `command`를 준 dry_run만 내용이 다르면 `missing`이다. 남는 것: 개발 경로를 놓은 뒤 packaged로 돌아가면 `command` 없는 dry_run이 `unchanged`라 개발 경로가 전역 설정에 남는다(개발 머신만. 항목을 지우거나 packaged에서 다시 놓는다).

## OpenCode가 turn 끝을 event 둘로 내서 TurnEnded가 두 번 간다

```yaml
kind: bug
modules: [packages/coding-agent, packages/protocol, packages/core/apps]
closed: fixed
guard: packages/protocol/coding-agent/hook-signal_test.ts "OpenCode의 turn 끝 신호는 session.status의 idle 하나다"
```

지금: 설치된 OpenCode(1.18.35)는 idle이 되면 canonical `session.status`(idle)를 낸 뒤 deprecated `session.idle`을 이어서 낸다(같은 판에서 도는 다른 도구의 plugin이 이 순서를 전제로 둘째를 거른다). `protocol/coding-agent/hook-signal.ts`의 `HOOK_EVENT_TABLE.opencode`는 둘 다 `TurnEnded`로 바꾸고, plugin(`harnesses/install.ts`의 `opencodePlugin`)도 둘 다 넘긴다. `core/apps/tickets/coding/hook.ts`의 `TurnEnded` 처리는 중복을 가리지 않는다. 첫 신호가 `drain`으로 대기열의 다음 메시지를 넣어 `inflight`를 켜면, 둘째 신호가 `running`·`inflight`를 다시 끄고 `TurnEnded` event를 한 번 더 낸다.

영향: OpenCode로 맡기면 turn마다 `TurnEnded`가 두 번 기록되고, 대기열에 메시지가 둘 이상일 때 앞 메시지가 아직 turn으로 이어지기 전에 다음 메시지가 들어가 순서가 겹친다.

고치려면: `HOOK_EVENT_TABLE.opencode`에서 `session.idle`을 빼고 `session.status`(idle)만 쓴다(작음). 실제 OpenCode에 맡겨 보지는 못했다. `.ts` plugin이 로드되는지와 plugin 실행기에서 `node:child_process`의 spawn이 되는지는 아직 모른다.

닫음: `HOOK_EVENT_TABLE.opencode`에서 `session.idle`을 지웠다. plugin이 듣는 event도 이 표에서 만들어 함께 줄었고, 이미 놓인 옛 plugin이 `session.idle`을 넘겨도 `hookSignalOf`가 null이라 신호가 아니다. 실제 OpenCode에 맡겨 `.ts` plugin 로드와 `node:child_process` spawn을 확인하지는 못했다.

## coding agent가 CLI만으로 준비한 release의 완료를 보고할 수 없다

```yaml
kind: bug
modules: [packages/protocol, packages/coding-agent, packages/core/apps, packages/core/server]
closed: fixed
guard: tests/e2e/app-release_test.ts
```

지금: `lophn ticket report`(`protocol/coding-agent/cli-commands.ts`, 입력 `ticketReportToolInputSchema`)는 준비된 `release` id를 받는다. 그런데 `lophn release prepare`(`release.prepare_bundle`)의 출력에는 `request_key`, `status`, hash, manifest만 있고 release id가 없다. release id를 돌려주는 `releases/preparation`(`release.preparation`, `protocol/apps/releases.ts`의 출력 주석 "ticket report가 쓴다")은 CLI 명령 표에 없어 coding token으로 부를 길이 없다. 준비 확정도 그 read를 부를 때 일어난다(`finalizer.observe`, 계획 `e2e-coverage`의 brief 조사). 완료에 필요한 app test의 test hash와 결과를 CLI로 얻는 길도 없는 것으로 읽힌다. 코드로 읽었고 돌려 보지 않았다.

영향: coding agent가 앱을 고치고 release를 준비해도 완료 보고를 못 한다. 그러면 App Engineer의 검증과 `TicketVerified`가 없어 activation이 시작되지 않는다. 사람이 lophn으로 앱을 만들어 쓸 수 없다. 앱 E2E도 이 길을 지나야 한다.

고치려면:
- CLI에 `release status`(`releases/preparation`), `app test status`, `app test result`를 coding token 명령으로 연다(중간). 계획 `e2e-coverage`의 `app-cli-finish` brief가 이 안이다. 추천.
- `release prepare`가 끝날 때까지 기다려 release id를 돌려주게 한다(중간). 준비가 300초까지 걸려 CLI가 그동안 막힌다.

정한 것: CLI에 `release status`, `app test status`, `app test result`를 coding token 명령으로 연다(계획 `e2e-coverage`의 `app-cli-finish`). (사람)

닫음: CLI에 `release status`(`release.preparation`), `app test status`, `app test result`를 열었고 coding token 범위가 따라온다. `release.preparation`은 준비가 끝나면 고정 test hash를 준다. `tests/e2e/app-release_test.ts`가 template 앱을 CLI만으로 준비·test·보고해 activation까지 간다.

## 앱 template의 AGENTS.md가 없는 skill과 tool을 가리킨다

```yaml
kind: bug
modules: [packages/core/apps]
closed: fixed
guard: 없음
```

지금:
- core가 새 앱 source에 까는 `packages/core/apps/packages/template/app/AGENTS.md.tmpl`은 coding agent가 앱 root에서 먼저 읽는 file이다. `CLAUDE.md`도 이 file을 가리킨다.
- 이 file의 managed 절이 없는 것을 가리킨다.
  - 배포 skill `lophn-navigate`와 `lophn-save`.
  - 세션 시작 summary(`lophn_session` op `summary`).
  - 설치 catalog `lophn_sdk`.
  - "작업 저장소의 context glossary".
- 배포 skill은 `lophn-build-app`과 `lophn-repair` 둘뿐이다(`packages/protocol/coding-agent/harness-adapter.ts`의 `CODING_SKILL_NAMES`). 나머지 이름은 저장소에서 이 file에만 있다.
- "새 SDK Package는 설치 catalog(`lophn_sdk`)에서 찾고 exact version만 쓴다"는 `lophn-build-app` 5단계와도 어긋난다. 5단계는 blueprint나 의존을 직접 바꾸지 말고 App Engineer에게 `message send`로 청하라고 한다.

영향:
- 모든 앱의 coding agent가 없는 skill과 tool을 찾느라 turn과 token을 쓴다.
- coding agent가 의존을 import map에만 더하면 blueprint와 어긋난다. 그러면 template의 `tests/blueprint_test.ts`와 release 준비(`packages/core/apps/releases/commands.ts`의 "manifest dependencies differ from the blueprint")가 거절한다.

고치려면: managed 절이 지금 있는 것만 가리키게 고친다(작음). 가리킬 것은 다음과 같다.
- skill 둘.
- 일의 시작은 `lophn ticket show`.
- 내장 SDK guide는 `.lophn/import-map.json`이 가리키는 설치 사본의 `guide.md`.
- 의존 변경은 App Engineer에게 청하기.

추천: 이대로.

닫음: `AGENTS.md.tmpl`의 managed 절이 skill 둘(`lophn-build-app`, `lophn-repair`), `lophn ticket show`, 설치 사본의 `guide.md`, 의존 변경은 App Engineer에게 청하기만 가리킨다. 없는 skill·tool 줄은 지웠다.

## repair skill이 지운 reproduction test를 요청하게 한다

```yaml
kind: bug
modules: [packages/coding-agent, packages/protocol, packages/core/problems]
closed: fixed
guard: 없음
```

지금:
- `packages/coding-agent/guides/skills/lophn-repair/SKILL.md`는 지운 test 종류를 쓰라고 한다.
  - 1단계: ticket의 acceptance 조건에 "원래 증상 reproduction test"가 있다고 한다.
  - 7단계: `app test`로 "원래 증상 reproduction과 app test를 요청"하라고 한다.
- core는 `reproduction` 종류를 받지 않는다. `packages/core/problems/tests/commands.ts`의 `handleRequestTest`가 `invalid_input`("받지 않는 test 종류다")으로 거절한다. app test runner를 다섯 검사로 줄일 때 reproduction test를 지웠다.
- ticket의 check도 `app_test`, `test_command`, `text` 셋이다(`packages/protocol/coding-agent/ticket/values.ts`).
- 그런데 protocol의 `TEST_KINDS`(`packages/protocol/problems/tests.ts`)에는 `reproduction`과 그 schema가 남아 있다.

영향: 문제를 고치는 coding agent가 skill대로 reproduction test를 요청하면 거절당한다. 그러면 고친 것을 보일 길을 skill에서 찾느라 turn을 쓰거나, 수리 전에 실패하는 것을 보이지 않은 채 보고한다.

고치려면(작음):
- skill 1·7단계를 ticket의 check를 따르게 바꾼다. check가 돌지 않으면(`unavailable`) 돌리지 못한 것과 그 이유를 보고에 적는다.
- protocol과 core에서 `reproduction`만을 위해 남은 칸과 갈래를 지운다.
- `test_command`로 바꾸는 길은 막혀 있다. 아래 "ticket의 `test_command` check를 runner가 돌리지 않는다"를 본다.

정한 것: reproduction test는 runner를 줄일 때 지운 길이라 되살리지 않는다. 지워도 잃는 기능이 없다(agent).

닫음: `lophn-repair` skill이 ticket의 check 하나를 따르고, `app test`가 `unavailable`이면 돌리지 못한 확인과 이유를 보고 summary에 적게 한다. protocol과 core에서 `reproduction` 종류와 그 연결 칸(`problem`, `basis_seq`, `reports`, `before`, `after`), 동결 test의 `symptom`, 요청의 `ticket_source`를 지웠다. `test_command` check를 돌리는 일은 아래 열린 이슈에 남는다.

## ticket의 `test_command` check를 runner가 돌리지 않는다

```yaml
kind: bug
modules: [packages/core/problems, packages/core/apps, packages/protocol, packages/core/agent-roles, packages/coding-agent]
closed: fixed
guard: packages/core/apps/tickets/tickets_test.ts "examples check의 ticket은 예시가 맞지 않으면 verified가 되지 못하고, 맞으면 된다", tests/e2e/app-release_test.ts, packages/core/problems/tests/request-ports_test.ts, packages/core/problems/tests/harness/examples_test.ts
```

지금:
- ticket의 check는 `app_test`, `test_command`, `text` 셋이다(`packages/protocol/coding-agent/ticket/values.ts`).
- test 접수는 `test_command`를 받지 못한다. `packages/core/problems/tests/lifecycle.ts`의 `productAdmission`이 "app test만 접수하고 test_command는 준비할 수 없다"며 `unavailable`로 둔다.
- runner(`packages/core/problems/tests/work/runner-service.ts`)도 `app_test`가 아닌 요청은 "이 runner가 실행하지 않는다"로 거절한다.
- `ticket.verify`가 읽는 검증 행(`packages/core/apps/tickets/checks.ts`)은 `test_command`라면 그 ticket과 완료 보고에 붙은 행을 찾는다. 그런데 그 행이 생길 길이 없다.
- `app_test`는 다섯 platform 검사(blueprint와 handler, 의존, 빈 migration, migration 올리기, rewind)뿐이라 앱의 업무 규칙을 보지 않는다.

영향:
- App Engineer가 "이 기능은 이렇게 동작해야 한다"를 program이 확인하는 check로 걸 길이 없다.
- `test_command`로 건 ticket은 coding agent가 test를 요청할 수 없어 검증을 통과하지 못한다.
- 수리 ticket에서 원래 증상이 고쳐졌는지(수리 전 실패, 수리 뒤 통과)를 보일 길도 없다.
- 남는 것은 App Engineer가 글로 판단하는 `text`뿐이다.

고치려면:
- 살린다(중간): runner가 release bundle에서 앱의 test 명령을 돌리고, 결과를 검증 행으로 남긴다. 돌릴 때 sandbox와 memory 한도는 `app_test`와 같다. App Engineer 지침과 coding agent skill이 기능 ticket과 수리 ticket에 이 check를 쓴다.
- 지운다(작음): ticket check와 protocol에서 `test_command`를 빼고, 앱 업무의 확인은 `text`로만 한다. 잃는 것은 기능과 수리를 program이 확인할 길이다.
- 추천: 살린다.

정한 것(사람): coding agent가 쓴 test를 돌리지 않는다. code를 쓴 쪽이 기준도 쓰면 자기 채점이 되기 때문이다. 대신 다음처럼 한다.
- App Engineer가 사람의 요구에서 app-api 입력과 기대 결과의 예시를 뽑아 ticket에 적는다.
- coding agent는 그 예시를 고칠 수 없다.
- program이 준비된 release에 그 예시를 불러 결과를 비교한다. 맞아야 검증을 통과한다.
- 반쯤 만든 `test_command`는 지운다.
- app-api로 부를 수 없는 것(화면 모양)은 지금처럼 `text`로 판단하고 사람이 확인한다.

닫음: `test_command`를 protocol, core, skill에서 지우고 check를 `app_test`, `examples`, `text` 셋으로 바꿨다. `examples`는 App Engineer가 쓴 app-api 예시(api, input, expect) 1~20개다. 완료 보고가 나면 Reactor handler가 core의 machine 자격으로 `examples` test를 요청하고(예시는 요청이 아니라 접수 준비가 ticket에서 읽는다), runner(`createRealAppDriver`의 `call`)가 보고된 release의 격리 사본에서 예시를 차례로 불러 비교한다. 규칙은 객체는 expect의 key가 모두 있고 값이 맞아야 하고(실제에 key가 더 있어도 된다), 배열은 길이와 원소가 맞아야 하고, 오류로 끝난 호출은 불일치다. 결과가 `VerificationRecorded`로 나면 다른 handler가 ticket에 결과를 남긴다. `ticket.verify`는 check가 `examples`인 ticket을 현재 check hash로 pass가 기록된 뒤에만 verified로 받는다(아니면 `conflict`). coding agent는 예시를 고치지 못하고 `lophn-repair`·`lophn-build-app` skill과 App Engineer 지침이 이 check를 쓴다.

## 앱이 낸 package를 import한 앱은 app test에서 "선언하지 않은 의존"으로 떨어진다

```yaml
kind: bug
modules: [packages/core/problems, packages/core/apps]
closed: fixed
guard: packages/core/problems/tests/app-test/generate_test.ts "선언한 @me package와 내장 SDK의 import는 의존 확인을 통과하고 선언하지 않은 @me import는 걸린다"
```

지금:
- 앱이 낸 package는 `sdk/@me/<part>/<version>`에 깔린다(`packages/core/apps/packages/install.ts`의 `packageInstallPath`). 내장 SDK는 `sdk/<part>/<version>`이다.
- app test의 의존 확인(`packages/core/problems/tests/app-test/generate.ts`의 `checkDependencies`)은 import 값을 `SDK_COPY = /^\.\/sdk\/([^/]+)\/([^/]+)\//`로 읽는다. `./sdk/@me/date-range/1.0.0/...`은 이름 `@me`, version `date-range`로 읽혀 blueprint에 선언한 의존과 맞지 않는다.
- 그래서 `@me/*`를 의존에 적고 import한 앱은 그 import가 늘 "선언하지 않은 의존"이 된다.

영향: 앱이 낸 package를 다른 앱이 쓰는 길이 막혀 있다. App Engineer가 `package.publish`로 낸 logic을 다른 앱이 쓰면 그 release는 app test를 넘지 못해 켜지지 않는다. eval의 재사용 확인(계획 `eval-coding`의 calendar-mvp)도 이 때문에 떨어진다.

고치려면: `SDK_COPY`가 `@me/`를 건너뛰고 읽게 한다(`/^\.\/sdk\/(?:@me\/)?([^/]+)\/([^/]+)\//`, 작음). 이름 비교는 `item.name.split("/").pop()`이라 그대로 맞는다. `@me` package를 import하는 app test 입력 하나로 test를 둔다. 추천.

닫음: `SDK_COPY`가 `./sdk/@me/<part>/<version>/`의 `@me/`를 건너뛰고 읽는다. 선언한 `@me` package의 import는 통과하고, 선언하지 않은 `@me` import는 여전히 "선언하지 않은 의존"으로 걸린다.

## app test가 바꿀 것이 없는 write app-api를 떨어뜨린다

```yaml
kind: bug
modules: [packages/core/problems]
closed: fixed
guard: packages/core/problems/tests/harness/checks_test.ts "바꿀 것이 없는 write app-api는 되돌리기 확인을 통과하고 되돌리지 못한 api와 호출에 실패한 api는 떨어진다"
```

지금: `packages/core/problems/tests/harness/checks.ts`의 `rewind`는 write app-api를 선언 순서대로 가장 단순한 입력으로 한 번씩 부르고, 그 호출이 data를 바꿨는지(`changed`)를 통과 조건에 넣는다(`run.called && run.changed && run.applied && run.restored`). 그래서 그 입력에서 바꿀 것이 없는 write app-api(없는 id를 지우는 `remove`처럼 맞게 짠 것)는 떨어진다.

영향: coding agent가 맞게 짠 앱이 app test를 넘지 못한다. 넘기려면 바꿀 것이 없을 때도 무언가를 쓰게(지운 기록 표 등) 앱을 일그러뜨려야 한다. eval의 기준 캘린더 앱도 그렇게 짜야 한다.

고치려면:
- 바뀐 것이 없으면 그 api는 되돌릴 것이 없으니 되돌리기 확인을 통과로 둔다(작음). 잃는 것: 쓰기를 아예 못 하는 write app-api를 이 확인으로는 잡지 못한다. 추천.
- 앞 호출이 만든 행(예: 앞선 `add`의 id)을 다음 호출의 입력으로 넣는다(중간). 입력 꼴마다 규칙이 필요하다.

정한 것: 바뀐 것이 없으면 통과로 둔다(사람). changeset을 내지 않은 호출도 `changed`를 실제 값으로 채워, changeset 없이 data를 바꾼 api는 여전히 떨어지게 한다. 계획 `found-bugs`가 한다.

닫음: `rewind` check는 `run.called && (!run.changed || (run.applied && run.restored))`로 판정한다. driver(`packages/core/problems/tests/work/app-driver.ts`)는 changeset을 내지 않은 호출도 `changed`를 실제 값으로 채워, changeset 없이 data를 바꾼 api는 여전히 떨어진다.

## `package.publish`가 늘 "the app source has no commit"으로 떨어진다

```yaml
kind: bug
modules: [packages/core/apps, packages/core/lophn-agent]
closed: fixed
guard: 없음
```

지금:
- agent tool `package.publish`(`packages/core/apps/agent-tools/package.ts`)는 앱 source의 HEAD를 `headOf`가 `new Deno.Command("git", ...)`로 읽는다.
- 이 handler는 agent runtime child 안에서 돈다. 그 process의 `allow_run`은 MCP server와 `/bin/sh`뿐이다(`packages/core/lophn-agent/tools/runtime-permissions.ts`). `git`을 띄우면 `NotCapable`이 나고 `headOf`는 `catch`에서 `null`을 돌려준다.
- 그래서 tool은 늘 `unavailable`("the app source has no commit")로 답한다. commit이 있어도 같다.

영향: App Engineer가 package를 낼 수 없다. 앱 사이 재사용 길이 처음부터 막혀 있다. eval의 `date-range@1` 재료(되살리기가 fake App Engineer의 `package.publish`를 쓴다)와 calendar-mvp의 재사용 확인이 되살리기에서 떨어진다.

고치려면:
- core 쪽 memory route `package.publish`(`packagePublish`)가 앱의 `source_path`에서 HEAD를 읽고, tool은 commit을 넘기지 않는다(작음). core process는 git을 이미 띄운다. tool 입력 schema에서 `commit`을 빼는 protocol 변경이 같이 간다. 추천.
- agent runtime의 `allow_run`에 git 절대 경로를 더한다(작음). 잃는 것: agent runtime 안의 모든 tool이 git을 띄울 수 있게 된다. 평범한 `"git"`은 runtime이 다시 뜨지 못했다(절대 경로가 필요하다).

정한 것: core의 route가 HEAD를 읽는다(사람).

닫음: `packagePublishInputSchema`에 `commit`이 없다. route(`packages/core/apps/packages/publish.ts`의 `publishPackage`)가 core process에서 앱 source의 `git rev-parse HEAD`를 읽어 그 commit을 낸다. tool은 git을 띄우지 않는다.

## lophn이 새로 만든 앱은 coding agent에 맡길 수 없다

```yaml
kind: bug
modules: [packages/core/apps]
closed: fixed
guard: 없음
```

지금:
- lophn의 `app.create`(`packages/core/apps/agent-tools/app.ts`)는 앱을 등록만 하고 source 폴더는 `null`이다.
- App Engineer가 coding agent에게 `call`하면 `resolveLaunch`(`packages/core/apps/tickets/coding/launch.ts`)가 `no_source_folder`로 거절하고, call은 `unavailable`로 끝난다.
- App Engineer의 `app.link_source`는 이미 있는 git 폴더만 잇는다. 지침에도 source 이야기가 없고, 새 source를 만드는 화면이나 route도 없다. test는 `tests/support/app/source.ts`가 template을 복사하고 git init한 뒤 잇는다.

영향: 사람이 lophn에게 새 앱을 부탁하면 App Engineer가 만들 수 없다. eval의 calendar-mvp 첫 run이 이 때문에 coding session 없이 끝났다.

고치려면: coding session을 열 때 source가 없으면 core가 template을 `<data root>/apps/<id>/source`에 깔고 git init·commit한 뒤 잇는다(작음~중간). 추천.

정한 것: 위 추천대로 한다(사람).

닫음: App Engineer가 source 없는 앱의 coding agent에게 call하면 core가 template을 `<data root>/apps/<id>/source`에 깔고 commit한 뒤 잇는다(`packages/core/apps/tickets/coding/scaffold-source.ts`의 `withScaffoldedSource`). 잇기로 agent runtime이 다시 뜨는 것은 도는 turn이 끝난 뒤다.

## Claude Code가 coding session마다 folder trust를 묻는다

```yaml
kind: bug
modules: [packages/coding-agent, packages/protocol]
closed: fixed
guard: 없음
```

지금: Claude Code(2.1.302)는 처음 여는 폴더마다 folder trust 화면을 띄우고, 고를 때까지 hook이 돌지 않는다. 앱 source 폴더는 자기 `.git`을 가진 새 project라, 상위 폴더(`/tmp/lophn-eval`)를 믿어 두어도 다시 묻는다. 이 화면을 넘기는 CLI flag가 없어 launch plan(`packages/protocol/coding-agent/launch-plan.ts`)도 넘기지 못한다.

영향: 사람이 터미널 앞에 없으면 첫 session이 trust 화면에서 멈춘다. 데스크톱에서는 사람이 앱마다 한 번 골라야 한다. eval의 calendar-diagnose 첫 run에서는 터미널 셋이 모두 이 화면에서 2분 뒤 `no_session_start`로 끊겼다.

고치려면:
- 제품: 첫 session을 열기 전에 사람에게 "Claude Code에서 이 폴더를 믿어야 한다"고 알린다(작음). 또는 `~/.claude.json`에 trust 기록을 쓴다(중간. 사람의 설정 file을 고친다).
- eval: driver가 trust 화면 글을 보면 "Yes"를 고르고 기록에 남긴다(작음). 사람이 정했다.

정한 것:
- eval은 driver가 대신 고르고 `CodingTrace.trust_answered`에 남긴다(사람).
- 제품은 "알린다"로 한다. 터미널을 열고 첫 hook 신호를 아직 안 낸 coding session을 대기 목록에 "터미널에서 Claude Code 확인이 필요할 수 있다"로 보이고, 누르면 그 탭으로 focus가 간다. 화면 글은 긁지 않고, `~/.claude.json`은 쓰지 않는다(사람).

닫음: 제품은 알린다. 터미널을 열고 5초 안에 첫 hook 신호가 없는 coding session(첫 신호가 `SessionStarted`인 harness)을 shell renderer가 대기 목록에 `coding_start` 항목("Check the terminal")으로 넣고, 누르면 그 탭으로 focus가 간다. 첫 신호, `SessionEnded`, 터미널 exit, snapshot에서 들은 session이면 지운다(`packages/shell/renderer/desktop/connection/events/waiting-store.ts`). eval은 driver가 trust 화면에 답한다(`tests/eval/coding/driver/trust.ts`).

## coding agent의 message에 App Engineer가 글로만 답하면 터미널에 가지 않는다

```yaml
kind: bug
modules: [packages/core/lophn-agent, packages/core/agent-roles, packages/coding-agent]
closed: fixed
guard: packages/core/lophn-agent/run-loop/input-text_test.ts
```

지금: coding agent가 `lophn message send`로 물으면 core가 그것을 맡긴 App Engineer에게 `reply: "none"` call로 넣는다(`packages/core/apps/tickets/coding/message.ts` `applyMessage`). 보낸 쪽이 agent가 아니라 call 행과 id가 없다. App Engineer가 보는 봉투는 `<lophn-call from="coding_agent:ses_…" call="" reply="none">`이다(`packages/core/lophn-agent/run-loop/input-text.ts` `callText`). 답하는 법은 `reply === "result"`일 때만 적힌다. App Engineer 지침(`packages/core/agent-roles/roles/app-engineer/prompt.md`)은 "Answer, or fix the blueprint and dependency and tell it"뿐이다. 터미널에 닿는 길은 `call`의 `to:{session}`, `reply:"conversation"`이다.
- calendar-mvp 첫 run: App Engineer가 `to:{role:"coding_agent", place}`로 한 번 실패한 뒤 `to:{session}`로 답했고, coding agent는 이어 끝냈다.
- 저장되지 않은 calendar-diagnose run: App Engineer가 `guide.read`·`ticket.get` 뒤 글로만 답했다(중국어였다). `coding_inputs`가 비었고, coding agent는 `Stop` 뒤 11분 동안 답을 기다리다 lead가 run을 멈췄다.
- `lophn message send --help`는 `refs (선택, array)`로만 적어, coding agent가 객체를 넣고 `invalid_input`을 한 번 받았다.

영향: App Engineer가 글로 답하면 coding agent는 답을 못 받고 멈춘다. 사람이 터미널을 보지 않으면 ticket이 끝나지 않는다.

고치려면:
- (가) 봉투와 지침: `from.kind === "coding_agent"`인 call의 봉투에 "글은 터미널에 가지 않는다. `call`의 `to:{session:<id>}`, `reply:"conversation"`으로 답한다" 한 줄을 넣고, App Engineer 지침에 같은 길을 적는다. `--help`에 refs가 ticket id 문자열의 배열이라고 적는다(작음). 봉투는 받은 turn과 뒤 이력에서 같은 함수로 만들어 cache가 깨지지 않는다. 지침을 고치면 prefix가 한 번 바뀐다.
- (나) message를 call 행으로 남겨 `reply`로 답하게 한다(중간). call store와 `router.reply`가 coding session을 받는 쪽으로 다뤄야 하고, message마다 행이 생긴다.
- (다) 그 turn의 마지막 글을 core가 터미널로 보낸다(중간). 그 글은 사람에게 쓴 요약이라 터미널에 잡음이 들어가고, 한 turn에 사람 말과 coding agent의 물음이 섞이면 가를 수 없다.
추천: (가).

정한 것: (가). 답할지와 무엇을 답할지는 App Engineer가 정하고, core는 글을 터미널로 보내지 않는다(사람).

닫음: (가)로 고쳤다. `callText`(`packages/core/lophn-agent/run-loop/input-text.ts`)가 `from.kind === "coding_agent"`인 call의 봉투에 `Plain text does not reach its terminal. To answer, use call with to:{session:"<id>"} and reply:"conversation".`을 싣고, 받은 turn과 뒤 이력이 `from`만으로 같은 bytes를 만든다. App Engineer 지침도 같은 길과 `to:{role:"coding_agent", place}`는 새 ticket 맡기기 전용임을 적는다. `lophn message send --help`가 schema description을 보여 `refs`가 ticket id 문자열 배열임을 말한다.

## App Engineer의 `session.list`는 열린 coding session을 보여 주지 않는다

```yaml
kind: bug
modules: [packages/core/router, packages/core/main]
closed: fixed
guard: 없음
```

지금: `session.list`(`packages/core/lophn-agent/tools/call/sessions.ts` `listSendable`)는 router read(`packages/core/router/reads.ts` `sendableRead`)의 `directory.listOpen()`과 `queued_coding`을 돌려준다. coding session은 `withCodingSessions`(`packages/core/main/daemon/wiring/router-registration.ts`)가 `find`에만 더해 `listOpen`에 없다. 그래서 App Engineer가 열린 coding session id를 아는 길은 coding agent가 보낸 call의 봉투뿐이다.

영향: 봉투가 없는 turn(같은 앱의 새 App Engineer session, 사람이 "그 coding agent에게 이렇게 전해"라고 할 때)에서 App Engineer가 도는 coding session에 말을 걸 id를 찾지 못한다. `to:{role:"coding_agent", place}`는 새 맡기기라 줄에 선다.

고치려면: `withCodingSessions`가 `listOpen`에도 ended 아닌 coding session을 더한다(작음). 추천.

닫음: `withCodingSessions`(`packages/core/main/daemon/wiring/router-registration.ts`)의 `listOpen`이 `liveSessions`의 각 행을 `find`와 같은 `transport: "harness"` 대상(`role: "coding_agent"`, 이름은 harness label)으로 더한다. Router `describe`가 coding session의 place(그 앱)와 `stateOf`를 내서 목록 상태에 `waiting`이 생겼다(`packages/core/router/reads.ts` `STATES`). App Engineer 지침에 봉투가 없을 때 `session.list`의 id로 `to:{session}`, `reply:"conversation"`을 보내고 목록에 없으면 새 ticket으로 맡긴다는 줄을 더했다.

## 첫 신호 대기 항목은 터미널이 열릴 때 runtime을 받은 창에만 뜬다

```yaml
kind: bug
modules: [packages/shell/renderer, packages/protocol, packages/core/main]
closed: fixed
guard: 없음
```

지금: `coding_start` 항목(`packages/shell/renderer/desktop/connection/events/waiting-store.ts` `watchStart`)은 `TerminalApi.onRuntime`으로 터미널이 열리는 것을 본 창의 store만 센다. 터미널이 열린 뒤에 만든 창은 그 runtime event를 받지 못해 항목이 없다. event stream이 끊긴 사이 첫 신호를 들은 session의 runtime event가 다시 붙은 뒤 오면 `done`에 없어 5초 뒤 항목이 다시 뜨고, 다음 snapshot까지 남는다.

영향: 사람이 뒤에 연 창에서 일하면 trust 화면에서 멈춘 맡기기를 알지 못한다(먼저 연 창에는 뜬다). 다시 붙은 뒤에는 이미 시작한 session에 "Check the terminal"이 잠깐 잘못 뜰 수 있다.

고치려면: snapshot에서 `state === "unknown"`인 열린 coding session도 세고, runtime으로 센 session도 snapshot의 state로 거른다(작음). 추천.

닫음: session snapshot이 coding session의 `harness`를 싣는다(`packages/protocol/events/snapshot.ts`, `packages/core/main/daemon/wiring/session-snapshots.ts`). `waiting-store.ts` `replace`가 snapshot에서 `unknown`이고 첫 신호가 `SessionStarted`인 harness의 coding session에 runtime 길과 같은 `waitStart` delay를 걸고, 첫 신호를 들은 coding session은 `done`에 넣어 다시 붙은 뒤 온 runtime event가 항목을 다시 띄우지 않는다.

## example을 고친 reported ticket을 다시 넘기면 거절되고 model은 이유를 모른다

```yaml
kind: bug
modules: [packages/core/apps, packages/core/agent-roles, packages/core/lophn-agent]
closed: fixed
guard: 없음
```

지금: coding agent가 보고하면 program이 ticket의 examples를 돌린다. 떨어지면 `ticket_check_results`에 fail만 남고 ticket은 `reported` 그대로다(`apps/tickets/checks.ts`). App Engineer 지침(`agent-roles/roles/app-engineer/prompt.md`)은 "example 자체가 틀렸으면 `ticket.update`로 고치고 coding agent에게 다시 넘긴다"고 했다. `ticket.update`(`apps/tickets/commands.ts`)는 goal과 check만 바꾸고 state는 두며, 맡기기 시작(`apps/tickets/coding/transport.ts`의 `start`)은 `open`이나 `failed` ticket만 받아 `ticket_unavailable`(code `unavailable`)로 거절한다. `ticket.verify`에 `failed`를 먼저 넣어야 다시 넘길 수 있다. 지침에는 이제 그 순서를 썼지만 model이 빼먹으면 그대로 막힌다. model이 받는 글은 `lophn-agent/tools/work.ts`의 `FAILURE_SUMMARIES`가 code마다 고정한 "tool is unavailable"뿐이라 `details.reason`이 닿지 않는다. 재현: eval `calendar-user` 첫 run. examples step 3이 떨어졌고, App Engineer는 지침대로 `ticket.update` 뒤 `call to:{role:"coding_agent", place}`을 했다가 `unavailable`을 두 번 받고 turn을 끝냈다. 앱은 켜지지 않았다. 앞서 `calendar-mvp` run 하나도 다시 넘기기에서 같은 글로 멈췄다(detail은 확인 못 함).

영향: 첫 보고의 examples가 떨어진 앱 만들기가 그 자리에서 멈춘다. 사람은 만들다 만 앱을 받고, App Engineer는 무엇을 해야 풀리는지 알 길이 없다.

고치려면:
- examples가 떨어지면 program이 ticket을 `failed`로 둔다. examples를 못 넘긴 ticket은 어차피 verified가 될 수 없다(작음. `checks.ts`에서 verdict를 같이 쓴다. App Engineer의 `ticket.verify` 실패 기록 단계가 빠진다). **추천.**
- coding 시작 실패의 `details.reason`(`not_connected`, `cannot_launch`, `no_source_folder`, `ticket_unavailable`)을 model 글에 붙인다(작음. 넷 다 범위 밖 대상의 이름이나 존재를 드러내지 않는다). 추천안과 같이 한다.

닫음: ticket, examples check, coding agent에게 맡기기를 지웠다. App Engineer가 앱을 직접 짓고 preview에서 확인한 뒤 `release.activate`로 올린다. `release.prepare`의 검사 실패는 오류 code가 아니라 `{status: "failed", stage, reason}` 출력이라 이유가 model에 닿는다.

## `app.link_source`가 없는 폴더를 받아 그 앱의 coding agent가 뜨지 못한다

```yaml
kind: bug
modules: [packages/core/apps]
closed: fixed
guard: 없음
```

지금: `app.link_source`(`apps/agent-tools/app.ts`)는 경로를 풀어 `app.connect_source`로 넘기고, 그 command(`apps/registration/commands.ts`의 `connectSource`)는 폴더가 있는지 보지 않고 `source_path`를 적는다. 맡기기 전 template 깔기(`apps/tickets/coding/scaffold-source.ts`)는 `source_path`가 비었을 때만 하므로 건너뛴다. coding 터미널은 없는 폴더에서 열리다 실패하고(`open_failed`), session은 보고 없이 끝난다. 재현: eval `calendar-user`·`calendar-dev` 셋째 run. App Engineer가 blueprint를 먼저 쓰려다 `blueprint.check` not_found를 받고 `…/apps/<id>/calendar`를 지어내 연결했다. 그 뒤 다시 넘긴 다섯 번 모두 터미널이 열리지 않았다.

영향: agent 실수 한 번으로 그 앱의 코딩이 막힌다. App Engineer에게는 call이 accepted로 보이고 session이 바로 끝날 뿐이라 이유를 모른다. 사람이 Settings에서 source를 다시 고치기 전까지 풀리지 않는다.

고치려면:
- 연결 전에 폴더가 있고 git 저장소인지 본다. command는 tx 안이라 파일을 못 보므로 template 깔기처럼 writer 앞에서 본다(작음). **추천.**
- App Engineer의 `app.link_source`를 뺀다(작음. 사람이 가리킨 기존 저장소를 App Engineer가 잇는 길이 없어진다).

닫음: `app.connect_source`는 writer 앞 처리(`packages/core/apps/registration/source-folder.ts`의 `withSourceFolder`)가 폴더가 있고, git 저장소의 맨 위이고, commit이 있는지 먼저 보고 아니면 `invalid_input`이다. 새 앱의 source 폴더는 `app.create`가 commit된 뒤 core가 깔고 잇는다. git subprocess가 필요해 test는 두지 않았다.

## 지운 배포 skill의 얇은 사본이 사람 home에 남는다

```yaml
kind: bug
modules: [packages/coding-agent, packages/protocol]
closed: fixed
guard: `packages/coding-agent/harnesses/install_test.ts`의 "설치는 lophn이 놓은 지운 skill의 얇은 사본만 지우고, 사람이 고친 사본, 다른 file이 더 든 폴더, 다른 이름의 skill 폴더는 남긴다"
```

지금: `lophn harness install`은 `CODING_SKILL_NAMES`(`packages/protocol/coding-agent/harness-adapter.ts`)에 든 이름마다 `<home>/<skillDir>/<name>/SKILL.md`에 얇은 skill을 쓰기만 하고, 목록에서 빠진 이름의 사본은 지우지 않는다(`packages/coding-agent/harnesses/install.ts`의 `installSkill`). `lophn-repair`를 목록과 원본에서 지웠으므로, 앞서 설치한 사람의 `~/.claude/skills/lophn-repair/SKILL.md`가 그대로 남는다. 그 skill은 "`lophn guide lophn-repair`의 출력을 따른다"뿐인데, 이 이름은 이제 `guide` 입력 검사에서 거절된다.

영향: 그 사람의 coding agent는 어느 폴더에서든 `lophn-repair` skill을 목록에서 보고, 고르면 거절만 받는다. `ae-builds`가 `lophn-build-app`을 지우면 같은 일이 한 번 더 난다.

고치려면:
- 설치가 lophn이 쓴 얇은 사본(내용이 `thinSkill`의 꼴) 가운데 목록에 없는 이름을 지운다(작음). 사람이 고친 사본은 내용이 달라 남는다. 추천. `lophn-build-app`을 지우는 계획에서 같이 한다.
- 그대로 두고 사람이 지운다(없음. 사람이 알아야 한다).

닫음: 배포 skill(`lophn-build-app`)과 `CODING_SKILL_NAMES`를 지웠다. `lophn harness install`은 skill을 놓지 않고 `RETIRED_SKILL_NAMES`(`lophn-build-app`, `lophn-repair`)의 사본 가운데 폴더에 `SKILL.md` 하나뿐이고 글이 lophn이 쓰던 꼴과 byte까지 같은 것만 지운다. 설치는 coding session을 열 때만 저절로 돌고 지금은 여는 길이 없어, 옛 사본이 있는 사람은 `lophn harness install`을 한 번 돌려야 한다.

## codex는 새로 놓은 hook을 사람이 `/hooks`에서 trust해야 쓴다

```yaml
kind: bug
modules: [packages/coding-agent]
closed: fixed
guard: "codex hook install은 config.toml의 기존 내용을 그대로 두고 우리 hook의 trust 기록만 더한다" (packages/coding-agent/harnesses/install_test.ts), "codex hook hash는 Codex 자신의 test가 쓰는 hash와 같다" (packages/coding-agent/harnesses/codex-trust_test.ts)
```

지금: codex는 새로 놓이거나 바뀐 hook을 사람이 codex 안의 `/hooks`에서 trust하기 전까지 건너뛴다(learn.chatgpt.com/docs/hooks). trust 기록은 `~/.codex/config.toml`의 `[hooks.state."...hooks.json:stop:0:0"] trusted_hash`다. `harness install`은 toml을 쓰지 않는다. 설치된 codex 0.161.0 binary에도 `hooks need review before they can run` 문구와 `trusted_hash` 칸이 있다.

영향: codex에 맡기면 첫 번(그리고 hook이 바뀐 뒤)에는 사람이 trust할 때까지 turn 끝 신호가 안 와서 state가 unknown이다.

고치려면:
- 그대로 두고 confirm 화면에서 "codex에서 /hooks로 trust하라"를 알린다(작음).
- `config.toml`에 trust 기록을 쓴다(중간. toml을 고치는 코드와 hash 규칙을 알아야 한다).

닫음: 설치가 `~/.codex/config.toml`에 lophn hook마다 Codex와 같은 계산의 `trusted_hash`를 쓴다(`packages/coding-agent/harnesses/codex-trust.ts`, `install.ts`). 사람 허락은 lophn 창의 설치 dialog 한 번이고 `/hooks` trust가 필요 없다.

## harness agent를 켜는 화면에 harness가 아직 없다

```yaml
kind: bug
modules: [packages/shell/main, packages/core/config]
closed: fixed
guard: 없음
```

- 지금: harness agent의 켜기는 extension `harness`의 설정 `extensions.harness.enabled`(`packages/core/config/shell-settings.ts` `harnessExtensionSetting`, 기본 꺼짐)다. Settings › System › Extensions는 roots(개발은 shell main 안 `extensions/bundled/`)에서 manifest를 찾은 extension만 보이는데, harness의 manifest가 아직 없어 그 줄이 없다.
- 영향: harness agent를 쓰려는 사람이 data root의 `settings.json`을 직접 고쳐야 한다.
- 고치려면: harness host를 extension `harness`(manifest와 entry)로 둔다(계획 harness-agent의 headless host, 작음).

닫음: extension `harness`의 manifest(`packages/shell/main/extensions/bundled/harness/manifest.json`)가 있어 Settings › System › Extensions에 harness 줄이 보이고 켠다.
