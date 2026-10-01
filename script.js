const stores = [
  {
    key: "home",
    number: "01",
    name: "Home & Living",
    description: "Calm spaces. Smarter living.",
    image: "./store-home.png"
  },
  {
    key: "tech",
    number: "02",
    name: "Tech & Gadgets",
    description: "Useful technology. Everyday upgrades.",
    image: "./store-tech.png"
  },
  {
    key: "auto",
    number: "03",
    name: "Auto Essentials",
    description: "Better drives. Smarter accessories.",
    image: "./store-auto.png"
  },
  {
    key: "travel",
    number: "04",
    name: "Travel & Explore",
    description: "Pack lighter. Go further.",
    image: "./store-travel.png"
  },
  {
    key: "beauty",
    number: "05",
    name: "Beauty & Care",
    description: "Simple rituals. Everyday care.",
    image: "./store-beauty.png"
  },
  {
    key: "pets",
    number: "06",
    name: "Pets & Friends",
    description: "Small comforts. Happier companions.",
    image: "./store-pets.png"
  }
];

let currentIndex = 3;
let touchStartX = 0;
let touchEndX = 0;

const storeCards = [...document.querySelectorAll(".store-card")];

const currentNumber = document.getElementById("currentNumber");
const currentName = document.getElementById("currentName");

const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");

const storeView = document.getElementById("storeView");
const storeTitle = document.getElementById("storeTitle");
const storeDescription = document.getElementById("storeDescription");
const storeInteriorHero = document.getElementById("storeInteriorHero");

const backBtn = document.getElementById("backBtn");

const menuBtn = document.getElementById("menuBtn");
const drawer = document.getElementById("drawer");
const closeDrawer = document.getElementById("closeDrawer");
const drawerBackdrop = document.getElementById("drawerBackdrop");

const mallViewport = document.getElementById("mallViewport");


function normalizeIndex(index) {
  if (index < 0) {
    return stores.length - 1;
  }

  if (index >= stores.length) {
    return 0;
  }

  return index;
}


function updateMall() {
  currentIndex = normalizeIndex(currentIndex);

  const activeStore = stores[currentIndex];

  currentNumber.textContent = activeStore.number;
  currentName.textContent = activeStore.name;

  storeCards.forEach((card, index) => {
    const offset = index - currentIndex;

    card.classList.toggle(
      "is-active",
      index === currentIndex
    );

    if (window.innerWidth <= 760) {
      card.style.transform =
        index === currentIndex
          ? "translateX(-50%) scale(1)"
          : "translateX(-50%) scale(.92)";

      card.style.opacity =
        index === currentIndex ? "1" : "0";

      card.style.pointerEvents =
        index === currentIndex ? "auto" : "none";

      card.style.zIndex =
        index === currentIndex ? "40" : "10";

      return;
    }

    let translateX = 0;
    let translateY = 0;
    let scale = 0.75;
    let rotateY = 0;
    let opacity = 0;
    let zIndex = 10;

    if (offset === 0) {
      translateX = -50;
      translateY = 0;
      scale = 1.04;
      rotateY = 0;
      opacity = 1;
      zIndex = 50;
    }

    if (offset === -1 || offset === 5) {
      translateX = -155;
      translateY = 10;
      scale = 0.86;
      rotateY = 9;
      opacity = 0.78;
      zIndex = 35;
    }

    if (offset === 1 || offset === -5) {
      translateX = 55;
      translateY = 10;
      scale = 0.86;
      rotateY = -9;
      opacity = 0.78;
      zIndex = 35;
    }

    if (offset === -2 || offset === 4) {
      translateX = -235;
      translateY = 34;
      scale = 0.68;
      rotateY = 14;
      opacity = 0.42;
      zIndex = 20;
    }

    if (offset === 2 || offset === -4) {
      translateX = 135;
      translateY = 34;
      scale = 0.68;
      rotateY = -14;
      opacity = 0.42;
      zIndex = 20;
    }

    if (Math.abs(offset) === 3) {
      opacity = 0;
      zIndex = 5;
    }

    card.style.left = "50%";
    card.style.right = "auto";
    card.style.top = "39%";
    card.style.bottom = "auto";

    card.style.transform = `
      translateX(${translateX}%)
      translateY(${translateY}px)
      rotateY(${rotateY}deg)
      scale(${scale})
    `;

    card.style.opacity = opacity;
    card.style.zIndex = zIndex;

    card.style.pointerEvents =
      opacity > 0.5 ? "auto" : "none";
  });
}


