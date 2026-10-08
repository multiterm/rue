FROM gcc:14-bookworm AS native
COPY packages/apps/agent-runtime/src/sandbox/mount-check.c /src/mount-check.c
RUN gcc -std=c11 -O2 -Wall -Wextra -Werror -fstack-protector-strong -D_FORTIFY_SOURCE=2 /src/mount-check.c -o /mount-check

FROM oven/bun:1.3.14 AS build
WORKDIR /src
COPY packages/apps/agent-runtime/src packages/apps/agent-runtime/src
COPY packages/libs/sdk/src/filesystem.ts packages/libs/sdk/src/filesystem.ts
COPY extensions/rue/runtime-info.ts extensions/rue/model-error.ts extensions/rue/bridge.ts extensions/rue/provider-keys.ts extensions/rue/socket.ts extensions/rue/status.ts extensions/rue/git-status.ts extensions/rue/usage.ts extensions/rue/
RUN bun build packages/apps/agent-runtime/src/guardian.ts packages/apps/agent-runtime/src/runner.ts packages/apps/agent-runtime/src/mcp.ts --target=node --packages=external --outdir=/out

FROM node:24-bookworm-slim
ARG PI_VERSION=0.85.1
RUN apt-get update && apt-get install -y --no-install-recommends bash ca-certificates git openssh-client rsync ripgrep fd-find util-linux tini && ln -s /usr/bin/fdfind /usr/local/bin/fd && ssh -V && rsync --version && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY packages/apps/agent-runtime/package.json /tmp/runtime-manifest.json
# Pi ships an npm shrinkwrap that bypasses npm overrides. Use the pinned
# workspace package manager so the reviewed security floors apply to the image.
RUN node -e 'const fs=require("fs"),p=JSON.parse(fs.readFileSync("/tmp/runtime-manifest.json"));if(p.dependencies["@earendil-works/pi-coding-agent"]!==process.env.PI_VERSION||p.dependencies["@earendil-works/pi-ai"]!==process.env.PI_VERSION)throw Error("Pi image label must match pinned dependencies");fs.writeFileSync("package.json",JSON.stringify({type:"module",packageManager:"pnpm@11.4.0",dependencies:p.dependencies}));fs.writeFileSync("pnpm-workspace.yaml",JSON.stringify({minimumReleaseAge:0,overrides:{"undici@>=8.0.0 <8.10.2":"8.10.2","brace-expansion@>=5.0.0 <5.0.12":"5.0.12","@earendil-works/pi-ai":process.env.PI_VERSION,"@earendil-works/pi-agent-core":process.env.PI_VERSION,"@earendil-works/pi-tui":process.env.PI_VERSION,"@earendil-works/chord":process.env.PI_VERSION}}))' && npm install --global pnpm@11.4.0 --ignore-scripts --no-audit --no-fund && pnpm install --prod --no-optional --ignore-scripts --store-dir=/tmp/pnpm-store && npm cache clean --force && rm -rf /tmp/pnpm-store /tmp/runtime-manifest.json
COPY --from=build /out/ /app/
COPY --from=native /mount-check /app/mount-check
RUN mkdir -p /control /state /workspace && chmod 0700 /control /state /workspace && chown 1000:1000 /state /workspace
LABEL io.rue.agent-runtime="1" io.rue.pi-sdk="${PI_VERSION}" io.rue.mcp-tools="1" io.rue.compact="1" io.rue.codex-oauth="1" io.rue.filesystem="3" io.rue.ssh-client="1"
ENV HOME=/state PI_CODING_AGENT_DIR=/state/pi NODE_ENV=production
# SSH client availability is not a credential or host grant. Never COPY SSH
# identities/known_hosts from an operator home or grant Docker/host privileges.
# Root guardian is separate from the uid-1000 Pi/tool process. The supervisor
# must drop ALL capabilities and add only SETUID/SETGID, plus no-new-privileges.
# /control is per-agent root-only bootstrap state, NEVER supervisor state.
ENTRYPOINT ["/usr/bin/tini","--","/usr/bin/flock","--nonblock","--no-fork","--conflict-exit-code","75","/control/daemon.lock","/usr/local/bin/node","/app/guardian.js"]
