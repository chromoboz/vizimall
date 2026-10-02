const viewport = document.getElementById("panoramaViewport");
const track = document.getElementById("panoramaTrack");
const image = document.getElementById("panoramaImage");
const progressBar = document.getElementById("progressBar");

const canvas = document.querySelector(".panorama-canvas");

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

let indicatorTimer;
let zoomTimer;


/* =========================
   HELPERS
========================= */

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}


/* =========================
   PANORAMA POSITION
========================= */

function setTranslate(x) {
  currentX = clamp(x, minX, maxX);

  track.style.transform =
    `translate3d(${currentX}px, 0, 0)`;

  updateProgress();
}


/* =========================
   BOUNDS
========================= */

function updateBounds() {
  const viewportWidth = viewport.clientWidth;
  const imageWidth = image.offsetWidth;

  if (!imageWidth) return;

  maxX = 0;

  minX = Math.min(
    0,
    viewportWidth - imageWidth
  );

  if (imageWidth <= viewportWidth) {
    const centered =
      (viewportWidth - imageWidth) / 2;

    minX = centered;
    maxX = centered;
  }

  currentX = clamp(
    currentX,
    minX,
    maxX
  );

  setTranslate(currentX);
}


/* =========================
   PROGRESS
========================= */

function updateProgress() {
  const totalScrollable =
    Math.abs(minX);

  if (totalScrollable <= 0) {
    progressBar.style.width = "100%";
    return;
  }

  const progress =
    Math.abs(currentX) /
    totalScrollable;

  const percent =
    20 + progress * 80;

  progressBar.style.width =
    `${percent}%`;
}


/* =========================
   DRAG
========================= */

function pointerDown(clientX) {
  if (isFocusing) return;

  isDragging = true;

  startPointerX = clientX;
  startTranslateX = currentX;

  viewport.classList.add(
    "is-dragging"
  );

  track.classList.remove(
    "is-focusing"
  );
}


function pointerMove(clientX) {
  if (!isDragging) return;
  if (isFocusing) return;

  const delta =
    clientX - startPointerX;

  setTranslate(
    startTranslateX + delta
  );
}


function pointerUp() {
  isDragging = false;

  viewport.classList.remove(
    "is-dragging"
  );
}


/* =========================
   MOUSE
========================= */

viewport.addEventListener(
  "mousedown",
  (event) => {

    event.preventDefault();

    pointerDown(
      event.clientX
    );
  }
);


window.addEventListener(
  "mousemove",
  (event) => {

    pointerMove(
      event.clientX
    );
  }
);


window.addEventListener(
  "mouseup",
  () => {

    pointerUp();
  }
);


viewport.addEventListener(
  "mouseleave",
  () => {

    if (isDragging) {
      pointerUp();
    }
  }
);


/* =========================
   TOUCH
========================= */

viewport.addEventListener(
  "touchstart",
  (event) => {

    if (
      event.touches.length !== 1
    ) {
      return;
    }

    pointerDown(
      event.touches[0].clientX
    );
  },
  {
    passive: true
  }
);


viewport.addEventListener(
  "touchmove",
  (event) => {

    if (
      event.touches.length !== 1
    ) {
      return;
    }

    event.preventDefault();

    pointerMove(
      event.touches[0].clientX
    );
  },
  {
    passive: false
  }
);


viewport.addEventListener(
  "touchend",
  () => {

    pointerUp();
  },
  {
    passive: true
  }
);


/* =========================
   STORE INDICATOR
========================= */

function showStoreName(name) {

  clearTimeout(
    indicatorTimer
  );

  if (name === "UPSTAIRS") {

    storeIndicatorText.textContent =
      "UPSTAIRS · COMING SOON";

  } else {

    storeIndicatorText.textContent =
      name;
  }

  storeIndicator.classList.add(
    "show"
  );

  indicatorTimer =
    setTimeout(() => {

      storeIndicator.classList.remove(
        "show"
      );

    }, 2200);
}


/* =========================
   FOCUS STORE
========================= */

function focusStore(hotspot) {

  if (isFocusing) return;

  isFocusing = true;

  clearTimeout(
    zoomTimer
  );

  const hotspotCenter =
    hotspot.offsetLeft +
    hotspot.offsetWidth / 2;

  const viewportCenter =
    viewport.clientWidth / 2;

  const targetX =
    viewportCenter -
    hotspotCenter;

  const finalX =
    clamp(
      targetX,
      minX,
      maxX
    );


  /* Zoom point = clicked store */
  const originPercent =
    (
      hotspotCenter /
      canvas.offsetWidth
    ) * 100;

  canvas.style.transformOrigin =
    `${originPercent}% 50%`;


  /* Smooth horizontal move */
  track.classList.add(
    "is-focusing"
  );

  currentX = finalX;

  track.style.transform =
    `translate3d(${finalX}px, 0, 0)`;

  updateProgress();


  /* Zoom */
  requestAnimationFrame(() => {

    canvas.classList.add(
      "is-zoomed"
    );
  });


  /* Show store name */
  setTimeout(() => {

    showStoreName(
      hotspot.dataset.store
    );

  }, 350);


  /* Gently return from zoom */
  zoomTimer =
    setTimeout(() => {

      canvas.classList.remove(
        "is-zoomed"
      );

      setTimeout(() => {

        track.classList.remove(
          "is-focusing"
        );

        isFocusing = false;

      }, 650);

    }, 1250);
}


/* =========================
   HOTSPOT CLICKS
========================= */

hotspots.forEach(
  (hotspot) => {

    hotspot.addEventListener(
      "click",
      (event) => {

        const movement =
          Math.abs(
            currentX -
            startTranslateX
          );

        /*
          If user was dragging,
          don't count it as click.
        */
        if (movement > 8) {
          return;
        }

        event.stopPropagation();

        focusStore(
          hotspot
        );
      }
    );

  }
);


/* =========================
   IMAGE LOAD
========================= */

function initialisePanorama() {

  updateBounds();

  if (minX < 0) {

    const initialX =
      minX * 0.15;

    setTranslate(
      initialX
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
