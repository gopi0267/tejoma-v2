import { MultiPatternTrie } from '../../jd-parser/matcher/trie.js';
import { LOCATIONS_DICTIONARY } from '../../jd-parser/dictionaries/locations.dictionary.js';

// Reuses the exact same city dictionary/trie already built and tested for the JD parser -
// avoids maintaining two separate "known cities" lists that could drift apart.
const locationTrie = new MultiPatternTrie(LOCATIONS_DICTIONARY);

// lat/lon in decimal degrees. Covers every city in LOCATIONS_DICTIONARY plus Austin/Chicago
// (used by real existing job records and the old hardcoded distance matrix this replaces).
const CITY_COORDINATES: Record<string, { lat: number; lon: number }> = {
  Bangalore: { lat: 12.9716, lon: 77.5946 },
  Hyderabad: { lat: 17.385, lon: 78.4867 },
  Chennai: { lat: 13.0827, lon: 80.2707 },
  Mumbai: { lat: 19.076, lon: 72.8777 },
  Pune: { lat: 18.5204, lon: 73.8567 },
  Delhi: { lat: 28.7041, lon: 77.1025 },
  Gurugram: { lat: 28.4595, lon: 77.0266 },
  Noida: { lat: 28.5355, lon: 77.391 },
  Kolkata: { lat: 22.5726, lon: 88.3639 },
  Ahmedabad: { lat: 23.0225, lon: 72.5714 },
  Kochi: { lat: 9.9312, lon: 76.2673 },
  Coimbatore: { lat: 11.0168, lon: 76.9558 },
  Indore: { lat: 22.7196, lon: 75.8577 },
  Jaipur: { lat: 26.9124, lon: 75.7873 },
  Chandigarh: { lat: 30.7333, lon: 76.7794 },
  Nagpur: { lat: 21.1458, lon: 79.0882 },
  Vadodara: { lat: 22.3072, lon: 73.1812 },
  Thiruvananthapuram: { lat: 8.5241, lon: 76.9366 },
  'New York': { lat: 40.7128, lon: -74.006 },
  'San Francisco': { lat: 37.7749, lon: -122.4194 },
  London: { lat: 51.5074, lon: -0.1278 },
  Singapore: { lat: 1.3521, lon: 103.8198 },
  Dubai: { lat: 25.2048, lon: 55.2708 },
  Toronto: { lat: 43.6532, lon: -79.3832 },
  Sydney: { lat: -33.8688, lon: 151.2093 },
  Berlin: { lat: 52.52, lon: 13.405 },
  Austin: { lat: 30.2672, lon: -97.7431 },
  Chicago: { lat: 41.8781, lon: -87.6298 },
};

// Used when a location can't be geocoded at all (empty, "Remote", or genuinely unrecognized
// text like a company name accidentally stored in the location field) - a moderate distance
// rather than 0 (which would look like a false "perfect match") or a huge default (which would
// unfairly zero out the location score for a recruiter who just didn't fill in a clean city name).
const UNKNOWN_LOCATION_DISTANCE_KM = 1500;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

// Great-circle (Haversine) distance between two lat/lon points, in kilometers.
export function haversineDistanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371; // Earth radius in km
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

// Extracts the first recognizable city name from a messy location string (e.g. "Hyderabad -
// 500037", "Hyderabad, India", or a company name accidentally stored in the location field,
// which resolves to null rather than a false match).
export function extractKnownCity(rawLocation: string | null | undefined): string | null {
  if (!rawLocation) return null;
  const matches = locationTrie.findAll(rawLocation);
  return matches.length > 0 ? matches[0].entry.canonical : null;
}

export interface LocationDistanceResult {
  distanceKm: number;
  candidateCity: string | null;
  jobCity: string | null;
  isRemoteMatch: boolean;
}

// Computes a real geographic distance instead of the old 4-city hardcoded matrix. "Remote" on
// either side is still treated as a perfect match (distance irrelevant), matching prior behavior.
export function computeLocationDistance(candidateLocation: string | null | undefined, jobLocation: string | null | undefined): LocationDistanceResult {
  const candidateNorm = (candidateLocation || '').toLowerCase().trim();
  const jobNorm = (jobLocation || '').toLowerCase().trim();

  if (candidateNorm === 'remote' || jobNorm === 'remote' || candidateNorm === jobNorm) {
    return { distanceKm: 0, candidateCity: extractKnownCity(candidateLocation), jobCity: extractKnownCity(jobLocation), isRemoteMatch: true };
  }

  const candidateCity = extractKnownCity(candidateLocation);
  const jobCity = extractKnownCity(jobLocation);

  if (!candidateCity || !jobCity) {
    return { distanceKm: UNKNOWN_LOCATION_DISTANCE_KM, candidateCity, jobCity, isRemoteMatch: false };
  }
  if (candidateCity === jobCity) {
    return { distanceKm: 0, candidateCity, jobCity, isRemoteMatch: false };
  }

  const a = CITY_COORDINATES[candidateCity];
  const b = CITY_COORDINATES[jobCity];
  if (!a || !b) {
    // Recognized by the dictionary but missing coordinates - shouldn't happen since every
    // dictionary entry has a coordinate above, but fail safe rather than throw.
    return { distanceKm: UNKNOWN_LOCATION_DISTANCE_KM, candidateCity, jobCity, isRemoteMatch: false };
  }

  return { distanceKm: haversineDistanceKm(a, b), candidateCity, jobCity, isRemoteMatch: false };
}
