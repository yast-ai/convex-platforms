import { describe, expect, test } from 'bun:test';
import { buildCli, validateCliOperations } from '../src/cli.js';
import { siteOrigin } from '../src/transport.js';
import type { Operation } from '../src/contract.js';
const op:Operation={name:'createTodo',resource:['todos'],action:'create',tool:'todos_create',path:'/api/v1/todos/create',function:'todos/internal:createTodo',type:'mutation',platforms:['cli'],description:'Create todo',inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text']},outputSchema:{type:'string'}};
describe('CLI manifest boundary',()=>{
  test('derives nested commands from discovery',()=>{
    const program=buildCli([op]);
    expect(program.commands.find(c=>c.name()==='todos')?.commands[0]?.name()).toBe('create');
  });
  test.each(['https://example.com/path','https://user:secret@example.com','https://example.com?q=1','http://example.com','file:///tmp/x'])('rejects unsafe target %s',url=>expect(()=>siteOrigin(url)).toThrow());
  test('supports explicit HTTPS and loopback targets',()=>{expect(siteOrigin('https://demo.convex.site')).toBe('https://demo.convex.site');expect(siteOrigin('http://127.0.0.1:3211')).toBe('http://127.0.0.1:3211');});
  test.each(['//attacker.example/steal','https://attacker.example','/api/v1/todos/delete'])('refuses mismatched discovery routes %s',path=>expect(()=>validateCliOperations([{...op,path}])).toThrow());
  test('rejects built-in collisions and identity flags',()=>{
    expect(()=>validateCliOperations([{...op,resource:['login'],path:'/api/v1/login/create'}])).toThrow();
    expect(()=>validateCliOperations([{...op,inputSchema:{properties:{data:{type:'string'}}}}])).toThrow();
  });
});
