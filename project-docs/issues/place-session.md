# place-session

agent가 놓이는 place와 session의 열림·끝남·fork·rewind의 열린 이슈다. 흐름과 불변 조건은 `project-docs/architecture/place-session.md`.

## PM이 초안 폴더를 연 같은 turn에 쓰면 forbidden이다

```yaml
kind: bug
modules: [packages/core/lophn-agent, packages/core/main, packages/core/projects]
```

지금: file tool이 닿는 폴더(`scope`)는 turn을 시작할 때 `run-loop/prepare.ts`가 `readPlaceData`로 한 번 채운다. 열린 초안 폴더는 `openDraftFolders`가 그때 읽는다. Project Manager가 `context.draft`(`tools/context/draft.ts`의 `openDraft`)로 폴더를 새로 열어도 `ctx.scope`에는 더하지 않아, 같은 turn의 `file.write`가 scope 밖으로 거절된다. 다음 turn부터 된다. 두 번째 문제는 rewind 쪽이다. `main/daemon/rewind-glue.ts`의 `placeFoldersOf`가 따로 폴더 목록을 만드는데 Project Manager의 project 폴더와 App Engineer의 source만 있고 초안 폴더가 없다. `StageRewindFile`/`RecordRewindWrite`가 `the folder is not open to this session`으로 거절하고, `recordBeforeWrite`는 그래도 쓰기를 하되 `recorded=false`를 낸다. 초안 폴더 쓰기는 다음 turn부터도 rewind로 되돌릴 수 없다.

영향: PM이 폴더를 열고 바로 계약을 쓰지 못해 turn 하나를 헛돈다(token). 초안 파일 쓰기는 "쓴 뒤 되돌리기"가 안 되어 rewind 약속(파일 쓰기는 되돌릴 수 있다)이 이 경로에서만 깨진다.

고치려면:
- A. `openDraft`가 성공하면 `ctx.scope`의 read·write에 `folder`를 더한다(타입은 readonly지만 실체는 `prepare.ts`의 가변 배열). 한 줄이고 비용 작다.
- B. scope를 만드는 곳을 하나로 합친다. `placeFoldersOf`가 `place-data.ts`와 같은 규칙을 쓰게 해(초안 폴더와 project Operator 포함) 같은 모양의 복사본 둘을 없앤다. 비용 중간.
- 추천: A를 지금, B를 같이 한다. 폴더 목록이 둘이라 한쪽만 고치면 이번처럼 어긋난다.

## 앱 place의 Operator는 file 범위가 없다

```yaml
kind: bug
modules: [packages/core/lophn-agent, packages/core/main]
```

지금: `run-loop/place-data.ts`의 `readPlaceData`는 project place면 role과 상관없이 project 폴더를 read·write에 넣고(Operator도 받는다), app place는 `role === "app_engineer"`일 때만 앱 `source_path`를 넣는다. 앱 place의 Operator는 scope가 비어 file tool을 쓸 폴더가 없다. `rewind-glue.ts`의 `placeFoldersOf`도 같은 이유로 `[]`를 준다. architecture 문서는 project의 Operator만 폴더를 적고 앱 place의 Operator는 말이 없다.

영향: 앱에 놓인 Operator는 grant받은 tool과 context는 쓰지만 앱 폴더 file은 읽고 쓰지 못한다. 앱 폴더 일을 맡길 수 없다.

고치려면: `place-data.ts`의 app 분기에서 `role === "app_engineer"` 조건에 operator를 더하고(`placeFoldersOf`도 같이), architecture의 file tool 줄에 앱 Operator를 적는다. 비용 작다. 다만 쓰기를 Operator에게 여는 것은 권한 결정이다.

정한 것: 앱 Operator에게 앱 source 폴더 읽기를 준다. 쓰기는 주지 않는다.

## session 되살리기(unarchive) route에 handler가 없다

```yaml
kind: defect
modules: [packages/protocol, packages/core/lophn-agent]
```

지금: `protocol/lophn-agent/sessions.ts`에 `unarchiveSession` command가 정의되고 `registry.ts`에 등록돼 있지만 `lophn-agent/session/commands.ts`에는 archive·delete·rename만 있고 handler가 없다. UI(`agent-tab-core-source-sessions.ts`)도 부르지 않는다. architecture 문서가 이미 "archive를 풀어 다시 여는 것(되살리기)은 지금 없다. 되살리면 session 허락과 대기 request가 돌아오지 않는 규칙을 따로 정해야 한다"고 적었다. 그러니 기능 누락이 아니라 정의만 남은 죽은 route다.

영향: 계약은 있는데 동작이 없어, 쓸 수 있는 기능으로 오해하게 한다.

고치려면:
- A. route와 schema를 지운다. 비용 작다. 문서와 일치한다.
- B. 지금 짓는다. archive가 call을 닫고 허락을 버리는 것(`endSession`)을 되돌릴 수 없어, 되살린 session이 받는 것과 못 받는 것의 규칙을 먼저 정해야 한다. 비용 중간~큼.
- 추천: A. 닫힌 session은 새 session으로 이어 가는 게 지금 설계다.

정한 것: 지운다. 반쯤 만들고 안 쓰는 길은 지우고 필요해지면 그때 다시 만든다.

## 숨김 구간을 `reverts.result_seq`로 잡는 규칙

```yaml
kind: defect
modules: [packages/core/lophn-agent]
```

지금: rewind가 숨기는 구간은 `boundary_seq`부터 결과를 확정한 때의 session 마지막 메시지 순번 `result_seq`까지다(`session/rewind/hidden.ts`의 `hiddenRangesOf`, `summary-read.ts`도 같은 칸을 읽는다). 그 뒤에 접수한 메시지는 숨기지 않는다. 이유(숨김에 끝이 없으면 rewind 뒤의 대화가 모두 사라진다)는 `hidden.ts` 머리 주석에 이미 있다.

영향: 숨김 끝이 messages가 아니라 reverts 행의 `result_seq`에서 나오는 숨은 규칙이다. 이유 설명은 코드에 있어 남는 비용은 작다.

고치려면: 추천: 남긴다(kept). 주석이 이미 이유를 적었으니 별도 작업 없이 닫는다.

정한 것: 다이어트 계획에서 줄일지 정한다.
