# sweep-docs

wave 1이 바꾼 동작에 architecture 문서와 flows를 맞춘다. 코드는 고치지 않는다.

- 단위: docs (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `project-docs/architecture/`
  - `project-docs/flows/`
  - `packages/mobile/README.md`
- 읽을 것:
  - 고칠 이슈마다 `project-docs/issues/<id>.yaml`의 `now`·`fix`·`decided`(`fix`의 "한 것" 줄이 wave 1이 이미 한 부분이다)와 그 이슈의 `topic` 이름의 `project-docs/architecture/<topic>.md`
  - 화면을 바꾸면 `.claude/skills/ui-design/SKILL.md`(wireframe을 먼저 고친다)
- 계약:
  - 이 task는 아래 소유에 든 protocol, IPC, preload를 고쳐도 된다(wave 1이 계약 밖이라 못 한 일이다). 소유 밖의 계약은 고치지 않고 보고에 적는다.
  - i18n catalog(`packages/design/i18n/catalog/`)에는 key를 더하기만 한다.

## 할 일

1. `/tmp/lophn-issue-sort/lead-log.md`(lead의 기록, 영어)에서 `TODO lead docs`와 `Docs for the lead`로 적힌 줄을 모두 모은다. worker들이 "코드가 이렇게 바뀌어 이 문서 줄이 낡았다"고 알린 목록이다.
2. 줄마다 지금 코드(이 worktree)를 열어 확인하고 문서를 고친다. worker의 말을 그대로 옮기지 않는다. architecture 문서는 동작과 결정을 적고 code path는 적지 않는다(AGENTS.md "문서").
3. 닫힌 이슈를 가리키는 "열린 것" 줄을 지우거나 고친다: `grep -rn "이슈" project-docs/architecture`의 id마다 `project-docs/issues/<id>.yaml`의 `status`를 본다. fixed면 그 줄을 지우고 본문에 지금 동작을 적는다. kept면 한계로 남긴다.
4. `project-docs/architecture/remote.md`의 비목표에서 "폰이 터미널 크기를 바꾸는 것"을 빼고, 폰의 목록 규칙(desktop과 같은 규칙을 같이 쓴다)과 폰이 file로 두는 것(목록, 이름, 아이콘. 대화는 두지 않는다)을 적는다.
5. `project-docs/flows/`: lead-log가 적은 줄(`ipc.yaml`, `shell-desktop.yaml`, `core-platform.yaml`, `sessions.yaml`, `shell-workspace.yaml`, `app-runtime.yaml`, `tests/core-rest.yaml`)을 고치고 `node tools/flows.ts check`를 돈다. `flows` skill을 읽는다.
6. `packages/mobile/README.md`: lead-log의 sweep-phone-local-apps 줄(124, 184, 185, 270줄 근처)을 지금 코드에 맞춘다.

알아 둘 것:
- 이 task는 project-docs를 고치는 것이 일이다(worker prompt의 "project-docs를 고치지 않는다"의 예외). `project-docs/issues/`와 `project-docs/plan/`, `project-docs/products/`는 고치지 않는다.
- wave 2의 다른 task가 같은 때 code를 고친다. 그 task들이 바꿀 동작(터미널 화면으로 remote, tool 본문을 펼칠 때 받기, 주소 새로 받기)은 아직 적지 않는다.
- 말은 AGENTS.md "말"을 따른다(개발자 영어 단어 그대로, 번역어를 새로 만들지 않는다). 날짜, task id, commit hash를 적지 않는다.

## 끝남

- `npm run check:full`이 통과한다(docs, flows, records 단계 포함).
- 위험 test: 없음
- 항목마다 했는지, 못 했으면 왜인지가 보고에 있다.

## 보고

- 항목마다: 고침 / 일부 / 못 함(이유), 지금 코드가 어떻게 하나 한두 문장, 지키는 test 이름(없으면 없음)
- 바꾼 file, 통과한 check
- 등록할 것, 안 쓰게 된 export, 정한 것, 넘길 줄, 계약 바꾸기 요청
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것(실제 폰이나 Electron에서 못 본 것 포함). 없으면 "없음"
