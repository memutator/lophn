# sweep-folder-identity

folder sync, 기계 따라가기, project identity의 bug를 고친다.

- 단위: folder-identity (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/folder/`
  - `packages/protocol/folder/`
  - `packages/core/main/daemon/wiring/folder.ts`
  - `packages/core/apps/update-state/`
  - `packages/protocol/apps/{update-state.ts,sync/}`
  - `packages/shell/renderer/app-frame/app-detail/machines-section.tsx`
  - `packages/core/projects/`
  - `packages/protocol/projects/`
  - `packages/cli/commands/machine.ts`
- 읽을 것:
  - 고칠 이슈마다 `project-docs/issues/<id>.yaml`의 `now`·`fix`·`decided`(추천안과 정한 것이 할 일이다)와 그 이슈의 `topic` 이름의 `project-docs/architecture/<topic>.md`
  - 화면을 바꾸면 `.claude/skills/ui-design/SKILL.md`(wireframe을 먼저 고친다)
- 계약:
  - 쓰는 것: 소유 밖의 protocol, port, shell IPC, preload는 고치지 않는다. 필요하면 보고의 "계약 바꾸기 요청"에 적는다.
  - i18n catalog(`packages/design/i18n/catalog/`)에는 key를 더하기만 한다.

## 할 일

아래 이슈를 하나씩 고친다. 이슈 file은 고치지 않는다(lead가 닫는다). 이슈의 글이 지금 코드와 다르면 코드를 믿고 보고에 적는다.

1. `folder-away-notice-count-in-memory`
2. `folder-environment-hides-held-after-away`
3. `folder-first-export-before-peer-horizon`
4. `folder-held-limit-untested`
5. `folder-snapshot-future-clock-not-deferred`
6. `machine-environment-lacks-update-state`
7. `machine-update-diverged-held-says-older`
8. `machine-update-out-of-range-listed-under-every-app`
9. `machine-update-update-peer-unreachable`: `exchangeWith` 표 test
10. `take-in-leaves-app-without-release`
11. `project-clone-ssh-hint-ignores-port`
12. `project-clone-unreadable-identity-silent`
13. `project-renew-identity-declares-conflict`: Separate는 어떤 file이든 덮는다고 보고 선언에서 `conflict`를 뺀다

알아 둘 것:
- `packages/protocol/apps/sync/`는 폰 앱도 읽는다(zod와 `node:`를 import하지 않는다). `module-catalog.yaml`의 notes를 본다.
- ledger schema step을 더하면 등록(`WIRINGS`, `schema-steps.lock.json`)은 보고의 "등록할 것"에 적는다. lead가 넣는다.

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
