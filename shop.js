(() => {
  const image = document.querySelector('.shop-backdrop img');
  function position() {
    if (!image.naturalWidth) return;
    const center = Number(document.body.dataset.center);
    const ratio = image.naturalWidth/image.naturalHeight;
    const height = Math.max(innerHeight*1.55,innerWidth/(.18*ratio));
    const width = height*ratio;
    image.style.height = `${height}px`;
    image.style.width = `${width}px`;
    image.style.left = `${innerWidth/2-center*width+14}px`;
    image.style.top = `${innerHeight/2-height*.48+14}px`;
    image.classList.add('ready');
  }
  image.addEventListener('load',position);
  window.addEventListener('resize',position);
  position();
})();
