# mistakes

worker가 크게 잘못한 것. 코드가 아니라 context(AGENTS.md, skill, architecture 문서)나 check를 고친다.


## worker가 screenshot용으로 띄운 server와 monitor를 끄지 못한 채 보고함

```yaml
kind: mistake
modules: [tools]
```

지금: 계획 `workflow`에서 두 worker가 자기가 띄운 process를 남긴 채 보고했다. 한 worker는 gallery 확인 뒤 `tail -f` monitor 둘을 남겼다가 lead가 다시 시키자 껐다. 다른 worker는 gallery screenshot을 찍으려고 worktree에서 `python3 -m http.server 8741 -d tools/wireframes`를 띄웠는데, PID를 적지 않았고 Bash 호출이 돌아온 뒤에는 끌 길이 없다고 보고했다. ps·fuser·pkill이 금지라서다. 결국 lead가 port, cmdline, cwd로 그 process 하나를 확인하고 PID로 껐다. `project-docs/issues/archived/mistakes.md`의 "core를 subshell로 띄워 `$!`가 deno를 가리키지 않음"과 같은 종류다. 그때는 core 기동만 script(`lead/boot.sh`)로 주었다.

영향: 남은 server가 port를 잡아 다음 worker가 다른 port를 찾아야 하고(이번에도 8731이 이미 잡혀 있었다), merge.sh가 worktree를 지운 뒤에도 server가 지운 폴더를 붙잡고 남는다. 찾아 끄려다 남의 process를 끌 위험이 다시 생긴다.

원인: `project-docs/plan/tools/lead/prompt.py`의 worker 지시문은 "띄운 process(예: screenshot용 `http.server`)는 보고 전에 끈다"고만 말한다. 띄우는 법을 주지 않아 worker마다 `&`나 background Bash로 띄우고 끄는 손잡이를 잃는다. gallery를 띄워 보라는 brief(`ui-design` skill과 화면 task brief의 "둘러보기")가 서버를 손으로 띄우게 한다.

막기(추천): core 기동과 같이 script로 준다. `lead/gallery.sh`가 `deno task wireframes` 뒤 `timeout`으로 끝나는 `http.server`를 빈 port에 띄우고 URL을 찍는다. headless screenshot도 그 script 안에서 찍고 끝나면 server가 저절로 끝나게 한다. `prompt.py`와 `ui-design` skill의 둘러보기 줄이 이 script만 쓰게 한다.
