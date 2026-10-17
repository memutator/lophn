# coding-agent

App Engineer가 ticket을 외부 coding agent에게 맡기는 길(session, 터미널, CLI, ticket)이다. `project-docs/architecture/coding-agent.md`.

## OpenCode 맡기기에서 메시지가 늘 `state_unknown`으로 거절된다

```yaml
kind: bug
modules: [packages/protocol, packages/coding-agent]
```

지금: `HARNESS_ADAPTERS.opencode.hook`이 `null`이라 `harness install`이 hook을 놓지 않는다(결과 `not_supported`). 그런데 `TURN_END_SIGNALS.opencode`는 `"session.status idle"`이라 `canDeliverMessages("opencode")`가 true다(`protocol/coding-agent/harness-adapter.ts`). 그래서 `core/apps/tickets/coding/transport.ts`의 `send`가 `no_turn_end_signal` 검사는 통과하고, hook이 한 번도 안 와 `row.heard`가 false인 채라 늘 `state_unknown`으로 거절한다. Settings에도 메시지를 받을 수 있는 제품으로 보인다.

영향: OpenCode로 맡기면 session은 뜨지만 App Engineer가 보내는 메시지는 전부 실패한다. 사람은 Settings 표시를 믿고 골랐다가 뒤에 안다.

고치려면:
- 신호 표에서 `opencode`를 `null`로 바꾼다(한 줄). 거절 이유가 `no_turn_end_signal`로 정직해지고 Settings도 맞게 보인다. `architecture/coding-agent.md`의 turn 끝 신호 목록에서 OpenCode를 같이 뺀다.
- project plugin 위치를 조사로 확인해 hook을 설치한다(조사 + install 코드, 중간).
- 추천: 앞쪽. hook 위치가 확인되면 그때 되살린다.

정한 것: 고친다. 전역 설치로 바꿀 때 OpenCode의 전역 plugin 위치를 확인해 hook을 놓는다.

## coding 완료 뒤 core가 harness를 멈추지 않는다

```yaml
kind: bug
modules: [packages/core/apps, packages/protocol]
```

지금: 완료 보고를 접수하면 claim만 끝나고 session(PTY)은 그대로다. token은 session이 끝날 때 회수한다(architecture 표의 "완료 보고: session 그대로"). 첫 prompt(`firstPromptOf`)는 "보고하라"까지만 말하고 보고 뒤 종료는 말하지 않는다. 터미널 `stop`은 call cancel·ticket 취소·lophn 끄기에서만 나간다. 또 harness 권한 물음은 `core/apps/tickets/coding/hook.ts`의 `permissionRequest`가 `mcp_tool` intent(server `harness:<id>`)를 빌려 만든다.

영향: 보고한 coding agent가 터미널 탭에 남아 있고 앱의 다음 맡기기는 줄에 서서 기다린다(앱 하나에 session 하나). 사람이 탭을 직접 닫아야 줄이 풀린다. `mcp_tool` 차용은 동작은 맞지만 이름이 다른 뜻이라 읽는 사람이 헷갈린다.

고치려면:
- 첫 prompt에 "보고한 뒤 종료한다"를 넣는다(한 줄, 제품이 따르는지는 보장 못함).
- 완료 보고 접수 뒤 core가 `stop` 터미널 요청을 낸다(Reactor의 완료 handler 한 곳, 작다). agent가 보고 뒤 답할 말이 남아 있어도 끊긴다.
- 추천: 둘 다. 앞의 것만으로는 보장이 없고 뒤의 것만으로는 마지막 출력이 잘릴 수 있어 짧은 유예를 둔다.

정한 것: 완료 보고 뒤 터미널(TUI)을 따로 끄지 않는다. 사람이 결과를 보고 직접 닫는다. `mcp_tool` intent를 빌리는 이름은 다이어트 계획에서 본다.

## coding session을 메모리 대신 ledger 표 셋과 `ApplyCodingSignal`로 둔다

```yaml
kind: defect
modules: [packages/core/apps, packages/core/storage]
```

지금: `coding_sessions`, `coding_lines`, `coding_inputs` 표(`core/apps/tickets/coding/schema.ts`)와 machine command `ApplyCodingSignal`(`signal.ts`)을 둔다. 이유는 schema 주석대로 command는 writer Worker에서 돌고 reader는 `CodingSessionLookup`과 줄을 읽어야 하는데 둘이 메모리를 같이 볼 수 없고, tx가 되돌아가면 표도 같이 되돌아가야 해서다. 값은 lophn이 꺼지면 의미를 잃어 켤 때 `recover`가 비운다. 감지 결과와 터미널 요청만 writer 메모리(`memory.ts`)에 있다.

