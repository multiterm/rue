# Isolated enforcement test image only; never used to run a managed agent.
FROM gcc:14-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY rue-sandbox.c /app/rue-sandbox.c
RUN gcc -std=c11 -O2 -Wall -Wextra -Werror -fstack-protector-strong -D_FORTIFY_SOURCE=2 /app/rue-sandbox.c -o /app/rue-sandbox
COPY sandbox-test.py /app/sandbox-test.py
USER 1000:1000
ENTRYPOINT ["/usr/bin/python3","/app/sandbox-test.py"]
