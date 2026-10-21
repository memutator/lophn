// broker 연결 하나가 가리키는 앱 자식이다. 신원은 자식 연결이 정하고 요청 본문이 정하지 않는다.
export type BrokerChild = {
  app: string;
  // preview는 release가 없고 ledger 기록 대상이 아니다.
  release: string | null;
  mode: "live" | "preview";
  processNonce: string;
};
