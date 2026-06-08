# explore-euclid-imaging

Interactive deep-zoom viewer for ESA Euclid survey imagery, built with [OpenSeadragon](https://openseadragon.github.io/).

Explore giant astronomical images with smooth pan/zoom, click through to higher-resolution regions of interest, and save a "home view" to auto-return after 30s of inactivity.

## Usage

Serve the directory with any HTTP server:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Credits

- ESA/Euclid Consortium for the imagery
- University of Sussex
- The Royal Society
- [OpenSeadragon](https://openseadragon.github.io/) for the deep-zoom engine
