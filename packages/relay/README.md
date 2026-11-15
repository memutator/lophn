# lophn relay

폰과 core가 다른 network에 있어도 만나게 하는 relay. core의 control socket이 key를 증명하면 폰 연결마다 data socket을 이어 binary message를 그대로 넘긴다. 내용은 폰과 core 사이 Noise가 지켜 relay는 암호문만 본다. 계약은 `packages/protocol/remote/relay.ts`.

## local

```sh
node packages/relay/main.ts --port 8787   # --port가 없으면 env PORT, 그것도 없으면 8080
```

core 설정 `remote.relay`를 `ws://<이 기계>:8787`로 둔다.

## Fly.io

relay는 `packages/protocol`과 `packages/base`를 source로 import해서 build context가 저장소 root다. 아래 명령은 모두 저장소 root에서 돌린다.

처음 한 번(app만 만들고 이 `fly.toml`을 그대로 쓴다):

```sh
fly apps create lophn-relay
```

deploy:

```sh
fly deploy . --config packages/relay/fly.toml \
  --dockerfile packages/relay/Dockerfile \
  --ignorefile packages/relay/Dockerfile.dockerignore
```

TLS는 Fly가 끝낸다. core 설정 `remote.relay`의 기본값이 `wss://lophn-relay.fly.dev`다.

machine은 늘 1대다. relay는 어느 core가 붙어 있는지를 그 process 메모리에만 들고 있어서, 2대면 core와 폰이 다른 machine에 붙어 만나지 못한다. 첫 deploy는 Fly가 2대를 띄우므로 한 번 줄인다:

```sh
fly scale count 1 -a lophn-relay
```

local에서 image만 볼 때:

```sh
docker build -f packages/relay/Dockerfile -t lophn-relay .
docker run --rm -p 8080:8080 lophn-relay
```