영향: 표 셋, 상태 갱신 command, recover, 표를 읽는 `store.ts`·`lookup.ts`가 따로 늘었다. 휘발성 값에 schema step이 붙어 바꿀 때마다 표를 같이 고친다.

고치려면:
- main thread 한 곳에만 두고 core 읽기는 거기에 묻는다. Worker 경계를 넘는 port가 새로 필요하고, "상태·정산·call 닫기를 같은 transaction에서" 고치는 지금 불변 조건을 깨야 한다(큼).
- 남긴다. 표는 휘발성이지만 정산이 tx와 같이 가는 것이 이 구조의 이유다.
- 추천: 남기는 쪽. 이유가 schema 주석에 이미 있다.

정한 것: 다이어트 계획에서 줄일지 정한다.

## `mutates` 칸을 명령 이름 마지막 단어(`READ_WORDS`)로 가른다

```yaml
kind: defect
modules: [packages/coding-agent]
```

지금: `coding-agent/cli/commands/types.ts`의 `isReadName`이 이름의 마지막 단어가 `READ_WORDS`(list, show, status, blueprint, invocations, logs, more, diff, detect)에 있으면 읽기로 본다. `entryOf`가 이걸로 `mutates`를 채우고 help가 읽기/변경 목록을 가른다(`help.ts`).

영향: 새 변경 명령 이름이 우연히 이 단어로 끝나면 help가 읽기로 표시한다. 현재는 틀린 곳이 없어 화면 안내만 걸린다.

고치려면: `entryOf`에 `mutates`를 명시 인자로 받고 `READ_WORDS`와 `isReadName`을 지운다(명령 수만큼 한 줄씩, 작다). 추천: 이대로.

## `ticket.cancel`이 transport의 active·waiting call을 찾아 멈춘다

```yaml
kind: defect
modules: [packages/core/apps]
```

지금: `core/apps/tickets/commands.ts`의 `cancel`이 `stopCodingCalls`에서 `CodingTransport.lines()`를 돌며 이 ticket의 active·waiting call을 찾아 `stop(reason: "ticket_cancelled")`을 부른다. transport의 `stop`은 이 이유일 때 Router를 거치지 않으므로 call 상태도 직접 `cancelled`로 옮긴다(`transport.ts`).

영향: ticket 모듈이 coding session의 줄 구조를 알고, call 취소 책임이 Router와 transport로 갈라진다. transport 모양을 바꾸면 ticket 취소도 같이 고친다.

고치려면:
- ticket 취소는 domain event만 내고 transport 쪽 handler가 줄을 정리한다(Reactor handler 하나 더, 중간). 같은 tx 안 일관성이 약해진다.
- 남긴다. 지금 방식은 취소·claim 삭제·call 취소가 한 tx다.
- 추천: 남긴다. archived로 닫는다(kept).

정한 것: 다이어트 계획에서 줄일지 정한다.

## ticket 표가 6개다

```yaml
kind: defect
modules: [packages/core/apps]
```

지금: `tickets`, `ticket_references`, `ticket_claims`, `ticket_completions`, `ticket_check_results`, `ticket_verdicts`(`core/apps/tickets/schema.ts`). 보고마다 completion 한 줄(불변, trigger), check 결과 한 줄(Reactor가 나중에 한 번 기록), verdict 한 줄(불변).

영향: ticket 하나의 한 번 보고를 읽으려면 표 셋을 join한다. 표를 더하거나 바꿀 때 trigger와 외래 키까지 같이 본다.

고치려면: completion·check·verdict를 한 표의 열로 합친다. 그러면 completion 불변 trigger가 나중에 채워지는 열과 부딪쳐 열마다 트리거를 따로 걸어야 한다(중간). 추천: 남긴다. 세 줄은 쓰는 때와 쓰는 주체가 달라 따로 불변으로 두는 편이 단순하다.

정한 것: 다이어트 계획에서 줄일지 정한다.

## ticket마다 revision, claim_seq, completion_seq

```yaml
kind: defect
modules: [packages/core/apps]
```

지금: 카운터는 `tickets.revision`(1부터, 바뀔 때마다 `nextRevision`) 하나뿐이다. `claim_seq`는 claim 때의 revision 값이고(`claims.ts`), `completion_seq`는 `TicketCompletionReported` 이벤트의 seq다. 쓰임: `base_revision` 비교(claim, release, check, verdict 등)가 낙관적 동시성을 막고, `claim_seq`가 옛 claim의 늦은 보고를 거절하며, `completion_seq`가 옛 보고의 검사가 새 보고를 덮지 않게 한다.

