FROM gcc:14-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /Volumes/MOTHERSHIP/.rue-colima-cache
COPY mount-check.c /app/mount-check.c
RUN gcc -std=c11 -O2 -Wall -Wextra -Werror -fstack-protector-strong -D_FORTIFY_SOURCE=2 /app/mount-check.c -o /app/mount-check && gcc -std=c11 -O2 -Wall -Wextra -Werror -DRUE_MOUNT_TEST /app/mount-check.c -o /app/mount-check-test
COPY mount-proof-test.py /app/mount-proof-test.py
ENTRYPOINT ["/usr/bin/python3","/app/mount-proof-test.py"]
