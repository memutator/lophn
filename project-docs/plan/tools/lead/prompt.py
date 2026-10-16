import sys
tid, branch, note = sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else "없음"
print(f"""lophn task `{tid}`를 해 줘.

- 작업 위치: /home/pyosechang/projects/lophn/.claude/worktrees/{tid} (branch {branch}). 이 worktree 밖의 file은 고치지 않는다.
- 먼저 읽을 것:
  1. 작업 위치의 AGENTS.md (특히 "속도": 프로토타입이다. 가장 단순한 구현, 미리 일반화·방어 코드 금지)
  2. /home/pyosechang/projects/lophn/project-docs/plan/tasks/{tid}.md (이 task의 brief. 끝의 "(lead가 더함)" 항목도 할 일이다)
  3. brief의 "읽을 것"
  4. /home/pyosechang/projects/lophn/project-docs/tmp/docs-review.md 끝의 "오케스트레이터 기록"에서 "계약 고정 review", fix-* 항목, "wave 3" 절(계약 이름 대응표와 lead 결정)
- 고칠 수 있는 것은 brief의 "소유" path뿐이다. "추가 소유"는 lead가 승인했으니 그 줄이 말한 범위만 같이 고친다. 자기 module의 내부 모양을 바꿔 남의 file이 컴파일되지 않으면 그 줄만 최소로 맞추고 보고의 "넘길 줄"에 적는다. 그 밖의 path가 필요하면 고치지 말고 보고한다.
- 계약(protocol, port, shell IPC, preload)은 고정됐다(commit a7f8deb6). 계약을 고치지 않고 바꾸기 요청을 보고에 적는다. brief가 말하는 계약 이름이 main과 다르면 main의 계약이 맞다.
- test는 깨지면 정말 곤란한 것에만 몇 개 쓴다. E2E, 브라우저, 스크린샷은 하지 않는다. subprocess·서버를 띄우는 test는 새로 만들지 않는다.
- 확인은 `deno task check:full`과 core 기동 두 번이다. core는 `export LOPHN_HOME=$PWD/.dev-data/{tid}` 뒤 `tail -f /dev/null | deno run -A packages/core/main/daemon/main.ts --port=0`으로 띄우고(같은 data root로 두 번), 자기가 띄운 PID만 kill한다. pkill·killall은 쓰지 않는다. 실제 `~/.lophn`은 절대 건드리지 않는다.
- 통과하면 이 branch에 commit한다. 메시지는 영어 명령형 한 줄과 본문, 끝에 `Co-Authored-By:` 줄(자기 model 이름). 요구 ID와 작업 번호는 넣지 않는다.
- push, merge, rebase, 다른 branch 건드리기는 하지 않는다.
- `packages/shell/main/node_modules`(symlink)와 `packages/shell/main/desktop/core/deno.lock`의 check 때 변경은 commit하지 않는다. 고친 file을 path로 add하고, commit 전에 `git diff --cached --stat`을 본다.
- 문서·주석·보고에 "자리"라는 낱말을 쓰지 않는다.
- 막히면 추측으로 넘어가지 말고, 할 수 있는 데까지 하고 보고한다. 보고는 brief의 "보고" 꼴로 짧게 쓴다.

알아 둘 것: {note}""")
