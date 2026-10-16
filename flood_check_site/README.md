# Kustöversvämnings Kollen

An interactive map that checks how exposed a Swedish address is to **coastal flooding** and to **high levels in Lake Vänern**. It is built on MSB's national flood mapping.

## Run it locally

1. Install Python 3 if you don't already have it.
2. Double-click **`start_server.bat`**, or run `py start_server.py` in this folder (`python start_server.py` also works if `python` is set up on your computer).
3. Your browser opens at http://localhost:8000.

Opening `index.html` directly (file://) does **not** work, because the page has to fetch its data files from a web server. The map, basemaps and address search also need an internet connection.

If you update `app.js`, `style.css`, `i18n.js` or `refdata.js`, change the `?v=` number after their names in `index.html` so browsers load the new versions.

## Publish it online

The site is fully static, so any static host works. The host has to support HTTP Range requests, which GitHub Pages, Netlify, Cloudflare Pages and most web servers do.

* **GitHub Pages:** push this folder to a repository, then turn on Pages under *Settings → Pages*. Every file is under GitHub's 100 MB limit, and the whole site is about 95 MB.
* **Netlify:** drag the folder onto app.netlify.com/drop.

If a server ignores Range, the page still works, but it downloads a whole 19 MB pack the first time it needs data from it.

## What it does

* **Swedish and English:** the site is in Swedish by default. The SV / EN switch changes all texts and number formats (2,8 m or 2.8 m), and the browser remembers the choice. All texts are in `i18n.js`.
* **Address first:** the site opens with one question, "Når havet ditt hus?", and an address box over a blurred map. Every visit starts there, including visits from old links. After a search the map opens at street level on the address. You can zoom out two steps and pan within that area, but no further; to look somewhere else, search for a new address.
* **It tells the story by itself:** after a search, the water starts rising on its own. It pauses at each important level, and a caption appears for each one in turn: the record storm near you, the level where the water reaches your address (the house marker pulses), and the top of the mapping. Each pause also shows how much of the map area is under water. At the end the water settles at your address's level and the answer appears. The captions and the answer are shown in a speech-bubble box attached to the house. While the story plays, everything not needed for it (the top bar, map controls, legend, station pointer and hints) fades away. At the end the last caption fades out, the water eases back down to the address level, the answer grows out of the house, and the controls fade back in. Then the gauge flashes white a few times to show that you can use it, and a round handle on the water surface marks where to drag. "Hoppa över" skips the story, and the play button runs it again.
* **One answer at a time:** the box on the house gives the risk level and a single headline, for example "Översvämmas om havet stiger 2,8 m". Under the headline, one line follows the water level: whether the address is dry, or how deep the water is there. Everything else sits behind "Varför det här resultatet?".
* **The tide gauge (vattenståndsskala):** a gauge on the right controls the water level. You can drag it, use the arrow keys, or press play to watch the sea (or Lake Vänern) rise in 10 cm steps while the map fills with water, shaded by depth. Flags on the gauge mark the address, the record storm at the nearest SMHI station, and (for Vänern) the 100-year and highest planning levels. Clicking a flag jumps the water to that level.
* **Things on the map you can tap:**
  * **The house:** tap it to open or close its answer box. The house turns red when the water gets there.
  * **Moving the house:** the address search sometimes puts the house on the street rather than on the building. After the story you can drag the house up to 150 m from the found address. The answer, the gauge flag and the water line then follow the new spot, and the box says "flyttad av dig". "Flytta tillbaka huset till adressen" in the box undoes it. The house cannot be moved while the story plays or while you are visiting the station.
  * **The SMHI gauge station and its record:** the answer box on the house has a row for the highest sea level recorded at the nearest SMHI station ("Högsta uppmätta havsnivå +1,54 m · Skanör · 3 km bort"). Its arrow points from the address towards the station. The level is also on the station itself ("+1,54 m") and on the gauge's "Rekord" flag. After the story, the row, the station and the flag flash white a few times. Tapping the row or the station flies the map smoothly to the station, where a box shows its record storm level. "Tillbaka till din adress" flies back and locks the view on the address again; "Visa den här nivån vid din adress" does the same and sets the water to the record level. On computers the house sits a little below the middle of the map so the answer box fits above it.
* **Drawers:** "?" explains the map and lists sources and caveats. The settings icon holds the background map (OpenStreetMap or aerial photo; with the aerial photo the closest zoom is one step less, since the photos run out at the 10 m scale, and the map zooms out by itself if needed), the colour style and opacity, and, folded away, all 70 MSB layers one by one.
* **Sharp, smooth rendering:** the flood layer is redrawn at screen resolution after every pan or zoom, so it stays crisp at every zoom level. Edges are smoothed by blending the surrounding 4 × 4 grid cells, which avoids 5 m blocks. The smoothing is only for display; the lookups use the exact cells.
* **Previous design:** the files for the previous design are kept in `previous_version/`. To go back, copy them over the files in the main folder.

### Exposure classes

These are indicative and were chosen for this tool.

| Class | Coast: floods at sea level… | Vänern: ground level… |
|---|---|---|
| Very high | ≤ +1.0 m | ≤ 44.8 m (near mean level 44.58 m) |
| High | up to +1.5 m, or up to the nearest gauge's record if that is higher | below the local 100-year level |
| Moderate | ≤ +3.0 m | below the highest calculated level |
| Low | +3.1 to +5.0 m | up to 48.0 m |
| Very low | not flooded at +5 m, and no land within 100 m is | not in the mapping |

If the point itself is dry but land within 25–100 m floods, the class is lowered by one step and the text says so.

## Data and processing

Source: MSB, *kustoversvamning_riks.gdb* (layers kust_1 to kust_50) and *oversvamningskartering_vanern.gdb* (layers nh_1 to nh_20). Published under MSB's open licence; attribution "© MSB".

* `kust_n` is the area below **+n × 0.1 m**, including the sea itself. The layers are cumulative, and the reference level is the height system of the elevation model used (RH 2000).
* `nh_n` covers Lake Vänern ground-level classes from "< 44.5 m" up to "47.8–48.0 m" (RH 2000).

All 70 polygon layers (9.5 GB) were rasterised to a **5 m grid in SWEREF 99 TM**. Each cell stores the lowest layer that covers it: 1–50 for the coast, 101–120 for Vänern, and 255 where nothing is mapped. The grid is cut into 512 × 512-cell tiles, compressed with zlib, and bundled into `data/pack*.bin`. `data/meta.json` holds the byte offset of every tile. Uniform tiles, such as open sea, are stored as a single value. A 50 m overview is used at low zoom levels.

Checks: the rasterised area matches the source `Shape_Area` to within 0.01 % for every level checked. Point-in-polygon tests against the original polygons agree with the grid.

Note: layers kust_1 to kust_4 were produced separately from kust_5 and up, and they are not perfectly nested (kust_4 covers slightly more area than kust_5). The grid always uses the lowest level that covers a cell.

`tools/` holds the Python scripts used for the conversion. They include a small FileGDB reader, so GDAL is not needed. The file paths inside them point at the build environment and need editing before reuse.

## Limitations

This is a screening tool, **not** a formal flood risk assessment.

* It is a "bathtub" model based on ground elevation. It ignores flood defences, drainage, waves, wind set-up and whether a low area is actually connected to the sea.
* It covers only the sea and Lake Vänern. It does not cover rivers, other lakes or cloudbursts; see MSB's *Översvämningsportalen* for those.
* Lake Mälaren and other lakes that lie just above sea level show up as "flooding" at their own water level.
* SMHI gauge records are relative to mean sea level, while the map uses RH 2000. The two can differ by a few decimetres depending on location and year.
* Geocoded addresses can land on the street rather than the building. The 25 m and 100 m neighbourhood figures help with this.

## Credits

Flood data © MSB · Sea-level records: SMHI · Vänern planning levels: Länsstyrelserna (2017) · Map data © OpenStreetMap contributors, Esri imagery · Built with Leaflet. Icon: `favicon.svg`, with PNG versions for older browsers and home screens.
