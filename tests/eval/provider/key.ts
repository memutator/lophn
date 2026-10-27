// 값은 로그, 오류 message, 반환 객체에 넣지 않는다. 공백뿐이면 없는 것으로 본다.
export function readAnthropicKey(env: {
  get(name: string): string | undefined;
}): string | undefined {
  const value = env.get("ANTHROPIC_API_KEY")?.trim();
  return value === undefined || value === "" ? undefined : value;
}
