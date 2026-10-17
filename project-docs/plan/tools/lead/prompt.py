"""사용: python3 -I prompt.py <id> <branch> [note]
worker 지시문을 찍는다. 그대로 Agent prompt로 쓴다. main checkout의 것을 돌린다.
note는 이 task에만 해당하는 "알아 둘 것"이다."""
import os, sys
if len(sys.argv) < 3:
    print(__doc__); sys.exit(0)
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), *[os.pardir] * 4))
tid, branch, note = sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else "없음"
print(f"""lophn task `{tid}`를 해 줘.

- 작업 위치: {ROOT}/.claude/worktrees/{tid} (branch {branch}). 이 worktree 밖의 file은 고치지 않는다.
- 먼저 읽을 것:
  1. 작업 위치의 AGENTS.md (특히 "속도": 프로토타입이다. 가장 단순한 구현, 미리 일반화·방어 코드 금지)
  2. {ROOT}/project-docs/plan/tasks/{tid}.md (이 task의 brief. 끝의 "(lead가 더함)" 항목이 있으면 그것도 할 일이다)
  3. brief의 "읽을 것"
- 고칠 수 있는 것은 brief의 "소유" path뿐이다. "추가 소유"는 lead가 승인했으니 그 줄이 말한 범위만 같이 고친다. 자기 module의 내부 모양을 바꿔 남의 file이 컴파일되지 않으면 그 줄만 최소로 맞추고 보고의 "넘길 줄"에 적는다. 그 밖의 path가 필요하면 고치지 말고 보고한다.
- brief의 "계약"에 적힌 고정된 계약(protocol, port, shell IPC, preload)은 고치지 않는다. 바꿀 것이 있으면 바꾸기 요청을 보고에 적는다. brief가 말하는 계약 이름이 main과 다르면 main의 계약이 맞다.
- test는 깨지면 정말 곤란한 것에만 몇 개 쓴다(`.claude/skills/write-test`). E2E, 브라우저, 스크린샷은 하지 않는다. subprocess·서버를 띄우는 test는 새로 만들지 않는다.
- 확인은 `deno task check:full`과 core 기동 두 번이다. core는 `mkdir -m 700 -p $PWD/.dev-data/{tid} && export LOPHN_HOME=$PWD/.dev-data/{tid}` 뒤 `tail -f /dev/null | deno run -A packages/core/main/daemon/main.ts --port=0 > core.log 2>&1 &` 한 줄로 띄우고(같은 data root로 두 번), 바로 `PID=$!`로 받은 PID만 kill한다. `( ... ) &`나 `mkdir ... && ... &`처럼 묶어서 background로 보내지 않는다(그러면 `$!`가 subshell이라 deno가 남는다). ps·fuser·ss로 찾지 않는다. pkill·killall은 쓰지 않는다. 실제 `~/.lophn`은 절대 건드리지 않는다.
- 통과하면 이 branch에 commit한다. 메시지는 영어 명령형 한 줄과 본문, 끝에 `Co-Authored-By:` 줄(자기 model 이름). 요구 ID와 작업 번호는 넣지 않는다.
- push, merge, rebase, 다른 branch 건드리기는 하지 않는다.
- `packages/shell/main/node_modules`(symlink)와 `packages/shell/main/desktop/core/deno.lock`의 check 때 변경은 commit하지 않는다. 고친 file을 path로 add하고, commit 전에 `git diff --cached --stat`을 본다.
- 자기 sub agent를 띄우지 않는다. project-docs는 고치지 않는다.
- 막히면 추측으로 넘어가지 말고, 할 수 있는 데까지 하고 보고한다. 맡은 일을 "시간이 부족했다"며 남기지 않는다.
- 보고는 brief의 "보고" 꼴로 짧게 쓴다. "무겁게 짠 것"(가장 단순한 구현보다 무겁게 짠 곳)과 "알려진 미완 동작" 칸을 빼지 않는다.

알아 둘 것: {note}""")
