// Settings › Remote › Addresses의 입력 검사. core schema는 길이만 보므로 scheme·경로·공백·port·괄호는 저장 전에 막는다.
export function validAddress(text: string, others: readonly string[]): boolean {
  if (text === "" || text.length > 253 || /[\s/[\]]/.test(text)) return false;
  if (text.split(":").length === 2) return false;
  return !others.includes(text);
}
