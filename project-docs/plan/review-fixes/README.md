# review-fixes

- 목표: 2026-11-06 전수 리뷰에서 나온 P0(사용자 data·기동에 바로 닿는 bug)와 성능 지적을 고친다.
- 재료: 전수 리뷰 결과(이 README의 "지적" 절), `project-docs/architecture/`의 관련 topic, `project-docs/module-catalog.yaml`.
- 범위 밖: P1(security 경계, Windows 개발 도구 — 다른 session이 `win/verify`에서 한다). `tools/check.ts`, `tests/support/core/process.ts`, `tools/worktree-prep.ts`, `package.json` script, `.github/`는 고치지 않는다. refactor 주제(내부 채널 type 통일, wiring에서 ACP 빼기, atomic write 하나로 등)도 이 계획 밖이다.
- 단위: ledger, config, run-loop, app-data, shell, sessions, events. 소유는 brief가 정한다.
- 순서: wave 1 하나. `turn-loop-perf`는 `turn-loop` 뒤, `event-fanout`은 `session-list` 뒤(소유 겹침).
- 사람이 정할 것: 없음. main에 올리는 것은 사람 확인 뒤.
- lead가 할 일: merge마다 보고의 등록할 것을 고친다. 다 끝나면 changelog 열린 판에 항목을 더하고, 동작이 바뀐 architecture 문서(`run-loop` 흐름, events)를 고친다.

## Windows에서 돌릴 때

lead와 worker 모두 Windows(Git Bash)에서 돈다. main에는 아직 `win/verify`의 Windows 고침이 없다.

- `npm run check`(incremental)는 Windows argv 길이 한도로 깨진다. `npm run check:full`만 쓴다.
- `tools/worktree-prep.ts`가 `npm`을 spawn하지 못한다. lead가 worktree를 만들 때 손으로 `npm ci --prefer-offline --no-audit --no-fund`와 `node -e "require('electron')"`를 돌린다.
- `python3`가 없다. `python`을 쓴다.
- check:full의 기준선(main에서 Windows 탓으로 이미 실패하는 것)은 lead가 재서 worker prompt의 note로 준다. 그 밖의 실패는 worker의 책임이다.

## 지적

| task | 지적 |
|---|---|
| `ledger-freeze` | 낸 schema step SQL이 protocol 상수를 끼워 만들어져 enum 하나 바뀌면 hash가 어긋나 모든 data root가 기동을 거절한다. step id·hash를 고정하는 test가 없다. trigger 검사(`guardedTablesOf`)는 사실상 아무것도 보지 않는다 |
| `settings-keep` | `settings.json`에 모르는 key 하나면 파일 전체를 거절하고, 다음 쓰기가 빈 설정으로 덮는다 |
| `turn-loop` | runtime 재시작 뒤 secret 요청 영구 거절, `done` rejection이 runtime을 죽임, `next()`/`began()` race로 입력이 어긋나거나 사라짐, StartModelCall 실패 뒤에도 steering 소비·model 호출, StartTurn 실패 시 pump busy-loop |
| `turn-loop-perf` | compaction이 turn 시작 pump를 막음, turn 안에서 첫 입력 image를 여러 번 다시 읽음 |
| `app-data-restore` | restore rename 사이 crash로 live DB 잃음, migrate 뒤 검사 실패 시 backup으로 안 돌림 |
| `shell-fixes` | terminal supervisor request id 충돌, prod renderer가 dev mock을 싣고 `?mock`으로 켜짐 |
| `session-list` | session 목록이 session마다 turn을 전부 읽음(N+1), 전역 gate, 모든 session 변화에 모든 tab이 다시 읽음 |
| `event-fanout` | watch 하나 바뀌면 모든 창의 구독자가 snapshot을 다시 읽음, `AcpUpdated`를 session으로 거를 수 없어 모든 창에 감, log가 끝없이 자람 |
