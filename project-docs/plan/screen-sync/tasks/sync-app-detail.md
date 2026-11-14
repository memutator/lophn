# sync-app-detail

앱 상세와 preview 탭을 공통 읽기로 옮기고 polling을 지운다.

- 단위: sync (wave 3)
- 선행: sync-read.
- 소유(이 task만 고친다):
  - `packages/shell/renderer/app-frame/app-detail/`(`use-read.ts`는 빼고)
  - `packages/shell/renderer/app-frame/app-runs.ts`
  - `packages/shell/renderer/workspace/app-preview-tab.tsx`
- 읽을 것:
  - 계획 README "정한 것"
  - roadmap: `project-docs/products/roadmap/screen-sync.md`의 "지금 코드 › 읽는 쪽"
  - architecture: `project-docs/architecture/activation.md`, `app-call.md`의 rewind
- 계약:
  - 쓰는 것: `useCoreRead`
  - 내놓는 것: 없음

## 할 일

1. `run-section.tsx`(3초), `access-tab.tsx`(2초), `versions-tab.tsx`(2초), `rewind-panel.tsx`(1.5초), `app-preview-tab.tsx`(2초)의 polling을 지우고 `useCoreRead`로 바꾼다. `activity-tab.tsx`도 옮긴다.
2. polling이 기다리던 일(release 적용, rollback, revoke 정리, 앱 process 시작, rewind 진행, preview 시작과 끝)이 끝날 때 도는 route가 맞는 `changes`를 내는지 확인한다. 내지 않으면 "계약 바꾸기 요청"에 적는다(route 정의는 고치지 않는다).
3. `app-runs.ts`가 session 상태가 바뀔 때마다 다시 읽는 것을 `useCoreRead`로 바꾼다.
4. `use-read.ts`는 지우지 않는다(`sync-fold`가 지운다).

## 끝남

- `npm run check`가 통과한다.
- 위험 test: 없음
- 남지 않음: 소유 path에서 `grep -rn "pollMs\|POLL_MS\|setInterval"`이 0줄이다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴.
