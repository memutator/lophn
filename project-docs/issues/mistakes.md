# mistakes

worker가 크게 잘못한 것. 코드가 아니라 context(AGENTS.md, skill, architecture 문서)나 check를 고친다.

## core 기동 지시문이 `wait`에서 멈춤

```yaml
kind: mistake
modules: [tools]
```

지금: `project-docs/plan/tools/lead/prompt.py`와 `.claude/skills/orchestrate/SKILL.md`의 기동 한 줄은 `tail -f /dev/null | deno run ... & PID=$!; sleep 15; kill $PID; wait $PID`다. `$!`는 pipeline 끝의 deno지만 `tail -f /dev/null`은 쓸 것이 없어 SIGPIPE를 받지 않고 끝나지 않는다. 그래서 `wait`이 돌아오지 않는다. browser-bridge 계획의 worker 둘이 지시문 그대로 돌리다 Bash 호출이 멈췄고, 하나는 TaskStop과 자기 PID의 `kill -9`로, 하나는 `timeout -s KILL 15`로 바꿔 빠져나왔다. 남은 core는 없었다(lead가 두 port에 접속해 확인).

영향: worker마다 기동 확인에서 시간을 잃고, 멈춘 호출을 빠져나오려 지시문 밖 방법(`kill -9`, TaskStop)을 쓴다. 다음 worker가 ps로 남은 process를 찾다가 남의 process를 끌 위험이 다시 생긴다.

원인: 앞서 닫은 "core를 subshell로 띄워 `$!`가 deno를 가리키지 않음"(`archived/mistakes.md`)의 막기가 지시문 한 줄이었고, 그 줄 자체가 끝나지 않는다.

다시 생김: 앞서 지시문에 기동 한 줄을 넣어 닫았고 "다시 생기면 `lead/boot.sh`처럼 timeout으로 끝나는 script로 준다"고 적었다. 이번에는 그 한 줄이 원인이다.

막기: `prompt.py`와 orchestrate skill의 기동 줄을 "`cd <worktree>; project-docs/plan/tools/lead/boot.sh`"로 바꾼다(작음). `boot.sh`는 `(sleep 12) | timeout 40 deno ...`로 stdin을 닫아 core가 스스로 끝나고, 새 data root로 두 번 띄워 `boot N exit 0`을 찍는다. browser-bridge wave 2부터 lead 메모로 이 길을 주었고 worker 넷이 멈추지 않았다.
