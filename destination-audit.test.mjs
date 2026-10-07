import {test} from 'node:test';
import assert from 'node:assert/strict';
import {auditedDestinations} from './backend-destination-audit.mjs';
const request={sku:'CJCZ1533761-10Pairs',from:'DE',quantity:1,now:Date.parse('2026-10-07T12:51:00Z')};
test('CJ observed country list restores the exact product and warehouse only',()=>{
 const list=auditedDestinations(request);assert.equal(list.length,16);assert.ok(list.includes('EE'));assert.ok(list.includes('IE'));
 assert.deepEqual(auditedDestinations({...request,sku:'other'}),[]);assert.deepEqual(auditedDestinations({...request,from:'FR'}),[]);assert.deepEqual(auditedDestinations({...request,quantity:2}),[]);
});
test('Supplier country observations expire and cannot override a newer negative freight result',()=>{
 assert.deepEqual(auditedDestinations({...request,now:request.now+6*3600000}),[]);
 const list=auditedDestinations({...request,state:{expiresAt:request.now+1000,checked:['EE'],available:[]}});assert.equal(list.length,15);assert.ok(!list.includes('EE'));
 assert.equal(auditedDestinations({...request,state:{expiresAt:request.now-1,checked:['EE'],available:[]}}).length,16);
});
