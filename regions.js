/**
 * @fileoverview YAML-based region/hotspot data loader.
 *
 * Provides the {@link Regions} class, which wraps a parsed YAML file
 * whose top-level keys are image identifiers and whose values are arrays
 * of hotspot definitions (pixel coordinates, target, zoom level, etc.).
 *
 * The YAML is fetched at runtime and parsed by js-yaml (loaded from CDN).
 *
 * @example
 * ```js
 * import Regions from "./regions.js";
 * const regions = await Regions.load("regions.yaml");
 * // Access hotspots for a given image key:
 * const hotspots = regions.get("main");
 * ```
 */

import * as jsyaml from "https://cdn.jsdelivr.net/npm/js-yaml@4.1.0/dist/js-yaml.mjs";

/**
 * Wrapper around a parsed regions YAML file.
 *
 * Each top-level key from the YAML (e.g. `"main"`, `"ngc_2188"`) is
 * copied as a property on the instance, whose value is an array of
 * hotspot definition objects.
 */
export default class Regions {
  /**
   * @param {Object<string, Array<HotspotDef>>} data -
   *   Parsed YAML data. Each key maps to an array of hotspot definitions.
   */
  constructor(data) {
    /*
     * Copy every top-level section onto `this` so callers can write
     * `regions.main` or `regions.ngc_2188` directly.
     */
    Object.assign(this, data);
  }

  /**
   * Fetch a YAML file from the network, parse it, and return a
   * {@link Regions} instance.
   *
   * @param {string} url - Relative or absolute URL of the regions YAML.
   * @returns {Promise<Regions>} Resolves once the YAML is fetched and parsed.
   * @throws {Error} If the HTTP fetch fails or the YAML is malformed.
   */
  static async load(url) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(
          `Failed to fetch ${url}: ${res.status} ${res.statusText}`,
        );
      }
      const txt = await res.text();
      const data = jsyaml.load(txt) || {};
      return new Regions(data);
    } catch (err) {
      console.error("Error loading regions.yaml:", err);
      throw err;
    }
  }

  /**
   * Safe getter for a region key.
   *
   * Returns an empty array when the key is undefined, so callers can
   * iterate without null-checking.
   *
   * @param {string} key - Image identifier (e.g. `"main"`).
   * @returns {Array<HotspotDef>} Array of hotspot definitions (may be empty).
   */
  get(key) {
    return this[key] || [];
  }
}

/**
 * @typedef {Object} HotspotDef
 * @property {string}  name         - Human-readable label for this hotspot.
 * @property {string}  target       - Image key to switch to on click.
 * @property {string}  [ra]        - Right Ascension (HH:MM:SS.SS).
 * @property {string}  [dec]       - Declination (DD:MM:SS.SS).
 * @property {number}  x_px        - Centre X in the parent image (pixels).
 * @property {number}  y_px        - Centre Y in the parent image (pixels).
 * @property {number}  [radius_px] - Approximate radius of the region (pixels).
 * @property {number}  default_zoom  - Zoom level to apply when entering the target image.
 * @property {number}  hotspot_size  - Diameter of the clickable UI element (pixels).
 */
