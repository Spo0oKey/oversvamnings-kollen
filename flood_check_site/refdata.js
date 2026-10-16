// Reference data used to put a location's flood threshold in context.

// SMHI record high sea levels (cm relative to mean sea level) per station.
// Source: SMHI, "Rekord: Vattenstånd". Coordinates are approximate station positions.
window.SMHI_STATIONS = [
  { name: 'Kalix Storön', lat: 65.697, lon: 23.096, max: 177, date: '1984-01-14' },
  { name: 'Furuögrund', lat: 64.916, lon: 21.231, max: 148, date: '1984-01-14' },
  { name: 'Ratan', lat: 64.000, lon: 20.895, max: 142, date: '2002-02-23' },
  { name: 'Skagsudde', lat: 63.191, lon: 19.012, max: 131, date: '2002-02-22' },
  { name: 'Spikarna', lat: 62.363, lon: 17.531, max: 127, date: '1984-01-14' },
  { name: 'Björn', lat: 60.633, lon: 17.971, max: 137, date: '1914-01-09' },
  { name: 'Forsmark', lat: 60.408, lon: 18.211, max: 143, date: '2007-01-14' },
  { name: 'Stockholm', lat: 59.324, lon: 18.082, max: 117, date: '1983-01-18' },
  { name: 'Marviken', lat: 58.554, lon: 16.837, max: 95, date: '1983-01-18' },
  { name: 'Visby', lat: 57.639, lon: 18.285, max: 90, date: '1917-12-03' },
  { name: 'Ölands norra udde', lat: 57.366, lon: 17.097, max: 136, date: '1914-01-09' },
  { name: 'Oskarshamn', lat: 57.275, lon: 16.478, max: 115, date: '2017-01-04' },
  { name: 'Kungsholmsfort', lat: 56.105, lon: 15.589, max: 133, date: '1914-01-09' },
  { name: 'Simrishamn', lat: 55.557, lon: 14.358, max: 126, date: '2023-10-21' },
  { name: 'Ystad', lat: 55.423, lon: 13.826, max: 167, date: '1904-12-31' },
  { name: 'Skanör', lat: 55.417, lon: 12.829, max: 154, date: '2017-01-04' },
  { name: 'Klagshamn', lat: 55.522, lon: 12.894, max: 146, date: '2017-01-04' },
  { name: 'Barsebäck', lat: 55.756, lon: 12.904, max: 159, date: '2013-12-06' },
  { name: 'Viken', lat: 56.142, lon: 12.579, max: 168, date: '2013-12-06' },
  { name: 'Halmstad', lat: 56.655, lon: 12.847, max: 235, date: '2015-11-29' },
  { name: 'Varberg', lat: 57.106, lon: 12.216, max: 147, date: '1921-12-17' },
  { name: 'Ringhals', lat: 57.250, lon: 12.112, max: 165, date: '2005-01-08' },
  { name: 'Göteborg-Torshamnen', lat: 57.685, lon: 11.791, max: 150, date: '1985-11-06' },
  { name: 'Stenungsund', lat: 58.093, lon: 11.833, max: 157, date: '1981-11-24' },
  { name: 'Uddevalla', lat: 58.349, lon: 11.911, max: 163, date: '2016-12-26' },
  { name: 'Smögen', lat: 58.354, lon: 11.218, max: 150, date: '1920-11-16' },
  { name: 'Kungsvik', lat: 59.000, lon: 11.127, max: 147, date: '1987-10-16' },
];

// Lake Vänern planning levels (m, RH 2000) per municipality.
// Source: Länsstyrelsen, "Faktablad – planeringsnivåer Vänern" (2017). Levels include
// climate scenario RCP 8.5 for 2069–2098 and wind set-up. Mean level 44.58 m.
window.VANERN_LEVELS = [
  { name: 'Vänersborg', lat: 58.380, lon: 12.323, y100: 47.02, y200: 47.22, max: 47.81 },
  { name: 'Mellerud', lat: 58.700, lon: 12.452, y100: 46.45, y200: 46.65, max: 47.24 },
  { name: 'Åmål', lat: 59.051, lon: 12.703, y100: 46.34, y200: 46.54, max: 47.13 },
  { name: 'Säffle', lat: 59.133, lon: 12.929, y100: 46.25, y200: 46.45, max: 47.04 },
  { name: 'Grums', lat: 59.352, lon: 13.110, y100: 46.22, y200: 46.41, max: 47.01 },
  { name: 'Hammarö', lat: 59.333, lon: 13.520, y100: 46.21, y200: 46.41, max: 47.00 },
  { name: 'Karlstad', lat: 59.380, lon: 13.504, y100: 46.28, y200: 46.48, max: 47.07 },
  { name: 'Kristinehamn', lat: 59.310, lon: 14.108, y100: 46.51, y200: 46.71, max: 47.30 },
  { name: 'Gullspång', lat: 58.985, lon: 14.096, y100: 46.40, y200: 46.60, max: 47.19 },
  { name: 'Mariestad', lat: 58.709, lon: 13.823, y100: 46.65, y200: 46.85, max: 47.44 },
  { name: 'Lidköping', lat: 58.505, lon: 13.157, y100: 46.46, y200: 46.66, max: 47.25 },
];
window.VANERN_MEAN = 44.58;

// Vänern classes (nh_1 … nh_20) → [lower, upper] ground level in m RH 2000.
window.VANERN_CLASSES = [
  [null, 44.5], [44.5, 44.6], [44.6, 44.7], [44.7, 44.8], [44.8, 45.0],
  [45.0, 45.2], [45.2, 45.4], [45.4, 45.6], [45.6, 45.8], [45.8, 46.0],
  [46.0, 46.2], [46.2, 46.4], [46.4, 46.6], [46.6, 46.8], [46.8, 47.0],
  [47.0, 47.2], [47.2, 47.4], [47.4, 47.6], [47.6, 47.8], [47.8, 48.0],
];
