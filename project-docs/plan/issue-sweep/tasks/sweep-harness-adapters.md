# sweep-harness-adapters

harness GUI adapter의 bug를 고친다: effort 이어 가기, replay와 live의 어긋남, 숨길 command, 다시 열 때의 그림, 줄 세우기 code, 탭의 session 추적.

- 단위: harness-adapters (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/main/extensions/bundled/harness-gui/`
  - `packages/shell/main/terminal/{gui.ts,gui_test.ts,agent/}`
  - `packages/coding-agent/local/`
  - `packages/protocol/acp/{state.ts,input.ts}`
- 읽을 것:
  - 고칠 이슈마다 `project-docs/issues/<id>.yaml`의 `now`·`fix`·`decided`(추천안과 정한 것이 할 일이다)와 그 이슈의 `topic` 이름의 `project-docs/architecture/<topic>.md`
  - 화면을 바꾸면 `.claude/skills/ui-design/SKILL.md`(wireframe을 먼저 고친다)
- 계약:
  - 쓰는 것: 소유 밖의 protocol, port, shell IPC, preload는 고치지 않는다. 필요하면 보고의 "계약 바꾸기 요청"에 적는다.
  - i18n catalog(`packages/design/i18n/catalog/`)에는 key를 더하기만 한다.

## 할 일

아래 이슈를 하나씩 고친다. 이슈 file은 고치지 않는다(lead가 닫는다). 이슈의 글이 지금 코드와 다르면 코드를 믿고 보고에 적는다.

1. `claude-gui-effort-lost-on-new-run`
2. `claude-replay-shows-rows-live-hides`: 작은 안
3. `claude-gui-offers-remote-control`: `decided`: 숨긴다
4. `claude-gui-resume-drops-images`: omp replay도
5. `opencode-foreign-call-drawn-as-user`
6. `adapter-queue-code-duplicated`: 작은 안
7. `nested-harness-session-enters-tab-recent`

알아 둘 것:
- 실제 CLI를 부르는 녹화는 하지 않는다(사람에게 묻는 일이다). 있는 fixture와 test로 한다. `.claude/skills/harness-gui/SKILL.md`를 먼저 읽는다.
- 대화 화면(`packages/shell/renderer/conversation/`)은 `sweep-phone-chat`의 것이다. ACP item 모양을 바꿔 화면이 따라와야 하는 것(`claude-agent-row-emitted-late`, `claude-bang-output-shown-at-end`)은 이 task에서 하지 않는다.

## 끝남

- `npm run check:full`이 통과한다.
- 위험 test: 이슈의 `fix`가 "test를 쓴다"고 한 것과 데이터·권한에 닿는 것만(`write-test` skill). 나머지는 없음
- 이슈마다 고쳤는지, 못 고쳤으면 왜인지가 보고에 있다.

## 보고

- 이슈마다: 고침 / 일부 / 못 함(이유), 지금 코드가 어떻게 하나 한두 문장, 지키는 test 이름(없으면 없음)
- 바꾼 file, 통과한 check
- 등록할 것, 안 쓰게 된 export, 정한 것, 넘길 줄, 계약 바꾸기 요청
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것(실제 폰이나 Electron에서 못 본 것 포함). 없으면 "없음"
