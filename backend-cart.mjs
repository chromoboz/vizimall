import {hash,update} from './backend-persistence.mjs';
const stores=['tech','home','pets','beauty','fashion','kids','auto'];
export function cartLines(lines){
  if(!Array.isArray(lines)||lines.length>50)throw Error('Invalid cart');
  const seen=new Set();
  return lines.map(line=>{
    if(!line||!/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(line.variantId)||!/^gid:\/\/shopify\/Product\/\d+$/.test(line.productId)||seen.has(line.variantId)||!stores.includes(line.store)||!Number.isInteger(line.quantity)||line.quantity<1||line.quantity>99||typeof line.title!=='string'||line.title.length>500||typeof line.variantTitle!=='string'||line.variantTitle.length>500||!Number.isFinite(Number(line.price?.amount))||Number(line.price.amount)<0||!/^[A-Z]{3}$/.test(line.price.currencyCode))throw Error('Invalid cart line');
    seen.add(line.variantId);
    return {productId:line.productId,variantId:line.variantId,store:line.store,browsingCountry:line.browsingCountry,title:line.title,variantTitle:line.variantTitle,quantity:line.quantity,price:{amount:String(line.price.amount),currencyCode:line.price.currencyCode}};
  });
}
export async function customerCart(db,customer,destination,input){
  if(!/^[A-Z]{2}$/.test(destination)||!/^gid:\/\/shopify\/Customer\/\d+$/.test(customer.id))throw Error('Invalid cart owner');
  const owner=hash(customer.id),key=`carts/${owner}/${destination}`;
  let saved;
  if(input){
    if(input.owner!==owner||!Number.isSafeInteger(input.revision))throw Error('Cart owner changed');
    const lines=cartLines(input.lines);
    saved=await update(db,key,old=>{
      if((old?.revision||0)!==input.revision)throw Error('Cart changed; reload');
      return {lines,revision:input.revision+1,updatedAt:Date.now()};
    });
  }else saved=await db.get(key,{type:'json'});
  return {signedIn:true,owner,lines:saved?.lines||[],revision:saved?.revision||0};
}
