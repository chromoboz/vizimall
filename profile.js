(() => {
  'use strict';
  const presets=[['fox','Fox'],['panda','Panda'],['owl','Owl'],['robot','Robot'],['cat','Cat'],['leaf','Little plant']];
  const make=(tag,text,cls)=>{const item=document.createElement(tag);if(text!==undefined)item.textContent=text;if(cls)item.className=cls;return item;};
  let current,loading;
  async function request(input) {
    const response=await fetch('/api/profile',{cache:'no-store',credentials:'same-origin',...(input?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}:{})});
    if(!response.ok){const error=new Error(response.status===401?'Please sign in.':'Your changes could not be saved. Please try again.');error.status=response.status;throw error;}
    current=await response.json();return current;
  }
  const read=()=>current?Promise.resolve(current):(loading||=request().finally(()=>{loading=null;}));
  function image(data,cls) { const img=make('img',undefined,cls);img.src=data?.imageUrl||'/avatar-fox.svg';img.alt='Your profile picture';img.onerror=()=>{img.onerror=null;img.src='/avatar-fox.svg';};return img; }
  function header(data) {
    for(const link of document.querySelectorAll('.account-link')) {
      link.replaceChildren(image(data,'profile-mini'),make('span',data?.shortName||'Sign in','profile-short-name'));
      link.setAttribute('aria-label',data?.signedIn?`Open profile for ${data.shortName}`:'Sign in or open your profile');
    }
  }
  function notify(data){header(data);dispatchEvent(new CustomEvent('vizi-profile-updated',{detail:data}));}
  async function editor(panel) {
    const data=await read();panel.replaceChildren();panel.classList.add('profile-editor');
    const overview=make('div',undefined,'profile-overview');const picture=image(data,'profile-portrait');const heading=make('h2',data.firstName?`Welcome, ${data.firstName}.`:'Make yourself at home.');
    overview.append(picture,make('p','YOUR VIZIMALL','profile-eyebrow'),heading,make('p',data.email,'profile-email'));panel.append(overview);
    const edit=make('div',undefined,'profile-edit-fields');edit.append(make('h3','Your profile'));
    const form=make('form',undefined,'profile-name-form');
    function field(title,value,autocomplete){const label=make('label',title);const input=make('input');input.value=value;input.maxLength=60;input.autocomplete=autocomplete;label.append(input);form.append(label);return input;}
    const first=field('First name',data.firstName,'given-name');first.required=true;const last=field('Last name',data.lastName,'family-name');
    const save=make('button','Save name','account-button');save.type='submit';const nameStatus=make('p',undefined,'profile-feedback');nameStatus.setAttribute('role','status');form.append(save,nameStatus);edit.append(form);
    form.onsubmit=async event=>{event.preventDefault();save.disabled=true;try{const saved=await request({action:'name',firstName:first.value,lastName:last.value});heading.textContent=`Welcome, ${saved.firstName}.`;nameStatus.textContent='Name saved to your Shopify account.';notify(saved);}catch(error){nameStatus.textContent=error.message;}finally{save.disabled=false;}};
    edit.append(make('h3','Choose your look'),make('p','Pick an avatar or use your own photo. Your picture is visible only in your signed-in account.','account-muted'));
    const choices=make('div',undefined,'avatar-choices');const imageStatus=make('p',undefined,'profile-feedback');imageStatus.setAttribute('role','status');
    async function changed(input){for(const button of choices.querySelectorAll('button'))button.disabled=true;try{const saved=await request(input);picture.src=saved.imageUrl;for(const button of choices.querySelectorAll('button'))button.setAttribute('aria-pressed',String(!saved.hasPhoto&&button.dataset.avatar===saved.avatar));imageStatus.textContent='Profile picture saved.';notify(saved);}catch(error){imageStatus.textContent=error.message;}finally{for(const button of choices.querySelectorAll('button'))button.disabled=false;}}
    for(const[id,title]of presets){const button=make('button',undefined,'avatar-choice');button.type='button';button.dataset.avatar=id;button.setAttribute('aria-label',`Choose ${title} avatar`);button.setAttribute('aria-pressed',String(!data.hasPhoto&&data.avatar===id));const img=make('img');img.src=`/avatar-${id}.svg`;img.alt='';button.append(img,make('span',title));button.onclick=()=>changed({action:'avatar',avatar:id});choices.append(button);}edit.append(choices);
    const uploadLabel=make('label','Upload your own photo','profile-upload');const upload=make('input');upload.type='file';upload.accept='image/jpeg,image/png';upload.setAttribute('aria-label','Upload profile photo');uploadLabel.append(upload);edit.append(uploadLabel,make('p','JPEG or PNG, up to 1 MB. Images are resized and embedded location data is removed. Choose an avatar to remove your uploaded photo.','account-muted'),imageStatus);
    upload.onchange=async()=>{const file=upload.files?.[0];if(!file)return;if(file.size>1000000||!['image/jpeg','image/png'].includes(file.type)){imageStatus.textContent='Choose a JPEG or PNG under 1 MB.';upload.value='';return;}try{const photo=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});await changed({action:'photo',photo});}catch{imageStatus.textContent='Could not read this photo.';}upload.value='';};
    const address=make('a','Manage delivery addresses','account-button account-secondary');address.href='https://shopify.com/108550685006/account';edit.append(address);panel.append(edit);
  }
  function backLink(){
    const url=new URL(location.href),country=url.searchParams.get('country');const allowed=['DE','FR','NL','PL','ES','PT','IT','GR'];
    let destination=allowed.includes(country)?`mall.html?country=${country}`:'index.html';
    try{const previous=new URL(url.searchParams.get('return')||'',location.origin);if(previous.origin===location.origin&&/^\/(index|mall|search|tech|home|pets|beauty|fashion|kids|auto)(\.html)?$/.test(previous.pathname)){const safe=new URL(previous.pathname,location.origin);const region=previous.searchParams.get('country');if(allowed.includes(region))safe.searchParams.set('country',region);destination=safe.pathname+safe.search;}}catch{}
    const back=document.querySelector('[data-profile-back]');if(back)back.href=destination;
  }
  for(const link of document.querySelectorAll('.account-link')) {
    const country=new URL(location.href).searchParams.get('country');const dest=new URL('account.html',location.href);
    if(['DE','FR','NL','PL','ES','PT','IT','GR'].includes(country))dest.searchParams.set('country',country);
    if(!/\/account(\.html)?$/.test(location.pathname))dest.searchParams.set('return',location.pathname+(['DE','FR','NL','PL','ES','PT','IT','GR'].includes(country)?`?country=${country}`:''));
    link.href=dest.href;
  }
  window.ViziProfile={editor,read,header,backLink};backLink();header();read().then(header).catch(()=>header());
})();
