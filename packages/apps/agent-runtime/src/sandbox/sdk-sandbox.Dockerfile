# Existing pinned development runtime, plus a test-only launcher. No live agent.
FROM rue-sandbox:development-check AS launcher
# Test harness tags the verified immutable development image with this name.
FROM rue-agent-runtime:sandbox-test-source
COPY --from=launcher /app/rue-sandbox /app/rue-sandbox
COPY sdk-sandbox-test.mjs /app/sdk-sandbox-test.mjs
USER 1000:1000
WORKDIR /workspace
ENTRYPOINT ["/app/rue-sandbox","--","/usr/local/bin/node","/app/sdk-sandbox-test.mjs"]
