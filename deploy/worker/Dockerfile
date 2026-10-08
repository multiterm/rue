# Build from the repository root. No workspace credentials or deployment state enter the context.
FROM oven/bun:1.3.14 AS build
WORKDIR /build
RUN bun add --exact ws@8.21.3 zod@4.4.3
COPY packages/apps/worker/src ./packages/apps/worker/src
COPY packages/libs/sdk/src/filesystem.ts ./packages/libs/sdk/src/filesystem.ts
RUN printf '%s' '{"compilerOptions":{"baseUrl":".","paths":{"@multiterm/rue-sdk/filesystem":["./packages/libs/sdk/src/filesystem.ts"]}}}' > tsconfig.json && bun build packages/apps/worker/src/cli.ts --compile --outfile /out/rue-worker

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates util-linux libstdc++6 \
    && rm -rf /var/lib/apt/lists/* \
    && install -d -m 0700 /var/lib/rue-worker
COPY --from=build /out/rue-worker /usr/local/bin/rue-worker
USER 0:0
# Kernel-held lock survives neither a process crash nor reboot; no stale PID-file recovery.
ENTRYPOINT ["flock", "--no-fork", "--nonblock", "--conflict-exit-code", "75", "/var/lib/rue-worker/daemon.lock", "/usr/local/bin/rue-worker"]
CMD ["run"]
