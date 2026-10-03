import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {avatars,nameInput,shortName,profileData,profileKey,saveProfileImage} from './backend-profile.mjs';
import {createHandler,prepareAvatarPhoto} from './backend-customer.mjs';
import {hash} from './backend-persistence.mjs';
class DB {values=new Map();counter=0;async get(key){return structuredClone(this.values.get(key)?.data??null);}async getWithMetadata(key){return structuredClone(this.values.get(key)??null);}async setJSON(key,data,opts={}){const old=this.values.get(key);if(opts.onlyIfNew&&old||opts.onlyIfMatch&&old?.etag!==opts.onlyIfMatch)return{modified:false};this.values.set(key,{data:structuredClone(data),etag:String(++this.counter)});return{modified:true};}async list({prefix}){return{blobs:[...this.values.keys()].filter(key=>key.startsWith(prefix)).map(key=>({key}))};}async delete(key){this.values.delete(key);}}
const alice={id:'gid://shopify/Customer/1',firstName:'Ayşe',lastName:'Yılmaz',emailAddress:{emailAddress:'alice@example.invalid'}};
test('Profile names use actual customer values, Unicode initials and bounded clean input',()=>{
  assert.equal(shortName('Ayşe','Yılmaz'),'Ayşe Y.');assert.equal(shortName('',''),'My profile');
  assert.deepEqual(nameInput({firstName:' Ayşe ',lastName:' Yılmaz '}),{firstName:'Ayşe',lastName:'Yılmaz'});
  for(const input of [{firstName:'',lastName:'User'},{firstName:'a'.repeat(61),lastName:''},{firstName:'<script>',lastName:''},{firstName:'Name\nAnother',lastName:''}])assert.throws(()=>nameInput(input));
});
test('Six complete avatars are local trusted vector assets and preferences survive subsequent reads',async()=>{
  const db=new DB();assert.equal(avatars.length,6);for(const avatar of avatars){assert.match(await readFile(`avatar-${avatar}.svg`,'utf8'),/viewBox="0 0 116 116"/);await saveProfileImage(db,alice,{action:'avatar',avatar},()=>{throw new Error('No processor for preset');});assert.equal((await profileData(db,alice)).avatar,avatar);}
  await assert.rejects(saveProfileImage(db,alice,{action:'avatar',avatar:'../../secret'},async()=>''));
  const other=await profileData(db,{...alice,id:'gid://shopify/Customer/2'});assert.equal(other.avatar,'fox');
});
test('Profile photo is decoded, cropped to 512 square, strips metadata and is removed when an avatar is chosen',async()=>{
  const sharp=createRequire(import.meta.url)('sharp');const original=await sharp({create:{width:800,height:1200,channels:3,background:'#568575'}}).withMetadata({exif:{IFD0:{Artist:'Private profile location'}}}).jpeg().toBuffer();
  const cleaned=await prepareAvatarPhoto('data:image/jpeg;base64,'+original.toString('base64'));const metadata=await sharp(Buffer.from(cleaned,'base64')).metadata();assert.equal(metadata.width,512);assert.equal(metadata.height,512);assert.equal(metadata.exif,undefined);
  await assert.rejects(prepareAvatarPhoto('data:image/svg+xml;base64,PHN2Zz4='));await assert.rejects(prepareAvatarPhoto('data:image/png;base64,bm90LXBpY3R1cmU='));
  const db=new DB();await saveProfileImage(db,alice,{action:'photo',photo:'fixture'},async()=>cleaned);assert.equal((await profileData(db,alice)).hasPhoto,true);
  await saveProfileImage(db,alice,{action:'avatar',avatar:'panda'},()=>{});assert.equal((await db.get(profileKey(alice))).photo,null);
});
test('Authenticated profile metadata and photos belong only to the caller, not a submitted customer ID',async()=>{
  const db=new DB(),tokenA='a'.repeat(43),tokenB='b'.repeat(43);for(const[token,access]of[[tokenA,'alice-token'],[tokenB,'bob-token']])await db.setJSON(`sessions/${hash(token)}`,{token:access,expiresAt:Date.now()+100000});
  const bob={...alice,id:'gid://shopify/Customer/2',firstName:'Bob'};await saveProfileImage(db,alice,{action:'photo',photo:'fixture'},async()=>Buffer.from('private-alice-photo').toString('base64'));
  let savedName;const handler=createHandler({storeFactory:async()=>db,profileProvider:async token=>token==='alice-token'?{...alice}:{...bob},nameWriter:async(token,input)=>{savedName={token,input};return input;}});
  assert.equal((await handler(new Request('https://vizimall.com/api/profile'))).status,401);
  const bobPhoto=await handler(new Request('https://vizimall.com/api/profile-photo?customerId='+alice.id,{headers:{cookie:`__Host-vizi-session=${tokenB}`}}));assert.equal(bobPhoto.status,404);
  const ownPhoto=await handler(new Request('https://vizimall.com/api/profile-photo',{headers:{cookie:`__Host-vizi-session=${tokenA}`}}));assert.equal(await ownPhoto.text(),'private-alice-photo');assert.match(ownPhoto.headers.get('cache-control'),/private, no-store/);
  const changed=await handler(new Request('https://vizimall.com/api/profile',{method:'POST',headers:{cookie:`__Host-vizi-session=${tokenA}`,Origin:'https://vizimall.com','Content-Type':'application/json'},body:JSON.stringify({action:'name',firstName:'New',lastName:'Name',customerId:bob.id})}));assert.equal(changed.status,200);assert.equal((await changed.json()).shortName,'New N.');assert.equal(savedName.token,'alice-token');assert.deepEqual(savedName.input,{firstName:'New',lastName:'Name'});
  const foreign=await handler(new Request('https://vizimall.com/api/profile',{method:'POST',headers:{Origin:'https://attacker.test'}}));assert.equal(foreign.status,400);
});