영향: 이름이 셋이라 카운터가 셋으로 보이지만 값은 둘(revision, event seq)이다. 읽는 사람이 헷갈릴 뿐 별도 장치는 없다.

고치려면: 셋을 줄이면 위 세 가지 늦은 요청 방어 중 하나가 빠진다. 추천: 남긴다. 이유("각각 어떤 늦은 요청을 막는가")를 `model.ts` 주석에 한 줄 더한다.

## 앱마다 coding session 하나와 call 줄, 실패 이유

```yaml
kind: defect
modules: [packages/core/apps]
```

지금: 앱마다 끝나지 않은 session은 하나이고(`coding_sessions_active` unique index) 그동안 온 맡기기는 `coding_lines`에 줄을 선다. 실패 이유는 시작 4(`not_connected`, `cannot_launch`, `no_source_folder`, `ticket_unavailable`), 메시지 거절 3(`no_turn_end_signal`, `state_unknown`, `session_ended`), 터미널 4(`spawn_failed`, `no_terminal`, `folder_missing`, `host_lost`)다(`protocol/coding-agent/transport.ts`, `terminal-requests.ts`). 옛 글의 "여섯"은 지금 코드와 안 맞는다.

영향: 이유마다 문구와 호출처 처리가 있어 늘어난다. 줄은 같은 source 폴더에 session 둘이 부딪치는 것을 막는 장치다.

고치려면: 줄을 없애고 바쁨으로 돌려주면 다시 맡길 때를 보낸 쪽이 알 길이 없다(architecture "busy 실패 대신 줄에 세운다"). 이유는 호출처가 갈라 처리하는 것만 남긴다. 추천: 남긴다. 이유는 이미 architecture에 있으니 이 절은 kept로 닫는다.

정한 것: 다이어트 계획에서 줄일지 정한다.

## 텍스트 출력의 data fence

```yaml
kind: defect
modules: [packages/coding-agent]
```

지금: `coding-agent/cli/output.ts`의 `renderLines`가 공백 없는 짧은 token(`isPlainToken`: 128자 이하, `[\w.:/@+#=-]`)이 아닌 문자열은 모두 `fence.ts`의 `fenceBlock`으로 감싼다. 자료 안의 `<<<`는 깬다.

영향: 출력 규칙이 두 갈래다. 그러나 이 규칙은 ticket 본문 같은 자료가 안내 글과 섞여 coding agent를 조종하지 못하게 하는 경계다(architecture "지키는 것").

고치려면: 규칙을 줄이면 prompt injection 방어가 약해진다. 추천: 남긴다. 이유를 `fence.ts` 주석에 이미 적었으니 kept로 닫는다.

정한 것: 지운다. 사용자 앱과 사람이 쓴 글은 공격자로 보지 않는다(AGENTS.md). `fence.ts`와 `renderLines`의 분기를 지우고 값을 그대로 쓴다.

## harness 감지 결과를 shell main 메모리에 쥔다

```yaml
kind: defect
modules: [packages/shell/main]
```

지금: `shell/main/desktop/coding-connection.ts`가 마지막 성공 감지 결과(`last`)를 메모리에 쥐고, 실패한 결과는 쥐지 않아 다음 `read`가 다시 감지한다. core로 알리기(`report`)가 실패하면 다음 `read`에서 다시 알린다. 새로 감지는 `refresh`일 때만 한다.

영향: 결함이라기보다 결정 기록이다. 메모리에만 있어 shell을 다시 켜면 처음 읽을 때 감지를 한 번 더 한다.

고치려면: 저장하면 표와 무효화 규칙이 늘고 PATH가 바뀌면 낡는다. 추천: 남긴다. 이유를 `last` 위 주석에 이미 적었으니 kept로 닫는다.

정한 것: 다이어트 계획에서 줄일지 정한다.

## check는 test를 다시 돌리지 않고 기록된 Verification만 읽는다

```yaml
kind: defect
modules: [packages/core/apps]
```

지금: `core/apps/tickets/checks.ts`의 `loadCheckWork`가 `verifications` 표에서 release의 bundle hash(`app_test`) 또는 이 ticket·completion의 `test_command` 기록만 읽어 `check_work`로 모은다. check 때 test를 다시 돌리지 않는다.

영향: 결함이라기보다 결정 기록이다. test는 앞 단계(app test, test command)가 이미 기록한다. 다시 돌리는 비용과 sandbox를 피한다.

고치려면: 다시 돌리면 sandbox·시간·부작용이 늘어 크다. 추천: 남긴다. 이유를 `loadCheckWork` 주석에 두고 kept로 닫는다.

