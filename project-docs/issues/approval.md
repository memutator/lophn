# approval

판정(Gate)과 사람에게 묻는 request의 열린 이슈다. 흐름과 불변 조건은 `project-docs/architecture/approval.md`.


## shell floor deny가 `rm -rf /`의 그 글자 모양만 막는다

```yaml
kind: bug
modules: [packages/protocol, packages/core/approvals]
```

지금: `packages/protocol/approvals/shell-rules.ts`의 `PRODUCT_SHELL_RULES.floor`는 `rm -rf /`, `rm -rf ~`, `rm -rf ~/`, `rm -rf /\*`, `rm -rf ~/\*`, `mkfs*`, `dd * of=/dev/*`, fork bomb이다. `packages/core/approvals/gate/shell-match.ts`의 `shellRuleMatches`는 공백만 줄이고 글자를 그대로 맞춘다. 그래서 `rm -fr /`, `rm -r -f ~`, `rm -rf --no-preserve-root /`, `sudo rm -rf /`는 floor에 맞지 않고 제품 기본 ask(`rm -r*`, `rm -fr*`)에만 맞는다. `judge`(`packages/core/approvals/gate/judge.ts`)는 ask를 unattended·skip에서 `run`으로 바꾼다.

영향: skip session이나 unattended run에서 agent가 flag 순서만 다른 `rm -fr ~`를 실수로 부르면 묻지도 막지도 않고 사람의 home이 지워진다. AGENTS.md "속도"가 막으라는 agent 실수(데이터 잃기)다. skip은 이 계획의 wave 3, unattended 입구는 `headless-run`부터 열린다.

고치려면:
- floor에 flag 순서 변형을 더한다(`rm -fr`, `rm -r -f`, `rm -f -r`, `--no-preserve-root`, `sudo` 앞붙임 × `/`, `~`, `~/`, `/\*`, `~/\*`). 작음. 목록이 길어지고 다른 변형(`$HOME`, `/home/<사람>`)은 여전히 빠진다.
- `rm`의 짧은 flag 묶음을 정규화한 뒤 맞춘다(`-fr`·`-r -f`를 `-rf`로). 작음~중간. roadmap "하지 않는 것"의 명령 parser에 한 걸음 다가간다.
- 그대로 둔다. roadmap "규칙은 실수를 줄일 뿐 경계가 아니다".

추천: 첫째에서 `rm -fr`·`rm -r -f`·`rm -f -r`와 `sudo` 앞붙임만 더한다. 계약 file 한 곳의 목록이고, 사람 없는 run에서 home을 잃는 길 가운데 흔한 것을 닫는다.

정할 것: floor 목록을 넓힐까(제품 동작. floor는 사람도 덮지 못한다).
