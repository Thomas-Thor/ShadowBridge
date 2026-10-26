"""Fictional SSH only. Checks interactive diagnostics and fail-closed resume."""
import os,pty,select,time,tempfile,pathlib,json
source='cbca6a0c4ef9559081aaac7347370a774331b8ea'
for mode,phase,expected in [('--diagnose-existing','PREPARED','PREPARED'),('--resume-existing','SIGNUP_REQUEST_IN_PROGRESS','CHECKPOINT_PHASE_REQUIRES_REPAIR_NO_AUTOMATIC_REPLAY'),('--resume-existing','PREPARED','PRIVATE_COMMAND_SOURCE_NOT_FOUND'),('--resume-existing --preflight-only','PREPARED','PREPARED')]:
 root=pathlib.Path(tempfile.mkdtemp(prefix='smtp-resume-cli-',dir='/tmp/shadowbridge-r1-isolated'));calls=root/'calls.jsonl';ssh=root/'ssh'
 report={'kind':'shadowbridge-existing-smtp-checkpoint','readOnly':True,'changesMade':False,'lock':{'exists':False},'candidates':[{'sourceRelease':source,'phase':phase,'reviewed':True,'checkoutMatches':True,'credentialSaved':True,'sealedProfileValid':True}]}
 script='''#!/usr/bin/env python3
import sys,json,pathlib,os
file=pathlib.Path(os.environ['RESUME_FIXTURE_CALLS']);n=len(file.read_text().splitlines()) if file.exists() else 0
with file.open('a') as f:f.write(json.dumps(sys.argv[1:])+'\\n')
if n==0:
 print('Fixture sudo prompt: ',end='',flush=True);input()
 print('SB_SMTP_CHECKPOINT_JSON_BEGIN');print(os.environ['RESUME_FIXTURE_REPORT']);print('SB_SMTP_CHECKPOINT_JSON_END')
else:
 print(json.dumps({'status':'BLOCKED','reason':'PRIVATE_COMMAND_SOURCE_NOT_FOUND','stage':'recovery.compose-validation'}),file=sys.stderr);sys.exit(1)
'''
 ssh.write_text(script);ssh.chmod(0o700)
 pid,fd=pty.fork()
 if pid==0:
  os.environ['PATH']=str(root)+':'+os.environ['PATH'];os.environ['RESUME_FIXTURE_CALLS']=str(calls);os.environ['RESUME_FIXTURE_REPORT']=json.dumps(report)
  os.execvp('node',['node','scripts/smtp-owner-launcher.mjs','--release='+'a'*40,*mode.split()])
 output=b'';sent=False;deadline=time.monotonic()+8
 while time.monotonic()<deadline:
  if not select.select([fd],[],[],0.2)[0]:continue
  try:b=os.read(fd,16384)
  except OSError:break
  if not b:break
  output+=b
  if not sent and b'Fixture sudo prompt: ' in output:os.write(fd,b'\n');sent=True
 os.close(fd);_,status=os.waitpid(pid,0);count=len(calls.read_text().splitlines())
 assert expected.encode() in output
 assert count==(2 if mode=='--resume-existing' and phase=='PREPARED' else 1)
 assert os.waitstatus_to_exitcode(status)==(0 if mode=='--diagnose-existing' or '--preflight-only' in mode else 1)
 if phase=='PREPARED' and mode=='--resume-existing':
  assert b'operator.resume-preparation' in output and b'recovery.compose-validation' in output
 assert b'Has\xc5\x82o aplikacji Gmail' not in output
 print('PASS '+mode+' / '+phase+'; correct stage, no repeated prepare, no production accessed')
