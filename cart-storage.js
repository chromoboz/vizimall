(function(root){
  'use strict';
  const lifetime=7*86400000;
  function readGuest(storage,key,valid,now=Date.now()){
    try{const value=JSON.parse(storage.getItem(key)||'null');
      if(!value||!Number.isFinite(value.updatedAt)||value.updatedAt>now||now-value.updatedAt>=lifetime||!Array.isArray(value.lines)){storage.removeItem(key);return [];}
      return value.lines.filter(valid).slice(0,50);
    }catch{return [];}
  }
  function saveGuest(storage,key,lines,now=Date.now()){
    try{if(lines.length)storage.setItem(key,JSON.stringify({updatedAt:now,lines}));else storage.removeItem(key);}catch{}
  }
  const helpers={readGuest,saveGuest,lifetime};
  if(typeof module!=='undefined')module.exports=helpers;else root.ViziCartStorage=helpers;
})(typeof window==='undefined'?globalThis:window);
