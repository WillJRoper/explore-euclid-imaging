/**
 * @fileoverview Main application logic for the Euclid Image Explorer.
 *
 * Hooks into the OpenSeadragon viewer to:
 *  - Render clickable hotspot overlays that link DZI tilesets.
 *  - Manage a navigation stack (back button, history).
 *  - Provide an idle-timer that auto-returns to a user-saved home view.
 *
 * @requires OpenSeadragon – loaded via <script> tag in index.html
 * @requires ./regions.js   – ES module for loading hotspot definitions
 */

import Regions from "./regions.js";

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

/** @const {string} localStorage key under which the home view is persisted. */
const STORAGE_KEY = "euclid_home_view";

/** @const {string} Key used for the top-level mosaic image. */
const MAIN_KEY = "main";

/* ------------------------------------------------------------------ */
/*  Module-level state                                                */
/* ------------------------------------------------------------------ */

/** @type {string} Currently displayed image key (e.g. "main", "ngc_2188"). */
let currentKey = MAIN_KEY;

/** @type {number|null} Handle returned by setTimeout for the idle-return timer. */
let idleTimer = null;

/** @type {OpenSeadragon.Viewer|null} The OSD viewer instance. */
let viewer = null;

/**
 * Array of active OpenSeadragon.MouseTracker instances attached to
 * hotspot overlay elements.  Kept so they can be torn down on image switch.
 * @type {Array<OpenSeadragon.MouseTracker>}
 */
let hotspotTrackers = [];

/**
 * Parsed regions data from regions.yaml.
 * @type {Regions|null}
 */
let regions = null;

/**
 * Stack of previously-visited image keys (most recent last).
 * Used by the back-button to implement a simple navigation history.
 * @type {Array<string>}
 */
let history = [];

/**
 * Stack of viewport bounds corresponding to each entry in `history`.
 * @type {Array<OpenSeadragon.Rect>}
 */
let viewHistory = [];

/**
 * Default zoom level to apply when entering a new image.
 * Overridden per-hotspot via `default_zoom` in regions.yaml.
 * @type {number}
 */
let defaultZoom = 1.0;

/**
 * Flag set to true after the "open" handler fires, allowing the
 * zoom-out auto-return mechanism to trigger once.
 * Currently unused (the zoom handler is commented out).
 * @type {boolean}
 */
let zoomReturnArmed = false;

/* ------------------------------------------------------------------ */
/*  Viewer initialisation                                             */
/* ------------------------------------------------------------------ */

/**
 * Create and configure the OpenSeadragon viewer.
 *
 * A single persistent viewer is created.  Whenever a different DZI
 * is opened via {@link viewer.open}, OSD reuses this instance while
 * the "open" handler redraws hotspot overlays.
 *
 * Gesture settings are tuned for both desktop (scroll-to-zoom) and
 * mobile (pinch-to-zoom, flick) interaction.
 */
function initViewer() {
  viewer = OpenSeadragon({
    element: "viewer",
    prefixUrl:
      "https://cdnjs.cloudflare.com/ajax/libs/openseadragon/4.0.0/images/",
    fullPage: true,

    defaultZoomLevel: defaultZoom,
    maxZoomPixelRatio: 4,
    minZoomImageRatio: 0.45,
    showNavigator: false,

    gestureSettingsMouse: {
      scrollToZoom: true,
      clickToZoom: false,
      dblClickToZoom: false,
      pinchToZoom: true,
    },

    gestureSettingsTouch: {
      scrollToZoom: false,
      pinchToZoom: true,
      clickToZoom: false,
      dblClickToZoom: false,
      flickEnabled: true,
    },
  });

  /*
   * Every time a new DZI finishes loading, clear old overlays,
   * render the new hotspots, and show/hide the back button.
   */
  viewer.addHandler("open", () => {
    clearHotspots();
    renderRegions(currentKey);
    toggleBackButton();
    document.querySelector("#viewer .openseadragon-canvas").style.opacity = 1;
    zoomReturnArmed = true;
  });

  /*
   * (Commented out) Zoom-out-to-return mechanism.
   * When uncommented, zooming out to the minimum zoom level on a
   * sub-region would trigger an automatic return to the parent image.
   * Left in place as a reference for future development.
   */
  // viewer.addHandler("zoom", (evt) => {
  //   const vp = viewer.viewport;
  //   const minZ = vp.getMinZoom();
  //   const curZ = evt.zoom;
  //   if (zoomReturnArmed && curZ <= minZ + 1e-6) {
  //     zoomReturnArmed = false;
  //     if (currentKey !== MAIN_KEY) {
  //       zoomReturnTo();
  //     }
  //   }
  // });

  /*
   * Any user interaction (pointer down or scroll) resets the idle
   * timer that triggers auto-return to the saved home view.
   */
  const container = document.getElementById("viewer");
  container.addEventListener("pointerdown", startIdleTimer);
  container.addEventListener("wheel", startIdleTimer, { passive: true });
}

