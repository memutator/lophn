// 테스트 전용. 메시지를 받으면 잡지 않은 오류로 Worker를 끝낸다.
const worker = self as unknown as {
  onmessage: ((event: MessageEvent) => void) | null;
};
worker.onmessage = () => {
  setTimeout(() => {
    throw new Error("writer crashed");
  }, 0);
};
