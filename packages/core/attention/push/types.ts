// core가 Expo Push에 보내는 글 하나. `mobile-attention-core`가 만들고 sender가 나른다.
// channelId는 폰이 시작할 때 만드는 channel id와 같은 계약이다.
export type PushMessage = {
  to: string;
  title: string;
  body?: string;
  data: {
    host: string;
    kind: "session" | "app" | "inbox";
    session?: string;
    app?: string;
  };
  channelId: "needs-you" | "finished" | "apps";
  priority: "high" | "default";
  ttl: number;
};
