import {hash,update} from './backend-persistence.mjs';
export const avatars=['fox','panda','owl','robot','cat','leaf'];
export function nameInput(input) {
  const result={};
  for(const field of ['firstName','lastName']) {
    if(typeof input[field]!=='string')throw new Error('Name required');
    const value=input[field].trim().normalize('NFC');
    if(value.length>60||/[\p{Cc}\p{Cf}<>@\/]/u.test(value))throw new Error('Invalid name');
    result[field]=value;
  }
  if(!result.firstName)throw new Error('First name required');
  return result;
}
export function shortName(first,last){return first?`${first}${last?' '+[...last.trim()][0].toLocaleUpperCase()+'.':''}`:'My profile';}
export function profileKey(customer){if(!/^gid:\/\/shopify\/Customer\/\d+$/.test(customer.id))throw new Error('Customer required');return`profiles/${hash(customer.id)}`;}
export async function profileData(db,customer) {
  const stored=await db.get(profileKey(customer),{type:'json'}),avatar=avatars.includes(stored?.avatar)?stored.avatar:'fox';
  return {signedIn:true,firstName:customer.firstName||'',lastName:customer.lastName||'',shortName:shortName(customer.firstName,customer.lastName),email:customer.emailAddress?.emailAddress||'',avatar,
    imageUrl:stored?.photo?`/api/profile-photo?v=${stored.revision}`:`/avatar-${avatar}.svg`,hasPhoto:Boolean(stored?.photo),revision:stored?.revision||0};
}
export async function saveProfileImage(db,customer,input,prepare) {
  if(input.action==='avatar') {
    if(!avatars.includes(input.avatar))throw new Error('Choose a valid avatar');
    return update(db,profileKey(customer),old=>({avatar:input.avatar,photo:null,revision:(old?.revision||0)+1}));
  }
  if(input.action==='photo') {
    const photo=await prepare(input.photo);
    return update(db,profileKey(customer),old=>({avatar:avatars.includes(old?.avatar)?old.avatar:'fox',photo,revision:(old?.revision||0)+1}));
  }
  throw new Error('Invalid profile action');
}
