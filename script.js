(() => {
  const viewport = document.getElementById('panoramaViewport');
  const track = document.getElementById('panoramaTrack');
  const canvas = document.querySelector('.panorama-canvas');
  const image = document.getElementById('panoramaImage');

  const indicator = document.getElementById('storeIndicator');
  const label = document.getElementById('storeIndicatorText');
  let x = 0, min = 0, max = 0, pointer = null, dragged = false, timer, entering = false, entryTimer;
  const clamp = v => Math.max(min, Math.min(max, v));
  let frame = 0, coast = 0, velocity = 0;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  function stopMotion() {
    cancelAnimationFrame(frame); cancelAnimationFrame(coast);
    frame = coast = 0; velocity = 0;
  }
  function paint() {
    frame = 0;
    track.style.transform = `translate3d(${x}px,0,0)`;
  }
  function glide() {
    let previous = performance.now();
    function tick(now) {
      const dt = Math.min(32, now - previous); previous = now;
      const next = clamp(x + velocity * dt);
      const atEdge = next === x;
      x = next; paint();
      velocity *= Math.exp(-dt / 240);
      if (!atEdge && Math.abs(velocity) > .025 && !entering) coast = requestAnimationFrame(tick);
      else {coast = 0; velocity = 0;}
    }
    coast = requestAnimationFrame(tick);
  }
  function move(value) {
    x = clamp(value);
    if (!frame) frame = requestAnimationFrame(paint);
  }
  function bounds(initial = false) {
    stopMotion();
    const ratio = max === min ? .15 : (max-x)/(max-min);
    const width = canvas.offsetWidth;
    canvas.style.setProperty("--scene-unit", `${canvas.offsetHeight/730}px`);
    if (entering) return;
    if (!width) return;
    min = Math.min(0, viewport.clientWidth-width); max = 0;
    if (width < viewport.clientWidth) min = max = (viewport.clientWidth-width)/2;
    let saved = null;
    try { saved = sessionStorage.getItem('vizimall-position'); } catch {}
    const fraction = initial && saved !== null ? Number(saved) : ratio;
    move(max - (max-min) * (Number.isFinite(fraction) ? fraction : .15));
  }
  viewport.addEventListener('pointerdown', e => {
    if (entering || !e.isPrimary || e.button !== 0) return;
    stopMotion();
    // Prevent native button focus from panning the clipped viewport during a drag.
    e.preventDefault();
    dragged = false;
    pointer = {id:e.pointerId, start:e.clientX, startY:e.clientY, x, lastX:e.clientX, lastTime:performance.now()};
  });
  window.addEventListener('pointermove', e => {
    if (!pointer || pointer.id !== e.pointerId) return;
    const delta = e.clientX-pointer.start;
    if (Math.hypot(delta,e.clientY-pointer.startY)>8) dragged = true;
    if (dragged) {
      if (!viewport.hasPointerCapture(e.pointerId)) viewport.setPointerCapture(e.pointerId);
      viewport.classList.add('is-dragging');
      const now = performance.now();
      const dt = Math.max(1, now - pointer.lastTime);
      const sample = Math.max(-2.5, Math.min(2.5, (e.clientX-pointer.lastX)/dt));
      velocity = velocity*.35 + sample*.65;
      pointer.lastX = e.clientX; pointer.lastTime = now;
      move(pointer.x+delta);
    }
  });
  function end(e) {
    if (!pointer || (e && e.pointerId !== pointer.id)) return;
    const shouldGlide = e && e.type === 'pointerup' && dragged && performance.now()-pointer.lastTime < 100 && !reducedMotion.matches;
    const id = pointer.id; pointer = null;
    viewport.classList.remove('is-dragging');
    if (viewport.hasPointerCapture(id)) viewport.releasePointerCapture(id);
    if (shouldGlide) glide(); else velocity = 0;
  }
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  viewport.addEventListener('lostpointercapture', end);
  window.addEventListener('blur', () => {end();stopMotion();});
  viewport.addEventListener('dragstart', e => e.preventDefault());
  viewport.addEventListener('click', e => {
    if (dragged && e.detail !== 0) {e.preventDefault(); return;}
    const button = e.target.closest('.store-hotspot');
    if (!button) return;
    if (button.dataset.href) {
      try {sessionStorage.setItem('vizimall-position', String(max === min ? 0 : (max-x)/(max-min)));} catch {}
      if (entering) return;
      stopMotion();
      entering = true;
      const cx = button.offsetLeft + button.offsetWidth/2;
      const cy = button.offsetTop + button.offsetHeight/2;
      const scale = Math.max(1.65, viewport.clientWidth/(button.offsetWidth*1.1), viewport.clientHeight/(button.offsetHeight*.95));
      canvas.style.transformOrigin = `${cx}px ${cy}px`;
      // Commit the initial transform before starting the cinematic entry.
      canvas.getBoundingClientRect();
      document.body.classList.add('is-entering');
      track.style.transform = `translate3d(${viewport.clientWidth/2-cx}px,0,0)`;
      canvas.style.transform = `translateY(${viewport.clientHeight/2-canvas.offsetTop-cy}px) scale(${scale})`;
      const delay = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1180;
      entryTimer = setTimeout(() => {location.href = button.dataset.href;}, delay);
    } else {
      clearTimeout(timer);
      label.textContent = 'UPSTAIRS · COMING SOON';
      indicator.classList.add('show');
      timer = setTimeout(() => indicator.classList.remove('show'), 2500);
    }
  });
  viewport.addEventListener('wheel', e => {if(entering || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return; e.preventDefault(); stopMotion(); move(x-e.deltaX*(e.deltaMode===1?16:1));}, {passive:false});
  viewport.addEventListener('keydown', e => {
    if (entering) return;
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return;
    e.preventDefault();
    stopMotion();
    move(e.key === 'Home' ? max : e.key === 'End' ? min : x + (e.key === 'ArrowLeft' ? 1 : -1)*viewport.clientWidth*.3);
  });
  viewport.addEventListener('focusin', e => {
    if (!entering && e.target.matches('.store-hotspot')) {stopMotion(); viewport.scrollLeft=0; move(viewport.clientWidth/2-e.target.offsetLeft-e.target.offsetWidth/2);}
  });
  window.addEventListener('pageshow', () => {clearTimeout(entryTimer); entering=false; document.body.classList.remove('is-entering'); canvas.style.transform=''; bounds(true);});
  image.addEventListener('load', () => bounds(true));
  image.addEventListener('error', () => {label.textContent='The panorama could not load. Please refresh.';indicator.classList.add('show');});
  new ResizeObserver(() => bounds()).observe(viewport);
  if (image.complete && image.naturalWidth) bounds(true);
})();
