# ec-fix-idle

진짜 run(calendar-diagnose)에서 coding agent가 `message send`로 App Engineer에게 묻고 `Stop` hook을 낸 뒤, App Engineer가 답하고 turn을 끝냈는데도 trial이 11분 넘게 끝나지 않았다. 원인을 찾아 고친다.

- 단위: ec-fix-idle (wave 6)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tests/eval/runner/**`
  - `tests/eval/coding/driver/**`
- 읽을 것:
  - 남은 기록(사람 컴퓨터, 읽기만): `/tmp/lophn-eval/lophn-e2e-7a18a97fa8ed6fdc/home/lophn.db`. `coding_sessions`의 그 session(`ses_01m57thn4ysg7m1arghecyh0qw`)은 `started=1, heard=1, running=0, permissions=[]`(core의 `stateOf`로 `idle`)이다. App Engineer의 마지막 turn은 15:39:18~15:39:26 `answer_completed`다. 그 뒤 turn이 없다. `coding_inputs`는 비었다(App Engineer의 답이 coding agent 터미널로 가지 않았다).
  - wrapper 기록: `/home/pyosechang/projects/lophn/.claude/worktrees/plan-eval-coding/.dev-data/eval/run_01m57tgnmcp74mrb0997a4y3ev/trial-0/commands-ses_01m57thn4ysg7m1arghecyh0qw.log`(15:39:18 `message send`, 15:39:25 `hook claude Stop`, 15:50:22 lead가 run을 멈춘 때 `SessionEnd`)
  - `tests/eval/runner/idle.ts`(coding session이 `running`·`unknown`·`waiting`이면 쉬지 않는다), `trial.ts`(쉬었는데 `driver.active() > 0`이면 `driver.stop()` 뒤 다시 기다린다), `tests/eval/coding/driver/driver.ts`(`stop`, `closeSession`, `chains`, `answerTrust`의 `gate.whenFree`)
  - `project-docs/architecture/coding-agent.md`(coding agent가 묻고 App Engineer가 답하는 길: 답이 터미널 입력으로 가야 한다)
- 가설(확인하지 않았다): (a) `driver.stop()`이 어떤 chain이나 `whenFree`에서 끝나지 않는다. (b) App Engineer의 답이 coding session으로 가지 않아(`coding_inputs` 비었음) 아무도 일하지 않는데 쉼 판정이 다른 이유로 막혔다. (c) 그 밖.
- 계약: `CodingTrace`, `Snapshot` 모양(고정).

## 할 일

1. 가짜 provider와 가짜 `claude` script(hook 줄을 wrapper 기록에 남기고 `Stop`을 낸 뒤 입력을 기다리는 것)로 같은 순서를 재현한다. 진짜 Claude Code와 진짜 provider는 쓰지 않는다.
2. 원인을 고친다. 제품 쪽(App Engineer 답이 coding session에 가지 않음)이 원인이면 고치지 말고 보고한다.

## 끝남

- `deno task check:full`이 통과한다.
- 재현 probe에서 trial이 끝난다.
- 위험 test: 원인이 순수 함수로 떨어지면 그것만 하나.

## 보고

- 원인(확인한 것)과 고친 것
- 바꾼 file, 통과한 check
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
