# inbox-sdk-migration: inbox 기록과 SDK migration

- 목표: 사람에게 오는 것을 답할 것·알림(휘발)·기록(영구)으로 가르고 release·앱 멈춤·data migration·lophn 업데이트를 기록으로 남긴다. SDK 판이 바뀌면 lophn이 앱마다 필수/가능을 알아 기록하고, 사람이 맡기면 home lophn이 정리해 앱 lophn에게 넘겨 `migrate-sdk`대로 옮긴다.
- 재료: `project-docs/products/roadmap/inbox-history-sdk-migration.md`(정한 것 1~12, 지금 코드), `project-docs/architecture/app-notice.md`, `approval.md`, `activation.md`, `event.md`, `agent-call.md`, `app-call.md`.
- 범위 밖: 오래된 migration 메모 합치기(제품을 낼 때 사람이 정한다). data root에 옛 SDK 사본 싣기. archived 앱 되살리기를 agent가 하는 길.

## 정한 것

roadmap의 정한 것 1~12가 이 계획의 결정이다. 그 위에 lead가 정한 것:

1. 기록 하나는 선택 `action`을 갖는다(예: `{kind: "open_home_skill", skill, args}`). 화면은 action을 종류로만 그리고 누르면 실행한다. 기록 표가 action을 정하고(ih-records), 화면이 그리고(ih-inbox-ui), SDK 감지가 채운다(ih-sdk-detect). (agent)
2. 판별 메모 파일 이름은 `<sdk 이름에서 @lophn/를 뺀 것>-<version>.md`다. 지원 하한은 SDK `package.json`의 `lophn.supported_from`이다. (agent)
3. "lophn이 업데이트됐다"는 data root의 마지막 제품 판(ledger 값)과 지금 판이 다를 때다. 새 data root는 지금 판을 적고 기록을 남기지 않는다. (agent)

## task

| wave | id | 한 줄 |
|---|---|---|
| 1 | ih-records | roadmap 단계 1: `app_notices`를 합친 영구/휘발 기록 표, `action`, program 쓰기 route, `@lophn/cap-notify` 영구 option, 남기는 기간, 옮기기 |
| 1 | ih-sdk-notes | 단계 4: `migrate-sdk` skill과 지금 판들의 메모, `supported_from`, 메모 없는 판 올리기를 막는 check |
| 1 | ih-archived | 단계 6: agent의 앱 read·사용처·call에서 archived 앱 빼기 |
| 2 | ih-program-records | 단계 2: release·앱 멈춤·data migration·lophn 업데이트 기록, 마지막 제품 판 |
| 2 | ih-inbox-ui | 단계 3: Inbox 답할 것·알림·기록, 기록 거르기·찾기, action 단추, 앱 상세 Activity |
| 3 | ih-sdk-detect | 단계 5: SDK 상태 read, 필수/가능 기록, `update-apps` home skill, private handoff 예외 |

## lead가 할 일

- task마다 worktree를 `plan/inbox-sdk-migration`에서 열고 review한 뒤 이 branch로 merge한다. wave가 끝나면 `npm run check`를 돌린다.
- 다 끝나면 changelog 열린 판(0.20.0)에 항목을 쓰고 roadmap 상태를 고치고 이 폴더를 지운 뒤 main에 올린다.
