# Data

`locations.json` is the portable data snapshot for the website. The browser reads its runtime equivalent from `assets/js/data.js`.

## Update workflow

1. Update `assets/js/data.js`.
2. Keep all coordinates inside the configured North District / Kwu Tung scope in `assets/js/app.js`.
3. Re-export the same records and category metadata to `data/locations.json`.
4. Update `dataAsOf` and each changed record's `dataDate`.
5. Check every published location still has a traceable source.

`locations.json` is a static public-data snapshot. It is not an official real-time directory, and unknown fields must remain unknown rather than being inferred.
