"""Native descriptor proof tests. Synthetic tmpfs only; test binary cannot ship."""
import os
from pathlib import Path
import subprocess
import sys
import uuid
ROOT='/Volumes/MOTHERSHIP'
MODE=sys.argv[1]
EXTERNAL=MODE.startswith('external-')
if EXTERNAL:
 ROOT='/shared/test'
 MODE=MODE.removeprefix('external-')
BIN='/app/mount-check-test'
def verify(source,target,mode=MODE,mutate=None):
 nonce=str(uuid.uuid4())
 args=[mode,source]
 prefix=['serve-v3',nonce,'1',ROOT] if EXTERNAL else ['serve',nonce]
 server=subprocess.Popen([BIN,*prefix,*args],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 try:
  assert server.stdout.readline().strip()=='mount_probe_ready'
  if mutate: mutate()
  prefix=['verify-v3',nonce,'1',ROOT] if EXTERNAL else ['verify',nonce]
  result=subprocess.run([BIN,*prefix,mode,target],capture_output=True,text=True,timeout=8)
  server.wait(timeout=3)
  return result.returncode
 finally:
  if server.poll() is None: server.kill();server.wait()
  Path('/control/workspace-'+nonce+'.sock').unlink(missing_ok=True)
if MODE=='unmasked':
 assert verify(ROOT,ROOT,'read')==78
 print('PASS missing or unsafe administrative cache mask denied',flush=True)
 sys.exit(0)
assert verify(ROOT,ROOT)==0
print('PASS exact descriptor and '+MODE+' mount verified',flush=True)
wrong='read' if MODE=='write' else 'write'
assert verify(ROOT,ROOT,wrong)==78
print('PASS incorrect mount mode denied',flush=True)
if MODE=='write':
 for name in ['one','two']:
  os.mkdir(ROOT+'/'+name,0o777);os.chmod(ROOT+'/'+name,0o777)
 assert verify(ROOT+'/one',ROOT+'/two')==78
 print('PASS wrong source inode denied',flush=True)
 def swap():
  os.rename(ROOT+'/one',ROOT+'/old')
  os.mkdir(ROOT+'/one',0o777);os.chmod(ROOT+'/one',0o777)
 assert verify(ROOT+'/one',ROOT+'/one',mutate=swap)==78
 print('PASS source replacement after approval denied',flush=True)
 os.symlink(ROOT+'/one',ROOT+'/link')
 for path in [ROOT+'/link',ROOT+'/missing',ROOT+'/../etc',ROOT+'/.rue-colima-cache',ROOT+'/.rue-colima-cache/assets']:
  nonce=str(uuid.uuid4())
  prefix=['serve-v3',nonce,'1',ROOT] if EXTERNAL else ['serve',nonce]
  result=subprocess.run([BIN,*prefix,'write',path],capture_output=True,timeout=3)
  assert result.returncode==78
  Path('/control/workspace-'+nonce+'.sock').unlink(missing_ok=True)
 print('PASS missing, symlinked and traversal sources denied',flush=True)
nonce=str(uuid.uuid4())
prefix=['verify-v3',nonce,'1',ROOT] if EXTERNAL else ['verify',nonce]
assert subprocess.run([BIN,*prefix,MODE,ROOT],capture_output=True,timeout=8).returncode==78
print('PASS absent proof never authorizes execution',flush=True)
if EXTERNAL:
 for roots in [['/'],['/control'],[ROOT,ROOT]]:
  nonce=str(uuid.uuid4())
  result=subprocess.run([BIN,'serve-v3',nonce,str(len(roots)),*roots,MODE,ROOT],capture_output=True,timeout=3)
  assert result.returncode==78
 nonce=str(uuid.uuid4())
 assert subprocess.run([BIN,'serve-v3',nonce,'1',ROOT,MODE,'/other/workspace'],capture_output=True,timeout=3).returncode==78
 print('PASS unsafe, overlapping and non-authorized roots denied',flush=True)
