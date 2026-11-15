# 저장소 root를 build context로 짓는다(relay가 packages/protocol과 packages/base를 source로 import한다). README.md를 본다.
FROM node:24-slim
WORKDIR /app
COPY packages/base packages/base
COPY packages/protocol packages/protocol
COPY packages/relay packages/relay
# root package.json은 Electron 등 전체 workspace를 끌어와서, relay에 드는 세 package만 workspace로 묶는다.
# 의존 판은 각 package.json이 정확히 고정한다.
RUN echo '{"private":true,"workspaces":["packages/base","packages/protocol","packages/relay"]}' > package.json \
  && npm install --no-audit --no-fund
USER node
ENV PORT=8080
EXPOSE 8080
CMD ["node", "packages/relay/main.ts"]