/* ------------------------------------------------------------------ */
/*  Hotspot management                                                */
/* ------------------------------------------------------------------ */

/**
 * Remove all hotspot overlay elements and destroy their mouse trackers.
 *
 * Called before rendering new hotspots when switching images, so that
 * stale overlays do not persist.
 */
function clearHotspots() {
  viewer.clearOverlays();
  hotspotTrackers.forEach((tr) => {
    tr.setTracking(false);
    tr.destroy();
  });
  hotspotTrackers = [];
}

/**
 * Render clickable hotspot overlays for a given image key.
 *
 * For each region definition found in `regions[key]`, a `<div>` element
 * is created, positioned using the hotspot's pixel coordinates converted
 * into viewport space, and registered with an OpenSeadragon overlay.
 *
 * @param {string} key - Image key whose hotspots should be drawn.
 */
function renderRegions(key) {
  const defs = regions[key] || [];

  const tiledImage = viewer.world.getItemAt(0);
  const imgWidth = tiledImage ? tiledImage.getContentSize().x : 1;

  defs.forEach((def) => {
    const imgPt = new OpenSeadragon.Point(def.x_px, def.y_px);
    const vpCenter = viewer.viewport.imageToViewportCoordinates(imgPt);

    const vpRect = new OpenSeadragon.Rect(
      vpCenter.x,
      vpCenter.y,
      def.hotspot_size / imgWidth,
      def.hotspot_size / imgWidth,
    );

    const elt = document.createElement("div");
    elt.className = "region-hotspot";

    viewer.addOverlay(elt, vpRect, OpenSeadragon.Placement.CENTER);

    const tracker = new OpenSeadragon.MouseTracker({
      element: elt,
      clickHandler: () => {
        setDefaultZoom(def.default_zoom || defaultZoom);
        switchTo(def.target);
      },
    });
    tracker.setTracking(true);
    hotspotTrackers.push(tracker);
  });
}

/* ------------------------------------------------------------------ */
/*  Navigation helpers                                                */
/* ------------------------------------------------------------------ */

/**
 * Set the zoom level that will be applied the next time an image opens.
 *
 * @param {number} zoom - New default zoom level.
 */
function setDefaultZoom(zoom) {
  defaultZoom = zoom;
}

/**
 * Show or hide the back-arrow depending on whether we are on the
 * main mosaic image or a sub-region.
 */
function toggleBackButton() {
  const btn = document.getElementById("backMain");
  if (currentKey === MAIN_KEY) {
    btn.classList.add("hidden");
  } else {
    btn.classList.remove("hidden");
  }
}

/**
 * Navigate to a different DZI image.
 *
 * The current position is saved into the navigation stack, the canvas
 * fades out, the new image is opened, and the idle timer is restarted.
 *
 * @param {string} key - Target image key (directory / DZI file stem).
 */
function switchTo(key) {
  clearTimeout(idleTimer);

  const osdCanvas = document.querySelector("#viewer .openseadragon-canvas");
  osdCanvas.style.opacity = 0;

  /*
   * Wait for the CSS opacity transition (100 ms) before swapping images
   * so the user sees a smooth cross-fade.
   */
  setTimeout(() => {
    history.push(currentKey);
    viewHistory.push(viewer.viewport.getBounds());

    currentKey = key;

    const file = key === MAIN_KEY ? "euclid.dzi" : `${key}.dzi`;
    viewer.open(`${key}/${file}`);

    startIdleTimer();
  }, 100);
}

/* ------------------------------------------------------------------ */
/*  Idle-timer / auto-return to home                                  */
/* ------------------------------------------------------------------ */

/**
 * Start (or restart) the 30-second idle countdown.
 *
 * If the user has saved a home view (stored in localStorage), the
 * viewer will automatically return to that view after 30 s of
 * inactivity.  Calling this function resets the countdown.
 */
function startIdleTimer() {
  clearTimeout(idleTimer);

  if (!localStorage.getItem(STORAGE_KEY)) {
    return;
  }

  idleTimer = setTimeout(returnToHome, 30000);
}

/**
 * Return to the saved home view on the main mosaic image.
 *
 * Clears history and navigates back to `MAIN_KEY`.  Once the DZI
 * finishes loading, the viewport is fitted to the saved bounds.
 */
function returnToHome() {
  clearTimeout(idleTimer);

  const homeView = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");

  /* Bail early if we are already at the saved location. */
  const currentBounds = viewer.viewport.getBounds();
  if (
    homeView &&
    currentBounds.x === homeView.x &&
    currentBounds.y === homeView.y &&
    currentBounds.width === homeView.width &&
    currentBounds.height === homeView.height
  ) {
    return;
  }

  const osdCanvas = document.querySelector("#viewer .openseadragon-canvas");
  osdCanvas.style.opacity = 0;

  setTimeout(() => {
    currentKey = MAIN_KEY;

    const url = `${MAIN_KEY}/euclid.dzi`;
    viewer.open(url);

    history = [];

    viewer.addOnceHandler("open", () => {
      if (homeView) {
        viewer.viewport.fitBounds(
          new OpenSeadragon.Rect(
            homeView.x,
            homeView.y,
            homeView.width,
            homeView.height,
          ),
          true,
        );
      }
    });

    startIdleTimer();
  }, 100);
}

