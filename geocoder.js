/**
 * Orlando Local Geocoder
 * ----------------------
 * Converts OPD CAD block addresses like "1200 BLOCK N ORANGE AVE"
 * or intersections like "W COLONIAL DR / S ORANGE AVE" to lat/lng.
 *
 * No external API calls. No rate limits. Instant.
 *
 * Strategy:
 *   1. Parse the address into street name(s)
 *   2. Look up known street centerline coordinates
 *   3. For block addresses, offset along the street by block number
 *   4. For intersections, average the two street coords
 *   5. Add small random jitter so pins don't stack exactly
 */

// ── Street centerlines for major Orlando / Winter Park streets ────
// Each entry: [lat, lng] of the street's midpoint within Orlando.
// For N/S streets, lat varies by block; for E/W streets, lng varies.
// Format: 'NORMALIZED NAME' -> { lat, lng, axis: 'ns' | 'ew' }
//   axis 'ns' = street runs north/south  (block number shifts lat)
//   axis 'ew' = street runs east/west    (block number shifts lng)

const STREETS = {
  // ── Major N/S arterials ──────────────────────────────────────
  'ORANGE AVE':           { lat: 28.5300, lng: -81.3792, axis: 'ns' },
  'N ORANGE AVE':         { lat: 28.5600, lng: -81.3792, axis: 'ns' },
  'S ORANGE AVE':         { lat: 28.5000, lng: -81.3792, axis: 'ns' },
  'ORANGE BLOSSOM TRL':   { lat: 28.5300, lng: -81.4060, axis: 'ns' },
  'N ORANGE BLOSSOM TRL': { lat: 28.5600, lng: -81.4060, axis: 'ns' },
  'S ORANGE BLOSSOM TRL': { lat: 28.4900, lng: -81.4060, axis: 'ns' },
  'MILLS AVE':            { lat: 28.5480, lng: -81.3580, axis: 'ns' },
  'N MILLS AVE':          { lat: 28.5580, lng: -81.3580, axis: 'ns' },
  'S MILLS AVE':          { lat: 28.5280, lng: -81.3580, axis: 'ns' },
  'BUMBY AVE':            { lat: 28.5300, lng: -81.3500, axis: 'ns' },
  'S BUMBY AVE':          { lat: 28.5100, lng: -81.3500, axis: 'ns' },
  'SEMORAN BLVD':         { lat: 28.5400, lng: -81.3070, axis: 'ns' },
  'N SEMORAN BLVD':       { lat: 28.5800, lng: -81.3070, axis: 'ns' },
  'S SEMORAN BLVD':       { lat: 28.5000, lng: -81.3070, axis: 'ns' },
  'KIRKMAN RD':           { lat: 28.5200, lng: -81.4350, axis: 'ns' },
  'S KIRKMAN RD':         { lat: 28.5000, lng: -81.4350, axis: 'ns' },
  'JOHN YOUNG PKWY':      { lat: 28.5300, lng: -81.4400, axis: 'ns' },
  'N JOHN YOUNG PKWY':    { lat: 28.5600, lng: -81.4400, axis: 'ns' },
  'S JOHN YOUNG PKWY':    { lat: 28.5000, lng: -81.4400, axis: 'ns' },
  'PINE HILLS RD':        { lat: 28.5700, lng: -81.4470, axis: 'ns' },
  'N PINE HILLS RD':      { lat: 28.5900, lng: -81.4470, axis: 'ns' },
  'HIAWASSEE RD':         { lat: 28.5400, lng: -81.4700, axis: 'ns' },
  'N HIAWASSEE RD':       { lat: 28.5700, lng: -81.4700, axis: 'ns' },
  'S HIAWASSEE RD':       { lat: 28.5100, lng: -81.4700, axis: 'ns' },
  'APOPKA VINELAND RD':   { lat: 28.5700, lng: -81.4900, axis: 'ns' },
  'NARCOOSSEE RD':        { lat: 28.5200, lng: -81.2560, axis: 'ns' },
  'GOLDENROD RD':         { lat: 28.5500, lng: -81.2780, axis: 'ns' },
  'S GOLDENROD RD':       { lat: 28.5200, lng: -81.2780, axis: 'ns' },
  'ALAFAYA TRL':          { lat: 28.5700, lng: -81.2030, axis: 'ns' },
  'ECONLOCKHATCHEE TRL':  { lat: 28.5700, lng: -81.2550, axis: 'ns' },
  'ECONLOCKHATCHEE TRL N':{ lat: 28.5800, lng: -81.2550, axis: 'ns' },
  'SUMMERLIN AVE':        { lat: 28.5450, lng: -81.3600, axis: 'ns' },
  'N SUMMERLIN AVE':      { lat: 28.5650, lng: -81.3600, axis: 'ns' },
  'VIRGINIA DR':          { lat: 28.5700, lng: -81.3750, axis: 'ns' },
  'N VIRGINIA AVE':       { lat: 28.5950, lng: -81.3750, axis: 'ns' },
  'WESTMORELAND DR':      { lat: 28.5300, lng: -81.3930, axis: 'ns' },
  'S WESTMORELAND DR':    { lat: 28.5100, lng: -81.3930, axis: 'ns' },
  'PARRAMORE AVE':        { lat: 28.5300, lng: -81.3900, axis: 'ns' },
  'FORSYTH RD':           { lat: 28.6000, lng: -81.3300, axis: 'ns' },
  'UNIVERSITY BLVD':      { lat: 28.5980, lng: -81.3500, axis: 'ns' },

  // ── Major E/W arterials ──────────────────────────────────────
  'COLONIAL DR':          { lat: 28.5570, lng: -81.3800, axis: 'ew' },
  'E COLONIAL DR':        { lat: 28.5570, lng: -81.3400, axis: 'ew' },
  'W COLONIAL DR':        { lat: 28.5570, lng: -81.4200, axis: 'ew' },
  'MICHIGAN ST':          { lat: 28.5130, lng: -81.3700, axis: 'ew' },
  'W MICHIGAN ST':        { lat: 28.5130, lng: -81.3900, axis: 'ew' },
  'CENTRAL BLVD':         { lat: 28.5420, lng: -81.3792, axis: 'ew' },
  'W CENTRAL BLVD':       { lat: 28.5420, lng: -81.3900, axis: 'ew' },
  'E CENTRAL BLVD':       { lat: 28.5420, lng: -81.3600, axis: 'ew' },
  'CHURCH ST':            { lat: 28.5390, lng: -81.3792, axis: 'ew' },
  'W CHURCH ST':          { lat: 28.5390, lng: -81.3900, axis: 'ew' },
  'ROBINSON ST':          { lat: 28.5450, lng: -81.3792, axis: 'ew' },
  'W ROBINSON ST':        { lat: 28.5450, lng: -81.3900, axis: 'ew' },
  'E ROBINSON ST':        { lat: 28.5450, lng: -81.3600, axis: 'ew' },
  'LIVINGSTON ST':        { lat: 28.5530, lng: -81.3792, axis: 'ew' },
  'W LIVINGSTON ST':      { lat: 28.5530, lng: -81.3900, axis: 'ew' },
  'E LIVINGSTON ST':      { lat: 28.5530, lng: -81.3600, axis: 'ew' },
  'MARKS ST':             { lat: 28.5600, lng: -81.3792, axis: 'ew' },
  'W MARKS ST':           { lat: 28.5600, lng: -81.3900, axis: 'ew' },
  'PRINCETON ST':         { lat: 28.5660, lng: -81.3792, axis: 'ew' },
  'W PRINCETON ST':       { lat: 28.5660, lng: -81.3900, axis: 'ew' },
  'ESTHER ST':            { lat: 28.5720, lng: -81.3792, axis: 'ew' },
  'AMELIA ST':            { lat: 28.5490, lng: -81.3792, axis: 'ew' },
  'W AMELIA ST':          { lat: 28.5490, lng: -81.3900, axis: 'ew' },
  'E AMELIA ST':          { lat: 28.5490, lng: -81.3600, axis: 'ew' },
  'GORE ST':              { lat: 28.5360, lng: -81.3792, axis: 'ew' },
  'W GORE ST':            { lat: 28.5360, lng: -81.3900, axis: 'ew' },
  'KALEY AVE':            { lat: 28.5240, lng: -81.3792, axis: 'ew' },
  'W KALEY AVE':          { lat: 28.5240, lng: -81.3900, axis: 'ew' },
  'E KALEY AVE':          { lat: 28.5240, lng: -81.3600, axis: 'ew' },
  'GRANT ST':             { lat: 28.5180, lng: -81.3792, axis: 'ew' },
  'MICHIGAN AVE':         { lat: 28.5130, lng: -81.3792, axis: 'ew' },
  'ANDERSON ST':          { lat: 28.5080, lng: -81.3792, axis: 'ew' },
  'W ANDERSON ST':        { lat: 28.5080, lng: -81.3900, axis: 'ew' },
  'SAND LAKE RD':         { lat: 28.4480, lng: -81.3900, axis: 'ew' },
  'W SAND LAKE RD':       { lat: 28.4480, lng: -81.4200, axis: 'ew' },
  'E SAND LAKE RD':       { lat: 28.4480, lng: -81.3600, axis: 'ew' },
  'OAK RIDGE RD':         { lat: 28.4700, lng: -81.3900, axis: 'ew' },
  'W OAK RIDGE RD':       { lat: 28.4700, lng: -81.4200, axis: 'ew' },
  'MICHIGAN ST E':        { lat: 28.5130, lng: -81.3500, axis: 'ew' },
  'MICHIGAN ST W':        { lat: 28.5130, lng: -81.4000, axis: 'ew' },
  'FAIRBANKS AVE':        { lat: 28.5900, lng: -81.3600, axis: 'ew' },
  'W FAIRBANKS AVE':      { lat: 28.5900, lng: -81.3800, axis: 'ew' },
  'ALOMA AVE':            { lat: 28.6040, lng: -81.3300, axis: 'ew' },
  'UNIVERSITY BLVD':      { lat: 28.5980, lng: -81.3300, axis: 'ew' },
  'CURRY FORD RD':        { lat: 28.5020, lng: -81.3200, axis: 'ew' },
  'E CURRY FORD RD':      { lat: 28.5020, lng: -81.3000, axis: 'ew' },
  'W ILLIANA ST':         { lat: 28.5000, lng: -81.4000, axis: 'ew' },
  'LAKE UNDERHILL RD':    { lat: 28.5200, lng: -81.3100, axis: 'ew' },
  'HOFFNER AVE':          { lat: 28.4800, lng: -81.3400, axis: 'ew' },
  'PERSHING AVE':         { lat: 28.5780, lng: -81.3600, axis: 'ew' },

  // ── Highways / expressways ────────────────────────────────────
  'I-4':                  { lat: 28.5300, lng: -81.3900, axis: 'ew' },
  'SR-408':               { lat: 28.5100, lng: -81.3700, axis: 'ew' },
  'SR-528':               { lat: 28.4300, lng: -81.3700, axis: 'ew' },
  'SR-417':               { lat: 28.5500, lng: -81.2500, axis: 'ns' },
  'SR-434':               { lat: 28.6600, lng: -81.3500, axis: 'ew' },
  'SR-436':               { lat: 28.6200, lng: -81.3400, axis: 'ew' },
  'SR-50':                { lat: 28.5570, lng: -81.3800, axis: 'ew' }, // Colonial Dr
  'US-441':               { lat: 28.5300, lng: -81.4060, axis: 'ns' }, // OBT
  'US-17':                { lat: 28.5300, lng: -81.3400, axis: 'ns' },
  'UNIVERSAL BLVD':       { lat: 28.4750, lng: -81.4650, axis: 'ns' },
  'INTERNATIONAL DR':     { lat: 28.4600, lng: -81.4650, axis: 'ns' },
  'PALM PKWY':            { lat: 28.3980, lng: -81.4900, axis: 'ns' },
  'DARYL CARTER PKWY':    { lat: 28.3980, lng: -81.4900, axis: 'ew' },
  'LEEVISTA BLVD':        { lat: 28.5000, lng: -81.2900, axis: 'ew' },
  'SILVER STAR RD':       { lat: 28.5700, lng: -81.4400, axis: 'ew' },
  'W SILVER STAR RD':     { lat: 28.5700, lng: -81.4600, axis: 'ew' },
  'CLARCONA OCOEE RD':    { lat: 28.6140, lng: -81.4900, axis: 'ew' },
  'HANSEL AVE':           { lat: 28.4690, lng: -81.3680, axis: 'ns' },
  'MEDALLION DR':         { lat: 28.5650, lng: -81.4400, axis: 'ew' },
  'BUFORD ST':            { lat: 28.5480, lng: -81.3900, axis: 'ew' },
  'WINDHOVER DR':         { lat: 28.5520, lng: -81.4350, axis: 'ew' },
  'W D JUDGE DR':         { lat: 28.5500, lng: -81.4550, axis: 'ew' },
  'JEFF FUQUA BLVD':      { lat: 28.4290, lng: -81.3190, axis: 'ew' },
  'JEFF FUQUA BLVD N':    { lat: 28.4390, lng: -81.3190, axis: 'ew' },

  // ── Winter Park ───────────────────────────────────────────────
  'PARK AVE':             { lat: 28.5990, lng: -81.3490, axis: 'ns' },
  'N PARK AVE':           { lat: 28.6100, lng: -81.3490, axis: 'ns' },
  'S PARK AVE':           { lat: 28.5900, lng: -81.3490, axis: 'ns' },
  'LAKEMONT AVE':         { lat: 28.5900, lng: -81.3190, axis: 'ns' },
  'HOWELL BRANCH RD':     { lat: 28.6200, lng: -81.3000, axis: 'ew' },
  'PALMER AVE':           { lat: 28.6050, lng: -81.3550, axis: 'ew' },
  'MORSE BLVD':           { lat: 28.6010, lng: -81.3550, axis: 'ew' },
  'NEW ENGLAND AVE':      { lat: 28.5950, lng: -81.3550, axis: 'ew' },
  'CANTON AVE':           { lat: 28.5980, lng: -81.3650, axis: 'ew' },
  'W CANTON AVE':         { lat: 28.5980, lng: -81.3750, axis: 'ew' },
  'INTERLACHEN AVE':      { lat: 28.6050, lng: -81.3650, axis: 'ns' },
  'ORANGE AVE WP':        { lat: 28.6000, lng: -81.3600, axis: 'ns' },
};

