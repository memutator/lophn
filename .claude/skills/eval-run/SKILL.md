---
name: eval-run
description: lophn eval experiment나 `npm run eval`을 돌리고, 진행을 보고, judge item을 채점하고(item마다 새 subagent), 멈춘 run을 알아채고, 실행 기록(run.md)을 쓸 때 쓴다. eval을 돌리는 agent session(runner)이 읽는다. 해석과 원인 추정은 이 skill의 일이 아니다(eval-experiment).
---

# eval 돌리기 (runner)

runner는 eval CLI를 돌리고, 진행을 보고, judge 채점을 **새 subagent에게 시켜** 넣고, 사실만 `run.md`에 적는다. 해석은 하지 않는다(experimenter의 일). runner는 고정된 model이 아니다(lead이거나 더 싼 session).

진짜 provider를 부르는 명령이라 돈이 든다. 시킨 experiment 하나만 돌린다.

명령의 인자와 종료 코드, 흐름, 수치와 한도, 실행 폴더는 `.claude/skills/eval-run/reference.md`다. 설계는 `project-docs/architecture/eval.md`.

## 순서

1. `tests/eval/experiments/<id>/spec.json`을 읽고 시나리오, `budget_usd`, `trials`(base, max)를 확인한다. 바꾸지 않는다. 이유: spec은 돌리기 전에 정한 규칙이다.
2. gate를 미리 본다. 실패하면 거기서 멈추고 단계 이름(`check`, `e2e`, `dry-run`)과 출력 마지막 줄을 보고한다.
   ```
   npm run eval:gate -- <id> [--checkout <path>] [--base <rev>]
   ```
3. experiment를 background로 돌린다. caller가 variant를 주면 `--checkout`을 그대로 쓴다.
   ```
   npm run eval:experiment -- <id> [--checkout <path>] [--base <rev>] [--budget <usd>]
   ```
   `eval:experiment`도 gate를 먼저 돌린다(`--skip-gate`는 쓰지 않는다). `--budget`은 caller가 줄 때만 쓴다. `eval:experiment`는 `.env`를 읽고 `eval:gate`는 읽지 않는다.
   판단 case를 그냥 돌리는 `npm run eval -- --scenario <id>... [--trials N] [--model <name>] [--effort <value>] [--budget <usd>]`도 2, 3만 다르고 나머지는 같다(spec과 `result.json`이 없어 `run.md`는 시나리오별 stdout 줄을 적는다).
4. 도는 동안 아래 "진행 확인"을 하면서 채점한다.
5. process가 끝나면 stdout 마지막 줄 `[verdict] <decision>`을 본다. 이유 줄(들여쓴 줄)은 그 위에 있다.
   - 이유에 `채점 대기`가 있거나 `[pending] <run> n건`이 찍혔으면 아래 "채점하기"로 비운 뒤 **같은 명령을 다시 돈다**. 끝난 trial은 그대로 두고 판정을 다시 계산한다(정책이 더 돌리라고 하면 trial이 더 돈다). 이유: `inconclusive`는 이어 돌릴 수 있다.
   - `판정이 이미 났다`가 나오면 그 spec은 끝난 것이다. 다시 돌리지 않는다.
   - `stopped_by_budget`이 true인 `inconclusive`는 caller가 시킬 때만 이어 돌린다.
6. 판정이 났고 대기가 0이면 `run.md`를 쓰고 보고한다.

종료 코드: 인자 오류 2, 실패 1, 판정(adopt, reject, inconclusive)은 모두 0. 0이라고 통과가 아니다. 판정은 `[verdict]` 줄과 `result.json`을 본다.

## stdout 줄

- `[variant] <root> (core@n)`, `[change] ...`, `[select] ...`, `[warn] ...`, `[estimate] trials a..b ... (budget $x)`
- `[gate] <stage> ok|failed|skipped`. 실패하면 그 아래에 이유
- `[trial] <시나리오>#<i> start`, 끝나면 `pass`, `fail (check id..)`, `pending (check id..)`가 `$비용`과 함께. 앞에 `timeout`이 붙으면 trial이 제때 끝나지 않은 것이다.
- `[budget] $a/b`: 합계 비용
- `채점 대기 <run> <key>`
- `[pending] <run> n건`, 이유 줄들, 마지막 `[verdict] <decision>`

## 진행 확인

정해진 간격으로 stdout의 마지막 줄들, `.dev-data/eval/`에서 가장 최근에 바뀐 file의 시각, 마지막 `[budget]` 줄을 본다. 확인마다 caller에게 한 줄 상태를 남긴다(예: `3분: trial 2/3 도는 중, $4.20/$100`).

- **간격 3분.**
- **멈춤.** stdout과 기록 file이 10분 동안 변하지 않으면 멈춘 것으로 본다. 이유: `waitUntilIdle` timeout이 5분이라 trial이 끝나거나 멈춘 것이 그 안에 드러난다. 이 숫자는 첫 experiment에서 재 보고 고친다.

## 채점하기 (`채점 대기 <run> <key>`, 또는 trial이 끝난 뒤 몰아서)

