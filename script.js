const viewport = document.getElementById("panoramaViewport");
const track = document.getElementById("panoramaTrack");
const image = document.getElementById("panoramaImage");
const canvas = document.querySelector(".panorama-canvas");

const progressBar = document.getElementById("progressBar");

const hotspots = document.querySelectorAll(".store-hotspot");

const storeIndicator = document.getElementById("storeIndicator");
const storeIndicatorText = document.getElementById("storeIndicatorText");


let isDragging = false;
let isFocusing = false;

let startPointerX = 0;
let startTranslateX = 0;
let currentX = 0;

let minX = 0;
let maxX = 0;

let indicatorTimer = null;
let focusTimer = null;


/* =========================
   HELPERS
========================= */

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}


/* =========================
   PANORAMA POSITION
========================= */

function setTranslate(x, animate = false) {
  currentX = clamp(x, minX, maxX);

  if (animate) {
    track.classList.add("is-focusing");
  } else {
    track.classList.remove("is-focusing");
  }

  track.style.transform =
    `translate3d(${currentX}px, 0, 0)`;

  updateProgress();
}


/* =========================
   PANORAMA BOUNDS
========================= */

function updateBounds() {
  const viewportWidth = viewport.clientWidth;
  const canvasWidth = canvas.offsetWidth;

  if (!canvasWidth) return;

  maxX = 0;
  minX = Math.min(0, viewportWidth - canvasWidth);

  if (canvasWidth <= viewportWidth) {
    const centered =
      (viewportWidth - canvasWidth) / 2;

    minX = centered;
    maxX = centered;
  }

  currentX = clamp(currentX, minX, maxX);

  setTranslate(currentX, false);
}


/* =========================
   PROGRESS BAR
========================= */

function updateProgress() {
  const totalScrollable = Math.abs(minX);

  if (totalScrollable <= 0) {
    progressBar.style.width = "100%";
    return;
  }

  const progress =
    Math.abs(currentX) / totalScrollable;

  const percent =
    20 + progress * 80;

  progressBar.style.width =
    `${percent}%`;
}


/* =========================
   STORE LABEL
========================= */

function showStoreName(storeName) {
  clearTimeout(indicatorTimer);

  if (storeName === "UPSTAIRS") {
    storeIndicatorText.textContent =
      "UPSTAIRS · COMING SOON";
  } else {
    storeIndicatorText.textContent =
      storeName;
  }

  storeIndicator.classList.add("show");

  indicatorTimer = setTimeout(() => {
    storeIndicator.classList.remove("show");
  }, 2200);
}


/* =========================
   FOCUS STORE
========================= */

function focusStore(hotspot) {
  if (isFocusing) return;

  isFocusing = true;

  clearTimeout(focusTimer);

  const hotspotCenter =
    hotspot.offsetLeft +
    hotspot.offsetWidth / 2;

  const viewportCenter =
    viewport.clientWidth / 2;

  const targetX =
    viewportCenter - hotspotCenter;

  const finalX =
    clamp(targetX, minX, maxX);

  const canvasWidth =
    canvas.offsetWidth;

  const originPercent =
    (hotspotCenter / canvasWidth) * 100;


  canvas.style.transformOrigin =
    `${originPercent}% 50%`;


  setTranslate(finalX, true);


  requestAnimationFrame(() => {
    canvas.classList.add("is-zoomed");
  });


  setTimeout(() => {
    showStoreName(
      hotspot.dataset.store
    );
  }, 250);


  focusTimer = setTimeout(() => {
    canvas.classList.remove("is-zoomed");

    setTimeout(() => {
      track.classList.remove("is-focusing");
      isFocusing = false;
    }, 650);

  }, 1400);
}


/* =========================
   MOUSE DRAG
========================= */

viewport.addEventListener("mousedown", (event) => {
  if (isFocusing) return;

  isDragging = true;

  startPointerX = event.clientX;
  startTranslateX = currentX;

  viewport.classList.add("is-dragging");
});


window.addEventListener("mousemove", (event) => {
  if (!isDragging) return;
  if (isFocusing) return;

  const delta =
    event.clientX - startPointerX;

  setTranslate(
    startTranslateX + delta,
    false
  );
});


window.addEventListener("mouseup", () => {
  isDragging = false;

  viewport.classList.remove("is-dragging");
});


viewport.addEventListener("mouseleave", () => {
  if (!isDragging) return;

  isDragging = false;

  viewport.classList.remove("is-dragging");
});


/* =========================
   TOUCH DRAG
========================= */

viewport.addEventListener(
  "touchstart",
  (event) => {

    if (isFocusing) return;
    if (event.touches.length !== 1) return;

    isDragging = true;

    startPointerX =
      event.touches[0].clientX;

    startTranslateX =
      currentX;

    viewport.classList.add("is-dragging");
  },
  {
    passive: true
  }
);


viewport.addEventListener(
  "touchmove",
  (event) => {

    if (!isDragging) return;
    if (isFocusing) return;
    if (event.touches.length !== 1) return;

    event.preventDefault();

    const delta =
      event.touches[0].clientX -
      startPointerX;

    setTranslate(
      startTranslateX + delta,
      false
    );
  },
  {
    passive: false
  }
);


viewport.addEventListener(
  "touchend",
  () => {

    isDragging = false;

    viewport.classList.remove("is-dragging");
  },
  {
    passive: true
  }
);


/* =========================
   HOTSPOT CLICK / TAP
========================= */

hotspots.forEach((hotspot) => {

  let pressX = 0;
  let pressY = 0;


  hotspot.addEventListener(
    "pointerdown",
    (event) => {

      pressX = event.clientX;
      pressY = event.clientY;
    }
  );


  hotspot.addEventListener(
    "pointerup",
    (event) => {

      const moveX =
        Math.abs(
          event.clientX - pressX
        );

      const moveY =
        Math.abs(
          event.clientY - pressY
        );


      /*
        Eğer kullanıcı sürüklediyse
        mağazaya tıklama sayma
      */

      if (
        moveX > 12 ||
        moveY > 12
      ) {
        return;
      }


      event.preventDefault();
      event.stopPropagation();


      focusStore(hotspot);
    }
  );

});


/* =========================
   IMAGE LOAD
========================= */

function initialisePanorama() {
  updateBounds();

  if (minX < 0) {
    const initialX =
      minX * 0.15;

    setTranslate(
      initialX,
      false
    );
  }
}


image.addEventListener(
  "load",
  initialisePanorama
);


window.addEventListener(
  "resize",
  updateBounds
);


if (image.complete) {
  initialisePanorama();
}
