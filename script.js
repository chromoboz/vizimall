const stores = [
  {
    key: "home",
    number: "01",
    name: "Home & Living",
    description: "Calm spaces, useful details and smarter everyday living."
  },
  {
    key: "tech",
    number: "02",
    name: "Tech & Gadgets",
    description: "Useful technology and everyday upgrades."
  },
  {
    key: "auto",
    number: "03",
    name: "Auto Essentials",
    description: "Better drives and smarter accessories."
  },
  {
    key: "travel",
    number: "04",
    name: "Travel & Explore",
    description: "Pack lighter, travel smarter and go further."
  },
  {
    key: "beauty",
    number: "05",
    name: "Beauty & Care",
    description: "Simple rituals and everyday care."
  },
  {
    key: "pets",
    number: "06",
    name: "Pets & Friends",
    description: "Small comforts for happier companions."
  }
];

let currentIndex = 3;
let touchStartX = 0;
let touchEndX = 0;

const storefronts = [...document.querySelectorAll(".storefront")];

const currentStoreNumber =
  document.getElementById("currentStoreNumber");

const currentStoreName =
  document.getElementById("currentStoreName");

const prevStoreButton =
  document.getElementById("prevStore");

const nextStoreButton =
  document.getElementById("nextStore");

const storeView =
  document.getElementById("storeView");

const storeViewTitle =
  document.getElementById("storeViewTitle");

const storeViewDescription =
  document.getElementById("storeViewDescription");

const backToMall =
  document.getElementById("backToMall");

function updateActiveStore() {
  storefronts.forEach((storefront, index) => {
    storefront.classList.toggle(
      "active-store",
      index === currentIndex
    );

    storefront.classList.toggle(
      "mobile-active",
      index === currentIndex
    );
  });

  const store = stores[currentIndex];

  currentStoreNumber.textContent = store.number;
  currentStoreName.textContent = store.name;
}

function nextStore() {
  currentIndex++;

  if (currentIndex >= stores.length) {
    currentIndex = 0;
  }

  updateActiveStore();
}

function previousStore() {
  currentIndex--;

  if (currentIndex < 0) {
    currentIndex = stores.length - 1;
  }

  updateActiveStore();
}

function openStore(storeKey) {
  const storeIndex = stores.findIndex(
    (store) => store.key === storeKey
  );

  if (storeIndex === -1) return;

  currentIndex = storeIndex;
  updateActiveStore();

  const store = stores[currentIndex];

  storeViewTitle.textContent = store.name;
  storeViewDescription.textContent = store.description;

  storeView.classList.add("active");
  storeView.setAttribute("aria-hidden", "false");

  document.body.style.overflow = "hidden";
}

function closeStore() {
  storeView.classList.remove("active");
  storeView.setAttribute("aria-hidden", "true");

  document.body.style.overflow = "";
}

storefronts.forEach((storefront) => {
  storefront.addEventListener("click", () => {
    const storeKey =
      storefront.getAttribute("data-store");

    openStore(storeKey);
  });
});

document
  .querySelectorAll("[data-directory-store]")
  .forEach((button) => {
    button.addEventListener("click", () => {
      const storeKey =
        button.getAttribute("data-directory-store");

      const storeIndex = stores.findIndex(
        (store) => store.key === storeKey
      );

      if (storeIndex === -1) return;

      currentIndex = storeIndex;
      updateActiveStore();

      document
        .getElementById("mall")
        .scrollIntoView({
          behavior: "smooth"
        });
    });
  });

if (prevStoreButton) {
  prevStoreButton.addEventListener(
    "click",
    previousStore
  );
}

if (nextStoreButton) {
  nextStoreButton.addEventListener(
    "click",
    nextStore
  );
}

if (backToMall) {
  backToMall.addEventListener(
    "click",
    closeStore
  );
}

document.addEventListener(
  "keydown",
  (event) => {

    if (
      storeView.classList.contains("active")
      && event.key === "Escape"
    ) {
      closeStore();
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

const mallStage =
  document.querySelector(".mall-stage");

if (mallStage) {

  mallStage.addEventListener(
    "touchstart",
    (event) => {
      touchStartX =
        event.changedTouches[0].screenX;
    },
    { passive: true }
  );

  mallStage.addEventListener(
    "touchend",
    (event) => {
      touchEndX =
        event.changedTouches[0].screenX;

      handleSwipe();
    },
    { passive: true }
  );

}

function handleSwipe() {
  const swipeDistance =
    touchEndX - touchStartX;

  const minimumSwipe = 45;

  if (Math.abs(swipeDistance) < minimumSwipe) {
    return;
  }

  if (swipeDistance < 0) {
    nextStore();
  } else {
    previousStore();
  }
}

updateActiveStore();