// ── District fallbacks ────────────────────────────────────────────
// OPD CAD includes a district code. If we can't parse the address
// at all, drop a pin in the district's approximate center.
const DISTRICT_CENTERS = {
  'A': { lat: 28.5800, lng: -81.4300 }, // Northwest
  'B': { lat: 28.5700, lng: -81.4500 }, // West
  'C': { lat: 28.5500, lng: -81.3600 }, // Central/East
  'D': { lat: 28.5400, lng: -81.3800 }, // Downtown
  'E': { lat: 28.5200, lng: -81.4300 }, // Southwest
  'G': { lat: 28.4900, lng: -81.3400 }, // South
  'K': { lat: 28.5100, lng: -81.2800 }, // East
  '8': { lat: 28.5383, lng: -81.3792 }, // Central fallback
  '9': { lat: 28.5383, lng: -81.3792 },
};

const ORLANDO_CENTER = { lat: 28.5383, lng: -81.3792 };

// ── Normalize a street name for lookup ────────────────────────────
function normalize(str) {
  return str
    .toUpperCase()
    .replace(/\bSTREET\b/g,   'ST')
    .replace(/\bAVENUE\b/g,   'AVE')
    .replace(/\bBOULEVARD\b/g,'BLVD')
    .replace(/\bDRIVE\b/g,    'DR')
    .replace(/\bROAD\b/g,     'RD')
    .replace(/\bPARKWAY\b/g,  'PKWY')
    .replace(/\bTRAIL\b/g,    'TRL')
    .replace(/\bTRAIL\b/g,    'TRL')
    .replace(/\bCOURT\b/g,    'CT')
    .replace(/\bLANE\b/g,     'LN')
    .replace(/\bCIRCLE\b/g,   'CIR')
    .replace(/\bPLACE\b/g,    'PL')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Offset lat/lng by block number along the street's axis ───────
// Orlando's grid: ~0.009 degrees per city block (~1000 ft)
const DEG_PER_BLOCK = 0.009;

function offsetByBlock(base, blockNum, axis) {
  if (!blockNum || !base) return base;
  // Block numbers like 1200 = 12 blocks from origin
  const blocks = blockNum / 100;
  const delta  = blocks * DEG_PER_BLOCK * 0.1; // scaled down — streets don't start at 0
  if (axis === 'ns') {
    // Higher block = further north
    return { lat: base.lat + (delta * 0.3), lng: base.lng };
  } else {
    // Higher block = further east
    return { lat: base.lat, lng: base.lng + (delta * 0.3) };
  }
}

// ── Small jitter so identical addresses don't stack exactly ───────
function jitter(coord) {
  return {
    lat: coord.lat + (Math.random() - 0.5) * 0.002,
    lng: coord.lng + (Math.random() - 0.5) * 0.002,
  };
}

// ── Find the best matching street in our table ────────────────────
function findStreet(name) {
  const n = normalize(name);
  // Exact match first
  if (STREETS[n]) return STREETS[n];
  // Partial match — find street whose key is contained in the name
  for (const [key, val] of Object.entries(STREETS)) {
    if (n.includes(key) || key.includes(n)) return val;
  }
  return null;
}

// ── Main export: geocode(address, district) -> { lat, lng } ───────
function geocode(rawAddress, district) {
  if (!rawAddress || rawAddress === 'Restricted Address') {
    return districtFallback(district);
  }

  const addr = normalize(rawAddress);

  // ── Case 1: Intersection  (contains " / " or " X ")
  const intersectionMatch = addr.match(/^(.+?)\s*[\/X]\s*(.+)$/);
  if (intersectionMatch) {
    const street1 = findStreet(intersectionMatch[1].trim());
    const street2 = findStreet(intersectionMatch[2].trim());
    if (street1 && street2) {
      // Average the two streets' positions
      return jitter({
        lat: (street1.lat + street2.lat) / 2,
        lng: (street1.lng + street2.lng) / 2,
      });
    }
    if (street1) return jitter(street1);
    if (street2) return jitter(street2);
  }

  // ── Case 2: Block address  ("1200 BLOCK N ORANGE AVE" or "1200 N ORANGE AVE")
  const blockMatch = addr.match(/^(\d+)\s+(?:BLOCK\s+)?(.+)$/);
  if (blockMatch) {
    const blockNum   = parseInt(blockMatch[1], 10);
    const streetName = blockMatch[2].trim();
    const street     = findStreet(streetName);
    if (street) {
      return jitter(offsetByBlock(street, blockNum, street.axis));
    }
  }

  // ── Case 3: Just a street name
  const street = findStreet(addr);
  if (street) return jitter(street);

  // ── Case 4: District fallback
  return districtFallback(district);
}

function districtFallback(district) {
  if (district) {
    const key = district.charAt(0).toUpperCase();
    if (DISTRICT_CENTERS[key]) return jitter(DISTRICT_CENTERS[key]);
  }
  return jitter(ORLANDO_CENTER);
}

module.exports = { geocode };
