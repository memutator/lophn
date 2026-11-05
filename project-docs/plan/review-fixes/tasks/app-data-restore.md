# app-data-restore

app data DB restore가 crash로 live DB를 잃지 않게 하고, migrate 뒤 검사가 실패하면 backup으로 돌린다.

- 단위: app-data (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/apps/data/worker/restore.ts`
  - `packages/core/apps/data/worker/migrate.ts`
  - `packages/core/apps/data/worker/` 안의 그 둘의 test와 data worker 시작 file(restore 잔여물 복구를 넣을 곳 하나)
- 읽을 것:
  - `project-docs/architecture/`의 app data topic
  - `restore.ts` 78-86행(live DB와 WAL을 `restore.previous`로 하나씩 rename한 뒤 `restore.tmp`를 들임)
  - `migrate.ts` 150-181행
- 계약:
  - 쓰는 것: app data worker 메시지. 고치지 않는다.
  - 내놓는 것: 없음

## 할 일

1. **restore crash window** — 두 rename 사이에 crash가 나면 DB path에 아무것도 없고, 다음 open이 빈 DB를 만들고, 다음 restore의 `moveAside`가 `restore.previous`(유일한 사본)를 덮는다. data worker가 시작할 때(그 app DB를 열기 전에) DB가 없고 `restore.previous`가 있으면 되돌려 놓는다. 남은 `restore.tmp`는 지운다. `moveAside`는 이미 있는 `restore.previous`를 덮기 전에 live DB가 실제로 있는지 본다. (SQLite backup API로 바꾸는 것이 더 단순하면 그렇게 해도 된다. 보고에 정한 것으로 적는다.)
2. **migrate 반쯤** — migrate 뒤 integrity 검사나 target schema 검사가 실패하면 backup 복원 없이 `unavailable`을 돌려준다. 모든 사후 검사 실패에서 backup으로 돌린다. 복원 자체가 실패하면(Windows EPERM 등) 그것을 구별되는 오류 message(`details.reason: "restore_failed"`)로 낸다.

## 끝남

- `npm run check:full`이 통과한다(lead가 준 Windows 기준선 실패는 빼고).
- 위험 test:
  - "live DB가 `restore.previous`로 옮겨지고 새 DB가 들어오기 전에 멈춘 상태에서 data worker가 시작하면 원래 DB가 돌아온다"
  - "migrate 뒤 검사가 실패하면 DB가 migrate 전 상태로 돌아간다"
- `project-docs/plan/tools/lead/boot.sh`가 `boot 1 exit 0`, `boot 2 exit 0`.

## 보고

brief-template의 보고 꼴.
