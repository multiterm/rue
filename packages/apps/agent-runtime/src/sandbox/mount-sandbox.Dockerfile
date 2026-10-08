# Alternative compatibility probe: kernel read-only mounts, no Landlock filter.
# Synthetic image fixtures stand in for RO host binds. No host data is mounted.
FROM rue-agent-runtime:sandbox-test-source
COPY sdk-sandbox-test.mjs /app/sdk-sandbox-test.mjs
RUN mkdir -p /Volumes/MOTHERSHIP/read-only /Volumes/MOTHERSHIP/read-write && printf synthetic-read-only > /Volumes/MOTHERSHIP/read-only/file && chown -R 1000:1000 /Volumes/MOTHERSHIP
USER 1000:1000
WORKDIR /workspace
ENV RUE_TEST_MOUNT_POLICY=1
ENTRYPOINT ["/usr/local/bin/node","/app/sdk-sandbox-test.mjs"]
