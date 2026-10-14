import {test} from 'node:test';
import assert from 'node:assert/strict';
import storage from './cart-storage.js';
import {customerCart,cartLines} from './backend-cart.mjs';
class DB{
 values=new Map();revision=0;
 async get(key){return structuredClone(this.values.get(key)?.data||null);}
 async getWithMetadata(key){return structuredClone(this.values.get(key)||null);}
 async setJSON(key,data,options={}){const old=this.values.get(key);if(options.onlyIfNew&&old||options.onlyIfMatch&&old?.etag!==options.onlyIfMatch)return {modified:false};this.values.set(key,{data:structuredClone(data),etag:String(++this.revision)});return {modified:true};}
}
const line={productId:'gid://shopify/Product/1',variantId:'gid://shopify/ProductVariant/2',store:'tech',quantity:1,title:'Doorbell',variantTitle:'Black',price:{amount:'24.90',currencyCode:'EUR'}};
test('Guest cart survives navigation but expires seven days after its last edit',()=>{
 const values=new Map(),local={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 storage.saveGuest(local,'DE',[line],1000);
 assert.equal(storage.readGuest(local,'DE',()=>true,1000+storage.lifetime-1).length,1);
 assert.equal(storage.readGuest(local,'NL',()=>true,1001).length,0);
 assert.equal(storage.readGuest(local,'DE',()=>true,1000+storage.lifetime).length,0);
 values.set('DE',JSON.stringify([line]));assert.deepEqual(storage.readGuest(local,'DE',()=>true,2000),[]);
 storage.saveGuest(local,'DE',[line]);storage.saveGuest(local,'DE',[]);assert.equal(values.has('DE'),false);
});
test('Account cart is private to its authenticated owner and destination',async()=>{
 const db=new DB(),a={id:'gid://shopify/Customer/1'},b={id:'gid://shopify/Customer/2'};
 const first=await customerCart(db,a,'DE');
 await customerCart(db,a,'DE',{owner:first.owner,revision:0,lines:[line]});
 assert.equal((await customerCart(db,a,'DE')).lines.length,1);
 assert.equal((await customerCart(db,b,'DE')).lines.length,0);
 assert.equal((await customerCart(db,a,'NL')).lines.length,0);
 await assert.rejects(customerCart(db,b,'DE',{owner:first.owner,revision:0,lines:[line]}));
 await assert.rejects(customerCart(db,a,'DE',{owner:first.owner,revision:0,lines:[]}));
 await customerCart(db,a,'DE',{owner:first.owner,revision:1,lines:[]});
 assert.deepEqual((await customerCart(db,a,'DE')).lines,[]);
});
test('Cart input rejects duplicate variants, invalid quantities and oversized data',()=>{
 assert.throws(()=>cartLines([line,line]));assert.throws(()=>cartLines([{...line,quantity:100}]));
 assert.throws(()=>cartLines([{...line,title:'a'.repeat(501)}]));assert.throws(()=>cartLines([{...line,price:{amount:'-1',currencyCode:'EUR'}}]));
 assert.equal(cartLines([{...line,owner:'another customer'}])[0].owner,undefined);
});
