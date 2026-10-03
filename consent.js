(() => {
  'use strict';
  const version = '2026-10-03.1', key = 'vizi-consent', sessionKey = 'vizi-measure-session';
  let choice = null, sent = false, controller;
  try { const saved = JSON.parse(localStorage.getItem(key)); if (saved?.version === version && Date.now() - saved.at < 180 * 86400000 && saved.at <= Date.now()) choice = saved; } catch {}
  const make = (tag, text) => { const node = document.createElement(tag); if (text) node.textContent = text; return node; };
  const footer = make('footer'); footer.className = 'vizi-footer';
  for (const [title, href] of [['Help & returns','help.html'],['Privacy & cookies','privacy.html'],['Email updates','newsletter.html']]) { const link = make('a', title); link.href = href; footer.append(link); }
  const manage = make('button','Cookie preferences'); manage.type = 'button'; footer.append(manage); document.body.append(footer);
  const panel = make('section'); panel.className = 'consent-panel'; panel.hidden = Boolean(choice); panel.setAttribute('role','region'); panel.setAttribute('aria-label','Cookie preferences');
  panel.append(make('h2','Your privacy choices'),make('p','Essential storage keeps your bag, country choice and secure sign-in working. Optional visit measurement runs only if you agree. We do not use advertising trackers or collect email addresses from cookies.'));
  const notice = make('a','Read privacy & cookie information'); notice.href = 'privacy.html'; panel.append(notice);
  const options = make('div'); options.className = 'consent-options'; options.hidden = true;
  const necessary = make('p','Essential storage: always on for requested shopping and privacy preferences.');
  const label = make('label'); const checkbox = make('input'); checkbox.type = 'checkbox'; checkbox.checked = choice?.analytics === true;
  label.append(checkbox,make('span','Allow visit measurement (optional)')); options.append(necessary,label,make('p','Email offers require a separate signup. Cookie acceptance does not subscribe you.')); panel.append(options);
  const actions = make('div'); actions.className = 'consent-actions'; panel.append(actions);
  const accept = make('button','Accept optional measurement'), reject = make('button','Reject optional measurement'), settings = make('button','Manage preferences');
  for (const button of [accept,reject,settings]) { button.type='button'; actions.append(button); }
  const save = make('button','Save preferences'); save.type='button'; save.hidden=true; actions.append(save);
  const feedback = make('p'); feedback.setAttribute('role','status'); footer.append(feedback); document.body.append(panel);
  function choose(analytics) {
    choice = { version, analytics, at: Date.now() }; checkbox.checked = analytics;
    try { localStorage.setItem(key,JSON.stringify(choice)); } catch {}
    if (!analytics) { controller?.abort(); try { sessionStorage.removeItem(sessionKey); } catch {} }
    panel.hidden=true; options.hidden=true; save.hidden=true; settings.hidden=false;
    feedback.textContent = analytics ? 'Optional measurement allowed. You can change this at any time.' : 'Optional measurement off. Shopping remains available.';
    manage.focus(); if (analytics) measure();
  }
  accept.onclick=()=>choose(true); reject.onclick=()=>choose(false); save.onclick=()=>choose(checkbox.checked);
  settings.onclick=()=>{ options.hidden=false; save.hidden=false; settings.hidden=true; };
  manage.onclick=()=>{ panel.hidden=false; options.hidden=false; save.hidden=false; settings.hidden=true; checkbox.checked=choice?.analytics === true; reject.focus(); };
  function measure() {
    if (choice?.analytics !== true || sent || !crypto.randomUUID) return;
    const allowed = ['/', '/index', '/mall', '/tech', '/home', '/pets', '/beauty', '/fashion', '/kids', '/auto', '/account', '/help', '/privacy', '/newsletter'];
    const path = location.pathname.replace(/\.html$/,'').replace(/\/$/,'') || '/'; if (!allowed.includes(path)) return;
    let session; try { session=sessionStorage.getItem(sessionKey); if (!session) { session=crypto.randomUUID(); sessionStorage.setItem(sessionKey,session); } } catch { session=crypto.randomUUID(); }
    sent=true; controller=new AbortController();
    // Never transmit URL queries, referrers, email, account IDs, IP or device details.
    fetch('/api/measure',{method:'POST',credentials:'omit',cache:'no-store',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({version,analytics:true,path,session,event:crypto.randomUUID()})}).catch(()=>{});
  }
  // A same-browser withdrawal in another tab stops future measurement here too.
  addEventListener('storage',event=>{ if(event.key!==key) return; try { const next=JSON.parse(event.newValue); choice=next?.version===version?next:null; if(choice?.analytics!==true){controller?.abort();sessionStorage.removeItem(sessionKey);} checkbox.checked=choice?.analytics===true; } catch {choice=null;controller?.abort();} });
  measure();
})();
