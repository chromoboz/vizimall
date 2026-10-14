// Product-specific supplier country list observed in CJ's Germany warehouse UI.
// This is a short-lived bootstrap for the shared live index, never a global list.
const snapshots=[{sku:'CJCZ1533761-10Pairs',from:'DE',quantity:1,checkedAt:'2026-10-07T12:50:00Z',source:'https://cjdropshipping.com/product/iconsign-10-pairs-pouch-eyelash-perm-lotion-lashes-lift-quick-perming-5-to-8-minutes-beauty-makeup-tools-p-1552567462339170304.html',countries:['EE','DE','BE','BG','LT','LU','HR','LV','GR','IT','HU','SI','CZ','SK','IE','NL']}];
export function auditedDestinations({sku,from,quantity,state,now=Date.now()}){
 const snapshot=snapshots.find(s=>s.sku===sku&&s.from===from&&s.quantity===quantity&&Date.parse(s.checkedAt)<=now&&Date.parse(s.checkedAt)+6*3600000>now);
 if(!snapshot)return [];
 // A newer negative supplier check overrides the observed country list.
 return snapshot.countries.filter(code=>!(state?.expiresAt>now&&state.checked?.includes(code)&&!state.available?.includes(code)));
}