/* ------------------------------------------------------------------ */
/*  History-based back navigation                                     */
/* ------------------------------------------------------------------ */

/**
 * Go back one step in navigation history.
 *
 * Pops the last image key and viewport bounds and opens that image,
 * restoring the saved viewport position.
 */
function returnTo() {
  clearTimeout(idleTimer);

  const osdCanvas = document.querySelector("#viewer .openseadragon-canvas");
  osdCanvas.style.opacity = 0;

  setTimeout(() => {
    let lastView;
    if (history.length > 0) {
      currentKey = history.pop();
      lastView = viewHistory.pop();
    } else {
      currentKey = MAIN_KEY;
      lastView = null;
    }

    const file = currentKey === MAIN_KEY ? "euclid.dzi" : `${currentKey}.dzi`;
    viewer.open(`${currentKey}/${file}`);

    if (lastView) {
      viewer.addOnceHandler("open", () => {
        viewer.viewport.fitBounds(
          new OpenSeadragon.Rect(
            lastView.x,
            lastView.y,
            lastView.width,
            lastView.height,
          ),
          true,
        );
      });
    }

    startIdleTimer();
  }, 100);
}

/**
 * (Unused) Zoom-out auto-return.
 *
 * Intended to be triggered when the user zooms out to the minimum
 * zoom level on a sub-region.  Instead of using the back-arrow,
 * zooming all the way out automatically returns to the parent image
 * and animates the viewport to focus on the hotspot that was clicked.
 *
 * Currently unreferenced — kept as a pattern reference.
 */
function zoomReturnTo() {
  clearTimeout(idleTimer);

  const osdCanvas = document.querySelector("#viewer .openseadragon-canvas");
  osdCanvas.style.opacity = 0;

  let lastView = null;
  let leavingKey = currentKey;
  if (history.length) {
    currentKey = history.pop();
    lastView = viewHistory.pop();
  } else {
    currentKey = MAIN_KEY;
  }

  const url = `${currentKey}/${
    currentKey === MAIN_KEY ? "euclid.dzi" : currentKey + ".dzi"
  }`;
  viewer.open(url);

  viewer.addOnceHandler(
    "open",
    () => {
      osdCanvas.style.opacity = 1;

      const leavingRegion = regions[currentKey]?.find(
        (r) => r.target === leavingKey,
      );

      if (leavingRegion) {
        const imgPt = new OpenSeadragon.Point(
          leavingRegion.x_px,
          leavingRegion.y_px,
        );
        const focusPt = viewer.viewport.imageToViewportCoordinates(imgPt);
        viewer.viewport.zoomTo(1e4, focusPt, true);
      } else if (lastView) {
        viewer.viewport.fitBounds(lastView, true);
      }

      startIdleTimer();
    },
    { once: true },
  );
}

/* ------------------------------------------------------------------ */
/*  Home-view persistence                                             */
/* ------------------------------------------------------------------ */

/**
 * Save the current viewport position and zoom as the "home view".
 *
 * The bounds are serialised to JSON and stored in localStorage under
 * `STORAGE_KEY`.  The button is then hidden so the user cannot re-save
 * accidentally.
 */
function saveHomeView() {
  const b = viewer.viewport.getBounds();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(b));
  document.getElementById("saveHome").classList.add("hidden");
  startIdleTimer();
}

/* ------------------------------------------------------------------ */
/*  Controls initialisation                                           */
/* ------------------------------------------------------------------ */

/**
 * Wire up the "Set Home View" button and the back-arrow button.
 *
 * Must be called after the DOM is ready (i.e. inside `init` or a
 * DOMContentLoaded callback).
 */
function initControls() {
  document.getElementById("saveHome").addEventListener("click", saveHomeView);
  document
    .getElementById("backMain")
    .addEventListener("click", () => returnTo());
}

/* ------------------------------------------------------------------ */
/*  Bootstrap                                                         */
/* ------------------------------------------------------------------ */

/**
 * Load hotspot definitions, initialise the viewer and controls, and
 * open the main mosaic image.
 *
 * The saved home view is deliberately cleared on every page load so
 * that first-time visitors see the full mosaic.
 */
async function init() {
  localStorage.removeItem(STORAGE_KEY);
  initViewer();
  initControls();
  await loadRegions();
  viewer.open(`${MAIN_KEY}/euclid.dzi`);
}

/**
 * Fetch and parse the regions YAML file, storing the result in the
 * module-level `regions` variable.
 */
async function loadRegions() {
  try {
    regions = await Regions.load("regions.yaml");
  } catch (err) {
    console.error("Failed to load regions:", err);
  }
}

/* Wait for the HTML to be fully parsed before querying elements. */
document.addEventListener("DOMContentLoaded", init);
