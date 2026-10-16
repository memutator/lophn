// timeout·복구는 자식 프로세스 그룹 전체를 죽인다. 그룹을 나누는
// 방법은 OS마다 다르다. Linux는 setsid, macOS는 setsid 바이너리가 없어 perl의
// setpgrp로 나눈다. 둘 다 없으면 시작 전에 unavailable이다.

type GroupLeader = {
  // 새 세션을 여는 실행 파일. 그 뒤 인자가 실제 명령이다.
  command: string;
  args: string[];
};

const SETSID = "/usr/bin/setsid";
const PERL = "/usr/bin/perl";
// macOS perl은 기본 설치다. 0은 호출 프로세스, 두 번째 0은 새 그룹 id를 고른다.
const PERL_SPLIT = "setpgrp(0,0); exec @ARGV";

type GroupTool = "setsid" | "perl" | "none";

function groupTool(os: string): GroupTool {
  if (os === "linux") return "setsid";
  if (os === "darwin") return "perl";
  return "none";
}

// 리더가 새 세션의 리더라 그룹 id가 그 pid와 같다. 음수 pid는 그 그룹 전체다.
// 고른 바이너리가 실제로 없으면 null이다. 시작 전에 unavailable로 끝낸다.
export async function groupLeader(os: string): Promise<GroupLeader | null> {
  const tool = groupTool(os);
  const leader = tool === "setsid"
    ? { command: SETSID, args: ["--wait"] }
    : tool === "perl"
    ? { command: PERL, args: ["-e", PERL_SPLIT, "--"] }
    : null;
  if (!leader) return null;
  try {
    await Deno.stat(leader.command);
  } catch {
    return null;
  }
  return leader;
}
