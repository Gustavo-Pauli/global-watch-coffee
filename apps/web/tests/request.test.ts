import assert from 'node:assert/strict';
import test from 'node:test';
import { BodyError, readJsonBody } from '../lib/request';
import { originAllowed } from '../lib/origin';

const request=(body:string,contentType='application/json')=>new Request('http://localhost:3000/api/test',{method:'POST',headers:{'Content-Type':contentType},body});

test('JSON validation rejects malformed, wrong MIME, non-object, and unbounded streams',async()=>{
  await assert.rejects(readJsonBody(request('{')),error=>error instanceof BodyError&&error.status===400);
  await assert.rejects(readJsonBody(request('{}','application/jsonp')),error=>error instanceof BodyError&&error.status===415);
  await assert.rejects(readJsonBody(request('[]')),error=>error instanceof BodyError&&error.status===422);
  await assert.rejects(readJsonBody(request('null')),error=>error instanceof BodyError&&error.status===422);
  await assert.rejects(readJsonBody(request(JSON.stringify({data:'x'.repeat(20_000)}))),error=>error instanceof BodyError&&error.status===413);
  assert.deepEqual(await readJsonBody(request('{"scene":"august"}','application/json; charset=utf-8')),{scene:'august'});
});

test('cross-site requests without Origin fail closed',()=>{
  assert.equal(originAllowed(new Request('http://localhost:3000',{headers:{'sec-fetch-site':'cross-site'}})),false);
  assert.equal(originAllowed(new Request('http://localhost:3000',{headers:{Origin:'https://attacker.invalid'}})),false);
});
