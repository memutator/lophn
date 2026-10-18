# ec-fix-callid

App Engineer가 call의 받는 쪽을 `{ role: "coding_agent", place: { app: "app_..." } }`처럼 앱 id로 적으면 core가 `not_found`로 실패시킨다. 앱 찾기가 slug와 이름만 본다. id에서 앱을 찾는 일은 결정적이니 program이 받는다(사람의 원칙: 결정적인 것은 program이 한다).

- 단위: ec-fix-callid (wave 6)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/main/daemon/wiring/lophn-agent-registration.ts`(`appByName`)
  - `packages/core/apps/tickets/coding/scaffold-source.ts`(source 없는 앱 찾기)
- 읽을 것:
  - 첫 run(calendar-mvp)의 기록: App Engineer의 `call` 입력 `to: { place: { app: "app_0000000000000000000000cdr1" }, role: "coding_agent" }` → `call ... failed: not_found`.
  - `packages/core/main/daemon/wiring/lophn-agent-registration.ts`의 `apps.appByName`(`select * from apps where slug = ? or name = ?`)과 그것을 쓰는 곳(받는 쪽 풀기)
  - `packages/core/apps/tickets/coding/scaffold-source.ts`의 `sourcelessAppNamed`(`(slug = ? or name = ?) and source_path is null`)
  - project도 같은 문제가 있는지(`projectByName`) 본다. 있으면 같이 고친다.
- 계약: route와 protocol은 바꾸지 않는다.

## 할 일

1. 받는 쪽의 앱을 풀 때 id(`app_...`)도 받는다. id, slug, 이름 가운데 맞는 하나다. 같은 앱 이름 규칙을 쓰는 다른 곳(source 자동 생성의 앱 찾기)도 같은 규칙으로 맞춘다. 두 곳이 같은 SQL을 따로 들고 있으면 하나로 모을 수 있는지 보고, 모으는 비용이 작으면 모은다.
2. project 받는 쪽도 이름만 받으면 id도 받게 한다.

## 끝남

- `deno task check:full`이 통과한다. core가 두 번 뜬다.
- 확인(probe, commit하지 않음): fake provider로 source 없는 앱을 만들고 App Engineer가 `place.app`에 앱 id를 적어 coding agent에게 call하면 source가 깔리고 `coding_terminal` `open` frame이 온다.
- 위험 test: 없음.

## 보고

- 바꾼 file
- 통과한 check
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
