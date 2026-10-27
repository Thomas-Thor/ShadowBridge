import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import vm from 'node:vm';
import {syncRpcServer, lockedRpcSource} from './central-crm-sync-transport.mjs';

test('remote RPC rejects credential export, arbitrary routes and methods without leaking stdin secrets',async()=>{
  const inputs=[
    {id:1,method:'GET',route:'/api/v1/credentials',headers:{'X-N8N-API-KEY':'FICTIONAL_DO_NOT_OUTPUT'}},
    {id:2,method:'DELETE',route:'/api/v1/workflows/fictional_workflow'},
    {id:3,method:'GET',route:'/api/v1/workflows/another_workflow'},
    {id:4,method:'POST',route:'/api/v1/workflows/fictional_workflow/activate',headers:{Cookie:'FICTIONAL_DO_NOT_OUTPUT'}},
  ];
  const stdin=new PassThrough(),descriptor=Object.getOwnPropertyDescriptor(process,'stdin'),write=process.stdout.write;
  let output='';
  try{
    Object.defineProperty(process,'stdin',{value:stdin,configurable:true});process.stdout.write=chunk=>{output+=chunk;return true;};
    const running=syncRpcServer('fictional_workflow');stdin.end(inputs.map(v=>JSON.stringify(v)).join('\n')+'\n');await running;
  }finally{Object.defineProperty(process,'stdin',descriptor);process.stdout.write=write;}
  const lines=output.trim().split('\n').map(v=>JSON.parse(v));
  assert.equal(lines[0].ready,true);assert.equal(lines.length,5);assert.ok(lines.slice(1).every(v=>v.error?.startsWith('CRM_SYNC_RPC_')));assert.ok(!output.includes('FICTIONAL_DO_NOT_OUTPUT'));
});

test('lock bootstrap compiles, uses a private owner directory and a nonblocking OS lock',()=>{
  const source=lockedRpcSource('fictional_workflow');
  new vm.Script('(async function(){'+source+'})');
  assert.match(source,/--nonblock/);assert.match(source,/0o700/);assert.match(source,/0o600/);assert.match(source,/isSymbolicLink/);assert.match(source,/process\.getuid/);
  assert.throws(()=>lockedRpcSource('invalid/workflow'),/WORKFLOW_ID_REQUIRED/);
});
