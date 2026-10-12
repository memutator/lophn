// lophn-agent message-content contract를 테스트 실행 중에만 불러온다. renderer 설정(lib
// ES2023·DOM)으로는 contracts·base를 type check하지 않으므로 정적 import 대신 계산한
// 경로로 불러 필요한 모양만 적는다. 도크가 쓰는 상한·직렬화가 contract와 같은지 본다.

export interface MessageContract {
  readonly MESSAGE_TEXT_CONTENT_MAX_BYTES: number;
  serializeMessageContent(content: unknown): Uint8Array;
  readonly userMessageContentInputSchema: {
    safeParse(value: unknown): { success: boolean };
  };
}

export async function messageContract(): Promise<MessageContract> {
  const url = new URL(
    "../../../../../packages/protocol/lophn-agent/message-content.ts",
    import.meta.url,
  );
  return await import(url.href) as MessageContract;
}