function nextStore() {
  currentIndex++;
  updateMall();
}


function previousStore() {
  currentIndex--;
  updateMall();
}


function jumpToStore(storeKey) {
  const index = stores.findIndex(
    (store) => store.key === storeKey
  );

  if (index === -1) return;

  currentIndex = index;

  updateMall();

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}


function openStore(storeKey) {
  const index = stores.findIndex(
    (store) => store.key === storeKey
  );

  if (index === -1) return;

  currentIndex = index;

  const store = stores[currentIndex];

  updateMall();

  storeTitle.textContent = store.name;
  storeDescription.textContent = store.description;

  storeInteriorHero.style.backgroundImage = `
    linear-gradient(
      to bottom,
      rgba(0,0,0,.12),
      rgba(0,0,0,.52)
    ),
    url("${store.image}")
  `;

  storeInteriorHero.style.backgroundSize = "cover";
  storeInteriorHero.style.backgroundPosition = "center";

  storeView.classList.add("active");

  storeView.setAttribute(
    "aria-hidden",
    "false"
  );

  document.body.style.overflow = "hidden";

  storeView.scrollTop = 0;
}


function closeStoreView() {
  storeView.classList.remove("active");

  storeView.setAttribute(
    "aria-hidden",
    "true"
  );

  document.body.style.overflow = "";
}


function openDirectory() {
  drawer.classList.add("open");
  drawerBackdrop.classList.add("open");
}


function closeDirectory() {
  drawer.classList.remove("open");
  drawerBackdrop.classList.remove("open");
}


storeCards.forEach((card) => {
  card.addEventListener("click", () => {
    const storeKey =
      card.getAttribute("data-store");

    openStore(storeKey);
  });
});


document
  .querySelectorAll("[data-directory]")
  .forEach((button) => {
    button.addEventListener("click", () => {
      const storeKey =
        button.getAttribute("data-directory");

      jumpToStore(storeKey);
    });
  });


document
  .querySelectorAll("[data-drawer-store]")
  .forEach((button) => {
    button.addEventListener("click", () => {
      const storeKey =
        button.getAttribute("data-drawer-store");

      closeDirectory();

      jumpToStore(storeKey);
    });
  });


if (nextBtn) {
  nextBtn.addEventListener(
    "click",
    nextStore
  );
}


if (prevBtn) {
  prevBtn.addEventListener(
    "click",
    previousStore
  );
}


if (backBtn) {
  backBtn.addEventListener(
    "click",
    closeStoreView
  );
}


if (menuBtn) {
  menuBtn.addEventListener(
    "click",
    openDirectory
  );
}


if (closeDrawer) {
  closeDrawer.addEventListener(
    "click",
    closeDirectory
  );
}


if (drawerBackdrop) {
  drawerBackdrop.addEventListener(
    "click",
    closeDirectory
  );
}


document.addEventListener(
  "keydown",
  (event) => {

    if (
      event.key === "Escape" &&
      storeView.classList.contains("active")
    ) {
      closeStoreView();
      return;
    }

    if (
      event.key === "Escape" &&
      drawer.classList.contains("open")
    ) {
      closeDirectory();
      return;
    }

    if (
      storeView.classList.contains("active")
    ) {
      return;
    }

    if (event.key === "ArrowRight") {
      nextStore();
    }

    if (event.key === "ArrowLeft") {
      previousStore();
    }
  }
);


if (mallViewport) {

  mallViewport.addEventListener(
    "touchstart",
    (event) => {
      touchStartX =
        event.changedTouches[0].screenX;
    },
    { passive: true }
  );


  mallViewport.addEventListener(
    "touchend",
    (event) => {

      touchEndX =
        event.changedTouches[0].screenX;

      const distance =
        touchEndX - touchStartX;

      if (Math.abs(distance) < 45) {
        return;
      }

      if (distance < 0) {
        nextStore();
      } else {
        previousStore();
      }

    },
    { passive: true }
  );

}


window.addEventListener(
  "resize",
  updateMall
);


updateMall();
