import test from 'node:test';
import assert from 'node:assert/strict';
import {nicknameSchema,endSchema} from '../src/game-sessions.js';
test('nicknames accept Unicode and single spaces without requiring public uniqueness',()=>{
 for(const value of ['Lua Azul','João_7','星の子','a-b','a'.repeat(20)]) assert.equal(nicknameSchema.safeParse(value).success,true,value);
 for(const value of ['ab','a'.repeat(21),'Lua  Azul','<script>','Lua\nAzul','😀😀😀']) assert.equal(nicknameSchema.safeParse(value).success,false,value);
 assert.equal(nicknameSchema.parse('  Joa\u0303o  '),'João');
});
test('session summaries reject nonfinite, out of bounds, extra and fractional fields',()=>{
 assert.equal(endSchema.safeParse({status:'completed',durationSeconds:86400,score:100000000,level:9999,stars:3}).success,true);
 for(const value of [{status:'started'},{status:'ended',score:Infinity},{status:'ended',score:-1},{status:'ended',durationSeconds:86401},{status:'ended',level:10000},{status:'ended',stars:4},{status:'ended',stars:1.5},{status:'ended',childId:'other'}]) assert.equal(endSchema.safeParse(value).success,false);
});
