// model에 다 싣지 못한 tool 결과의 전체를 두는 자리다. 결과를 줄이는 것은 runtime의 일이라 handler는
// 전체를 돌려주고, 상한을 넘으면 runtime이 전체를 이 파일에 쓰고 model에는 앞부분과 경로를 준다.
// 그 session의 file tool은 자기 폴더만 읽을 수 있다(쓰기는 없다).
export const TOOL_RESULTS_FOLDER = "tool-results";

export function toolResultFolder(dataRoot: string, session: string): string {
  return `${dataRoot}/${TOOL_RESULTS_FOLDER}/${session}`;
}

export function toolResultFile(
  dataRoot: string,
  session: string,
  toolCall: string,
): string {
  return `${toolResultFolder(dataRoot, session)}/${toolCall}.json`;
}
