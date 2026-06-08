"""Compute hotspot pixel coordinates from celestial coordinates.

Given a set of astronomical image definitions (positions, sizes in
square degrees and pixel dimensions), this script computes where each
sub-image overlaps with the main mosaic image and writes the resulting
pixel positions to a regions YAML file that the web viewer consumes.

Usage:
    python compute_hotspots.py definitions.yaml regions.yaml

See definitions.yaml for the input schema and regions.yaml for the
output schema.
"""

import math
import sys
import xml.etree.ElementTree as ET

import astropy.units as u
import yaml
from astropy.coordinates import SkyCoord


def parse_dzi_size(dzi_path: str) -> tuple[int, int]:
    """Parse a Deep Zoom Image (.dzi) XML file for its pixel dimensions.

    Args:
        dzi_path: Path to the .dzi XML descriptor.

    Returns:
        Tuple of ``(width_px, height_px)`` as integers.

    Raises:
        FileNotFoundError: If the .dzi file does not exist.
        ET.ParseError: If the XML is malformed.
        AttributeError: If the <Size> element is missing.
    """
    tree = ET.parse(dzi_path)
    root = tree.getroot()
    ns = {"dz": "http://schemas.microsoft.com/deepzoom/2008"}
    size = root.find("dz:Size", ns)
    return int(size.get("Width")), int(size.get("Height"))


def compute_angular_extents(
    area_sqdeg: float, pixel_w: int, pixel_h: int
) -> tuple[float, float]:
    """Compute angular width and height from area and pixel aspect ratio.

    Assumes the image covers a rectangular patch of the sky whose
    angular area (in square degrees) is known and whose aspect ratio
    matches the pixel dimensions.

    Args:
        area_sqdeg: Area covered by the image in square degrees.
        pixel_w: Image width in pixels.
        pixel_h: Image height in pixels.

    Returns:
        Tuple of ``(width_deg, height_deg)``.
    """
    # area = W_deg * H_deg,  with W_deg / H_deg = pixel_w / pixel_h
    k = math.sqrt(area_sqdeg / (pixel_w * pixel_h))
    return k * pixel_w, k * pixel_h


def _overlaps(
    dra: float, ddec: float,
    main_half_w: float, main_half_h: float,
    other_half_w: float, other_half_h: float,
) -> bool:
    """Check if two axis-aligned rectangles overlap.

    Args:
        dra: Separation in RA (degrees, already scaled by cos(dec)).
        ddec: Separation in Dec (degrees).
        main_half_w: Half-width of the main image (degrees).
        main_half_h: Half-height of the main image (degrees).
        other_half_w: Half-width of the other image (degrees).
        other_half_h: Half-height of the other image (degrees).

    Returns:
        True if the two rectangles overlap.
    """
    return (abs(dra) <= main_half_w + other_half_w and
            abs(ddec) <= main_half_h + other_half_h)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python compute_hotspots.py definitions.yaml regions.yaml")
        sys.exit(1)

    defs_file, out_file = sys.argv[1], sys.argv[2]

    # Load the definitions YAML
    with open(defs_file) as f:
        defs = yaml.safe_load(f)

    main_def = defs["main"]
    other_defs = defs.get("others", [])

    # ------------------------------------------------------------------
    # Main image: pixel size, angular size, centre coordinate
    # ------------------------------------------------------------------
    main_w_px, main_h_px = parse_dzi_size(main_def["dzi"])
    main_area = float(main_def["area"])
    main_W_deg, main_H_deg = compute_angular_extents(main_area, main_w_px, main_h_px)
    deg_per_px_x = main_W_deg / main_w_px
    deg_per_px_y = main_H_deg / main_h_px

    main_coord = SkyCoord(
        main_def["ra"], main_def["dec"], unit=(u.hourangle, u.deg)
    )

    # ------------------------------------------------------------------
    # Build the output regions dict (only "main" entries for now)
    # ------------------------------------------------------------------
    regions: dict = {main_def["name"]: []}

    for other in other_defs:
        ocoord = SkyCoord(
            other["ra"], other["dec"], unit=(u.hourangle, u.deg)
        )
        ow_px, oh_px = parse_dzi_size(other["dzi"])
        oarea = float(other["area"])
        oW_deg, oH_deg = compute_angular_extents(oarea, ow_px, oh_px)

        # Separation from the main image centre
        # RA separation is multiplied by cos(dec) to convert from
        # angular to great-circle separation at the declination of the
        # main image centre.
        dra = (ocoord.ra.degree - main_coord.ra.degree) * math.cos(
            math.radians(main_coord.dec.degree)
        )
        ddec = ocoord.dec.degree - main_coord.dec.degree

        if _overlaps(dra, ddec,
                     main_W_deg / 2, main_H_deg / 2,
                     oW_deg / 2, oH_deg / 2):
            # Pixel coordinates: origin at top-left of the main image
            x_px = (dra + main_W_deg / 2) / deg_per_px_x
            # Y is flipped so that positive Dec points upward (smaller y)
            y_px = (main_H_deg / 2 - ddec) / deg_per_px_y

            # Approximate radius: average of half-width and half-height
            r_px_x = (oW_deg / 2) / deg_per_px_x
            r_px_y = (oH_deg / 2) / deg_per_px_y
            radius_px = (r_px_x + r_px_y) / 2.0

            # Include celestial coordinates so the web viewer could
            # display a coordinate readout in the future.
            regions[main_def["name"]].append({
                "name": other["name"],
                "target": other["name"],
                "ra": other["ra"],
                "dec": other["dec"],
                "x_px": float(x_px),
                "y_px": float(y_px),
                "radius_px": float(radius_px),
            })

    # Write the output YAML
    with open(out_file, "w") as f:
        yaml.safe_dump(regions, f, sort_keys=False)

    print(f"Wrote hotspot definitions to {out_file}")
