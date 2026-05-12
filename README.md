# Orlando Incident Map

A real-time incident map for Sanford, FL / Seminole County.

## Stack
- **Frontend**: Leaflet.js + vanilla JS (in `public/index.html`)
- **Backend**: Node.js + Express (`server.js`)

## Quick start

```bash
npm install
npm start
```

Then open **http://localhost:3000** in your browser.

For auto-reload during development:
```bash
npm run dev
```

## Data sources

| Endpoint      | Source                        | Refresh     | Status        |
|---------------|-------------------------------|-------------|---------------|
| `/api/weather`| NWS api.weather.gov           | 10 min      | ✅ Live        |
| `/api/traffic`| FL511 / FDOT SunGuide         | 3 min       | ✅ Live (near real-time) |
| `/api/crime`  | Sanford PD / Seminole Sheriff | —           | 🔧 Sample data |
| `/api/fire`   | Seminole County Fire Dept     | —           | 🔧 Sample data |
| `/api/road`   | FDOT District 5               | —           | 🔧 Sample data |
| `/api/all`    | All of the above combined     | —           | Aggregated    |

## Wiring up real crime data

1. **CrimeMapping.com** — Sanford PD is on it. Create a free account at
   crimemapping.com and use their data export or embed API.

2. **Seminole County Sheriff** — public incident search at:
   https://www.seminolecountyfl.gov/departments-services/public-safety/sheriff
   No public API, but you can scrape the HTML table with `cheerio`.

   ```bash
   npm install cheerio
   ```

   Then in `server.js` replace the `/api/crime` sample with a fetch + parse.

## Wiring up real road closure data

FDOT publishes a public XML feed. Replace the `/api/road` sample in `server.js`:

```js
const r = await fetch('https://www.fdot.gov/traffic/closures/export.xml');
const xml = await r.text();
const data = await xml2js.parseStringPromise(xml, { explicitArray: false });
// parse data.closures.closure[] into your incident format
```

## Deploying

Any Node host works — Railway, Render, Fly.io, or a plain VPS.

```bash
# Render / Railway — just push to GitHub and connect the repo
# The start command is: node server.js
```

Make sure to set `PORT` as an environment variable if the host requires it —
the server already reads `process.env.PORT || 3000`.
