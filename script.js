const viewport = document.getElementById("panoramaViewport");
const track = document.getElementById("panoramaTrack");
const image = document.getElementById("panoramaImage");
const progressBar = document.getElementById("progressBar");

let isDragging = false;
let startPointerX = 0;
let startTranslateX = 0;
let currentX = 0;
let minX = 0;
let maxX = 0;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function setTranslate(x) {
  currentX = clamp(x, minX, maxX);
  track.style.transform = `translate3d(${currentX}px, 0, 0)`;
  updateProgress();
}

function updateBounds() {
  const viewportWidth = viewport.clientWidth;
  const imageWidth = image.offsetWidth;

  if (!imageWidth) return;

  maxX = 0;
  minX = Math.min(0, viewportWidth - imageWidth);

  if (imageWidth <= viewportWidth) {
    const centered = (viewportWidth - imageWidth) / 2;
    minX = centered;
    maxX = centered;
  }

  currentX = clamp(currentX, minX, maxX);
  setTranslate(currentX);
}

function updateProgress() {
  const totalScrollable = Math.abs(minX);

  if (totalScrollable <= 0) {
    progressBar.style.width = "100%";
    return;
  }

  const progress = Math.abs(currentX) / totalScrollable;
  const percent = 20 + progress * 80;
  progressBar.style.width = `${percent}%`;
}

function pointerDown(clientX) {
  isDragging = true;
  startPointerX = clientX;
  startTranslateX = currentX;
  viewport.classList.add("is-dragging");
}

function pointerMove(clientX) {
  if (!isDragging) return;

  const delta = clientX - startPointerX;
  setTranslate(startTranslateX + delta);
}

function pointerUp() {
  isDragging = false;
  viewport.classList.remove("is-dragging");
}

viewport.addEventListener("mousedown", (e) => {
  e.preventDefault();
  pointerDown(e.clientX);
});

window.addEventListener("mousemove", (e) => {
  pointerMove(e.clientX);
});

window.addEventListener("mouseup", () => {
  pointerUp();
});

viewport.addEventListener(
  "touchstart",
  (e) => {
    if (e.touches.length !== 1) return;
    pointerDown(e.touches[0].clientX);
  },
  { passive: true }
);

viewport.addEventListener(
  "touchmove",
  (e) => {
    if (e.touches.length !== 1) return;
    pointerMove(e.touches[0].clientX);
  },
  { passive: true }
);

viewport.addEventListener(
  "touchmove",
  (e) => {
    if (e.touches.length !== 1) return;

    e.preventDefault();
    pointerMove(e.touches[0].clientX);
  },
  { passive: false }
);

viewport.addEventListener("mouseleave", () => {
  if (isDragging) {
    pointerUp();
  }
});

image.addEventListener("load", () => {
  updateBounds();

  if (minX < 0) {
    const initialX = minX * 0.15;
    setTranslate(initialX);
  }
});

window.addEventListener("resize", updateBounds);

if (image.complete) {
  updateBounds();

  if (minX < 0) {
    const initialX = minX * 0.15;
    setTranslate(initialX);
  }
}
