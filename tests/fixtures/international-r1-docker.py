#!/usr/bin/python3
import sys,os,json
args=sys.argv[1:]
if args[:2]==['--context','default']:args=args[2:]
if '--context' in args or '--host' in args:raise SystemExit('Only the explicit isolated daemon is permitted')
cfg=json.load(open('/tmp/shadowbridge-r1-isolated/wrapper.json'))
if args and args[0]=='compose' and '--project-name' in args:
 project=args[args.index('--project-name')+1]
 extra=cfg.get('overlays',{}).get(project)
 if extra:
  commands=['config','up','ps','stop','start','restart','exec','run','images','create','build']
  at=next((i for i,a in enumerate(args) if a in commands),None)
  if at is None:raise SystemExit('Unsupported isolated compose operation')
  args[at:at]=['-f',extra]
os.environ['DOCKER_CONFIG']='/tmp/shadowbridge-r1-isolated/docker-config'
os.execv('/usr/local/bin/docker',['docker','--host','unix:///tmp/shadowbridge-r1-isolated/overlay.sock',*args])
