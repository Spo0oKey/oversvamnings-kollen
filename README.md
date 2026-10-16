# Översvämnings Kollen

Interactive map that shows how exposed a Swedish address is to coastal flooding and high levels in Lake Vänern, built on MSB's national flood mapping.

* `flood_check_site/` is the website, with the build tools (`tools/`) and the prebuilt tile packs (`data/`). See [flood_check_site/README.md](flood_check_site/README.md) for how to run and publish it.
* `Claude outputs/` holds example screenshots.

## Source data (not in the repository)

The raw geodatabases the packs were built from are not included, because they total about 8.9 GB and many files exceed GitHub's 100 MB limit. To rebuild the packs, put them in `gis_country_coast/` next to `flood_check_site/`:

* `kustoversvamning_riks.gdb`: MSB/MCF national coastal flood mapping
* `oversvamningskartering_vanern.gdb`: MSB/MCF flood mapping for Lake Vänern

Both can be downloaded from MCF's Översvämningsportal.
