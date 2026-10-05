---
type: guide
concerns: [platform, documents, apps, problems, lophn-agent, coding-agent, shell]
---

# docs/tmp

lead(Claude)가 팀을 돌리며 세션 임시 폴더(scratchpad)에만 두던 운영 메모와
스크립트를 옮긴 자리다. 세션이 끝나거나 장치를 다시 켜도 남기려고 둔다. 무엇을
만들지는 여기가 아니라 `docs/plan/`이 정한다.

## 진행 상황은 어디서 보나

- 작업과 진행도의 정본은 `docs/plan/<concern>.md`의 `- 상태:` 줄이다.
  - `완료 (#PR)`: 끝났다.
  - `진행 (#PR) — 남은 것: …`: 아직 남았다.
  - `이어보냄: … → <작업>`: 남은 항목을 다른 작업으로 넘겼다. 받은 작업에는
    `<작업>에서 넘어온 것:` 줄이 있다.
- 사람이 정할 것은 `open-issues.md`와 각 plan 끝의 질문 절(Q번호)에 있다.
- PR 본문과 병합 리뷰 코멘트는 GitHub에 있다.
- 2026-10-05 기준: 362개 작업 중 약 190개 완료(약 52%). contracts는 다 끝났다.

## 파일

| 파일                     | 내용                                                                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `resume-after-outage.md` | glm provider 정지(2026-10-05)로 끊긴 worker 10개의 worktree·branch·상태. 다시 시작할 때 여기서 이어 간다                                                           |
| `worker-common.md`       | worker에게 주는 공통 지침. 실제 사람 데이터 root 금지, light check, Electron headless, `git stash` 금지 등. `docs/dev/team-brief.md`와 다르면 이 파일이 이긴다     |
| `task-prompt.txt`        | worker 작업 지시 앞머리                                                                                                                                            |
| `team-roster.md`         | worker 배정 기록과 규칙(UI는 opus, 비UI는 glm, glm 리뷰는 한 번)                                                                                                   |
| `merge.sh`               | lead의 병합 절차: origin/main 합치기 → light check → push → review 코멘트 → squash merge → branch·worktree 정리                                                    |
| `light-check.sh`         | full check 대신 쓰는 가벼운 확인(사람 허락). 저장소 전체 fmt·lint·deps·contract coverage·type check·docs check, 바뀐 폴더의 test, core graph tripwire, shell check |

## 쓸 때 주의

- 스크립트 안의 경로는 원래 자리(`/tmp/claude-1000/…/scratchpad/`)를 가리킨다.
  여기서 바로 돌리려면 그 경로를 이 폴더로 바꾼다.
- 이 폴더는 임시다. 팀 운영이 끝나거나 내용이 `docs/dev/`로 정리되면 지운다.
- 메모 안의 agent ID는 그 세션에서만 뜻이 있다.
