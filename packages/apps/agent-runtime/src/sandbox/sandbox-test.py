"""Synthetic data only. Run with tmpfs mounts; never mount real host files."""
import json
import os
from pathlib import Path
import subprocess

root = Path('/Volumes/MOTHERSHIP')
for folder in ('rw', 'ro', 'blocked'):
    (root / folder).mkdir()
    (root / folder / 'file').write_text('synthetic-' + folder)
Path('/control/secret').write_text('synthetic-control')
(root / 'rw' / 'escape').symlink_to(root / 'blocked', target_is_directory=True)
(root / 'alias').symlink_to(root / 'rw', target_is_directory=True)
probe = subprocess.run(['/app/rue-sandbox', '--probe'], capture_output=True, text=True, check=True)
assert json.loads(probe.stdout)['landlockAbi'] >= 3
policy = ['/app/rue-sandbox', '--write', str(root / 'rw'), '--read', str(root / 'ro'), '--', '/usr/bin/python3', '-c']
checks = {
    'read-write-content': "from pathlib import Path;p=Path('/Volumes/MOTHERSHIP/rw/file');p.write_text('changed');assert p.read_text()=='changed'",
    'read-only-read': "from pathlib import Path;assert Path('/Volumes/MOTHERSHIP/ro/file').read_text()=='synthetic-ro'",
    'private-workspace': "from pathlib import Path;Path('/workspace/ok').write_text('ok');Path('/state/ok').write_text('ok')",
    'subprocess-inherits': "import subprocess;subprocess.run(['/bin/sh','-c','! cat /Volumes/MOTHERSHIP/blocked/file >/dev/null && ! echo x > /Volumes/MOTHERSHIP/ro/file'],check=True)",
    'detached-child-inherits': "import os;pid=os.fork();\nif pid==0:\n os.setsid()\n try: open('/Volumes/MOTHERSHIP/blocked/file').read();os._exit(1)\n except PermissionError: os._exit(0)\nelse:\n assert os.waitpid(pid,0)[1]==0",
}
denied = {
    'ungranted-read': "open('/Volumes/MOTHERSHIP/blocked/file').read()",
    'ungranted-list': "__import__('os').listdir('/Volumes/MOTHERSHIP/blocked')",
    'read-only-write': "open('/Volumes/MOTHERSHIP/ro/file','w').write('bad')",
    'read-only-truncate': "__import__('os').truncate('/Volumes/MOTHERSHIP/ro/file',0)",
    'read-only-delete': "__import__('os').unlink('/Volumes/MOTHERSHIP/ro/file')",
    'read-only-create': "open('/Volumes/MOTHERSHIP/ro/new','w')",
    'symlink-escape': "open('/Volumes/MOTHERSHIP/rw/escape/file').read()",
    'control-secret': "open('/control/secret').read()",
    'proc-root-escape': "open('/proc/self/root/Volumes/MOTHERSHIP/blocked/file').read()",
    'read-only-chmod': "__import__('os').chmod('/Volumes/MOTHERSHIP/ro/file',0o777)",
    'ungranted-utime': "__import__('os').utime('/Volumes/MOTHERSHIP/blocked/file',None)",
    'read-only-xattr': "__import__('os').setxattr('/Volumes/MOTHERSHIP/ro/file','user.test',b'bad')",
    'unix-socket': "__import__('socket').socket(__import__('socket').AF_UNIX)",
    'hardlink-escape': "__import__('os').link('/Volumes/MOTHERSHIP/blocked/file','/Volumes/MOTHERSHIP/rw/link')",
    'rename-read-only': "__import__('os').rename('/Volumes/MOTHERSHIP/ro/file','/Volumes/MOTHERSHIP/rw/stolen')",
}
for name, code in denied.items():
    checks[name] = "import errno\ntry:\n " + code + "\nexcept OSError as error:\n assert error.errno in (errno.EPERM,errno.EACCES" + (",errno.EXDEV" if name in ('hardlink-escape','rename-read-only') else "") + ")\nelse:\n raise AssertionError('access was not denied')"
for name, code in checks.items():
    result = subprocess.run(policy + [code], capture_output=True, text=True, timeout=10)
    if result.returncode:
        raise AssertionError(name + ': ' + result.stderr[-1500:])
    print('PASS ' + name, flush=True)
for path in (str(root / 'alias'), str(root / '../MOTHERSHIP/rw'), '/etc', str(root / 'missing')):
    result = subprocess.run(['/app/rue-sandbox', '--write', path, '--', '/usr/bin/true'], capture_output=True, timeout=10)
    assert result.returncode == 78, 'unsafe or absent grant accepted'
print('PASS invalid grants fail closed')
# A descriptor opened before confinement must not bypass path restrictions.
fd = os.open(root / 'blocked/file', os.O_RDONLY)
try:
    result = subprocess.run(policy + [f"import os\ntry: os.read({fd},100)\nexcept OSError: pass\nelse: raise AssertionError('inherited descriptor')"], pass_fds=(fd,), capture_output=True, timeout=10)
    assert result.returncode == 0, 'descriptor bypass'
finally:
    os.close(fd)
print('PASS inherited descriptor closed')
assert (root / 'ro/file').read_text() == 'synthetic-ro'
assert (root / 'blocked/file').read_text() == 'synthetic-blocked'
print('PASS protected contents unchanged')
print(probe.stdout.strip())