정한 것: 다이어트 계획에서 줄일지 정한다.

## harness 전역 설치 위치 가운데 확인 못한 것이 있다

```yaml
kind: bug
modules: [packages/protocol, packages/coding-agent]
```

지금: `harness-global-install`이 `HARNESS_ADAPTERS`의 전역 위치를 공식 문서(WebFetch)로 확인했다. 확인한 것: claude skill `~/.claude/skills`·hook `~/.claude/settings.json`, codex hook `~/.codex/hooks.json`(feature flag 불필요), gemini skill `~/.gemini/skills`·hook `~/.gemini/settings.json`(`AfterAgent`), pi extension `~/.pi/agent/extensions/*.ts`, opencode skill `~/.config/opencode/skills`. 확인 못함:
- codex skill `~/.agents/skills`: codex 문서로 직접 확인하지 못했다(opencode와 gemini 문서가 `~/.agents/skills`를 지원한다고 적었을 뿐).
- pi skill: `~/.pi/agent/skills`를 확인하지 못해 pi 문서가 지원한다고 적은 `~/.agents/skills`로 했다. pi extension 원문의 `ctx.sessionManager.getSessionId()`와 `aborted` 칸도 확인 못함.
- gemini: 문서에 "Gemini CLI가 2026-06에 Antigravity CLI로 대체됐다"는 말이 있어 위치가 바뀌었을 수 있다.
- hermes, openclaw: prompt 전달, skill, hook 모두 확인 못함이라 null이다. 감지만 되고 맡길 수 없다.
- opencode hook(plugin) 위치는 `harness-opencode`가 다룬다.
- gemini, pi, hermes, openclaw는 이 컴퓨터에 설치돼 있지 않아 실제 실행으로는 하나도 확인하지 못했다.

영향: 확인 못한 위치에 놓은 skill·hook은 harness가 읽지 않을 수 있다. 그러면 hook이 없어 coding session state가 unknown이고 skill이 안 보인다.

고치려면: 그 harness를 설치한 컴퓨터에서 `harness install` 뒤 한 번 맡겨 hook signal과 skill이 보이는지 본다(harness마다 작음).

## codex는 새로 놓은 hook을 사람이 `/hooks`에서 trust해야 쓴다

```yaml
kind: bug
modules: [packages/coding-agent]
```

지금: codex는 새로 놓이거나 바뀐 hook을 사람이 codex 안의 `/hooks`에서 trust하기 전까지 건너뛴다(learn.chatgpt.com/docs/hooks). trust 기록은 `~/.codex/config.toml`의 `[hooks.state."...hooks.json:stop:0:0"] trusted_hash`다. `harness install`은 toml을 쓰지 않는다.

영향: codex에 맡기면 첫 번(그리고 hook이 바뀐 뒤)에는 사람이 trust할 때까지 turn 끝 신호가 안 와서 state가 unknown이다.

고치려면:
- 그대로 두고 confirm 화면에서 "codex에서 /hooks로 trust하라"를 알린다(작음).
- `config.toml`에 trust 기록을 쓴다(중간. toml을 고치는 코드와 hash 규칙을 알아야 한다).

## 전역 hook command가 PATH의 `lophn`을 부른다

```yaml
kind: bug
modules: [packages/coding-agent]
```

지금: 전역 hook은 `lophn hook <harness> <event>`이고 `lophn`이 PATH에 있다고 본다. 개발 실행(`LOPHN_CLI`)에서는 PATH의 `lophn`이 없거나 다른 판이라 전역 hook이 맞지 않는다.

영향: 개발 중에는 coding session의 turn 끝 신호가 안 오거나 설치된 판의 core로 간다.

고치려면: 개발 실행에서는 hook command에 `LOPHN_CLI` 경로를 쓴다(작음). 다만 전역 설정에 개발 경로가 남는다.

## harness 전역 install 코드가 단계마다 Step을 돌려준다

```yaml
kind: defect
modules: [packages/coding-agent]
```

지금: `coding-agent/harnesses/install.ts`(약 230줄)가 dry_run, json hook, plugin file, skill마다 `Step`을 따로 만들어 합친다. `thinSkill`은 원본 SKILL.md의 frontmatter를 정규식으로 뽑고, 깨졌으면 name만 있는 frontmatter로 대신한다.

영향: 놓을 것이 셋뿐인데 길다. frontmatter 대체는 우리 원본이 깨질 때만 쓰이는 방어 코드다.

고치려면: dry_run을 "쓰기 port를 바꿔 끼우기"로 바꿔 Step을 없앤다(작음). frontmatter 대체는 지운다(작음).