```
npm run eval:judge -- <run>
npm run eval:judge -- <run> show <key>
npm run eval:judge -- <run> set <key> --model claude-haiku-5-5 <<'JSON'
{"verdict": "...", "quote": "..."}
JSON
```

첫 줄은 목록이다(key, 종류, check, criterion@n, `대기|오류|채점됨`). **새 subagent** 하나를 띄운다. fork가 아니다(이 session의 context를 주지 않는다). prompt는 `show`의 stdout 전문이다. 한 글자도 더하지 않는다(시나리오 이름, 진행, 가설, 다른 item의 답을 쓰지 않는다). subagent_type은 `haiku-xhigh`(`claude-haiku-5-5`) 하나로 고정한다. 이유: 한 run 안에서 model이 섞이면 grader가 달라 scorecard가 따로 보인다. 마지막 글의 JSON을 code fence만 벗기고 그대로 넣는다. `--model`은 실제로 쓴 subagent의 model 이름이다. 되풀이 진단 item(`repeat-kind`)도 같은 목록에 있고 같은 절차다.

- program이 enum 밖의 verdict와 입력에 없는 인용을 `오류`로 기록한다. **`오류` item만** 새 subagent로 다시 채점한다. `채점됨`은 program이 거절하니 다시 하지 않는다. 이유: 마음에 드는 verdict를 고르는 일이 되기 때문이다.
- 목록에 `대기`와 `오류`가 없어야 채점이 다 들어온 것이다. 볼 run id는 `[pending]`, `채점 대기` 줄과 `result.json`의 `variant_runs`에 있다.

## 하지 않는 것

- 직접 채점하지 않는다. 직접 판단하면 돌리는 쪽의 가설이 들어간다. subagent의 답을 고르거나 고치지 않는다(code fence 벗기기만).
- `result.json`, `tests/eval/runs/*.json`, `.dev-data/eval/`(대기 file과 답 file 포함)을 손으로 고치지 않는다. 판정과 기록의 정본이다. `eval:judge`로만 적는다.
- 떨어진 trial만 골라 다시 돌리지 않는다. 몇 번 돌릴지는 program의 trial 정책이 정한다. 통과할 때까지 돌리면 결과를 고르는 일이 된다.
- `budget_usd`나 `--budget`을 올리지 않는다. 돈과 시간 상한은 program이 지킨다.
- 시킨 것 말고 다른 experiment나 `npm run eval -- --all`을 돌리지 않는다. 진짜 provider는 비용이 든다.
- `~/.claude/`(`harness install` 포함)와 `~/.lophn`을 건드리지 않는다. 사람의 환경이다.
- `.env`를 열거나 key를 찍거나 옮기지 않는다. key가 없으면 `eval:experiment`는 `ANTHROPIC_API_KEY가 없다`며 1로 끝나고 `eval`은 trial을 돌지 않고 0으로 끝난다. 그대로 보고한다.
- 해석하지 않는다. 원인 추정, 판정 뒤집기, 다음 고칠 것을 쓰지 않는다. experimenter의 일이다.

## 멈춘 run을 알면

지체 없이 caller에게 알린다. 마지막 stdout 10줄, 마지막 변화 시각, 지금까지 비용, 어느 시나리오와 trial인지를 쓴다. process를 스스로 죽이거나 다시 돌리지 않고 멈추라고 요청한다.

## run.md

`tests/eval/experiments/<id>/run.md`. 사실만 쓴다. 판정은 채점이 다 들어온 뒤의 `result.json`에서 옮기고, 대기가 남았으면 "채점 대기 n개"라고 쓴다. 계산하지 않고 `result.json`의 숫자를 옮긴다. 이유: runner와 experimenter가 서로의 file을 덮어쓰지 않게, 사실과 해석을 가른다.

- 명령(인자 포함), 시작·끝 시각, 종료 코드, gate 단계별 결과
- `decision`과 `reasons`(그대로 복사)
- 시나리오별 표: 역할, 기준 통과/trial, variant 통과/trial, status
- 비용 `cost_usd` / `budget_usd`, `stopped_by_budget`
- `result.json`에 `overfit`, `repeats`, `assembly`가 있으면 그 줄을 그대로
- 채점한 item 수, 쓴 model
- 멈춤이나 이상한 출력(시각과 줄)

## 보고 (caller에게)

판정 한 줄, 비용, 이상한 점이 있었는지, `run.md` 경로. 해석은 experimenter에게 넘긴다고 쓴다.

## 이 skill이 기대는 것

- 명령: `npm run eval`, `eval:experiment`, `eval:gate`, `eval:judge` (`package.json`, `tests/eval/run.ts`, `tests/eval/experiment/mod.ts`)
- stdout 줄: `[trial]`, `[budget]`, `[gate]`, `[pending]`, `[verdict]`, `채점 대기` (`tests/eval/runner/`, `tests/eval/judge/`)
- 기록: `tests/eval/experiments/<id>/{spec,result}.json`, `tests/eval/runs/<run>.json`, `.dev-data/eval/<run>/`
- 역할: runner(이 skill)는 `run.md`, experimenter(`eval-experiment`)는 `report.md`를 쓴다
