import { describe, it, expect } from 'vitest';
import { haversineDistanceKm, extractKnownCity, computeLocationDistance } from '../../src/matching/similarity/locationDistance.js';

describe('haversineDistanceKm', () => {
  it('returns 0 for identical coordinates', () => {
    expect(haversineDistanceKm({ lat: 17.385, lon: 78.4867 }, { lat: 17.385, lon: 78.4867 })).toBe(0);
  });

  it('computes a realistic distance between Hyderabad and Bangalore (~500km)', () => {
    const d = haversineDistanceKm({ lat: 17.385, lon: 78.4867 }, { lat: 12.9716, lon: 77.5946 });
    expect(d).toBeGreaterThan(450);
    expect(d).toBeLessThan(600);
  });

  it('computes a realistic distance between New York and San Francisco (~4100km)', () => {
    const d = haversineDistanceKm({ lat: 40.7128, lon: -74.006 }, { lat: 37.7749, lon: -122.4194 });
    expect(d).toBeGreaterThan(4000);
    expect(d).toBeLessThan(4200);
  });
});

describe('extractKnownCity', () => {
  it('extracts a clean city name directly', () => {
    expect(extractKnownCity('Hyderabad')).toBe('Hyderabad');
  });

  it('extracts a city from messy text with a postal code', () => {
    expect(extractKnownCity('Hyderabad - 500037')).toBe('Hyderabad');
  });

  it('extracts a city from a comma-separated country suffix', () => {
    expect(extractKnownCity('Hyderabad, India')).toBe('Hyderabad');
  });

  it('normalizes an alternate spelling to the canonical name', () => {
    expect(extractKnownCity('Bengaluru')).toBe('Bangalore');
    expect(extractKnownCity('Gurgaon')).toBe('Gurugram');
  });

  it('returns null for a company name accidentally stored as location', () => {
    expect(extractKnownCity('IInfocomm It Services PVt LTd')).toBeNull();
  });

  it('returns null for empty/missing input', () => {
    expect(extractKnownCity('')).toBeNull();
    expect(extractKnownCity(null)).toBeNull();
    expect(extractKnownCity(undefined)).toBeNull();
  });
});

describe('computeLocationDistance', () => {
  it('treats "Remote" on either side as a perfect match regardless of the other location', () => {
    const result = computeLocationDistance('Remote', 'Hyderabad');
    expect(result.distanceKm).toBe(0);
    expect(result.isRemoteMatch).toBe(true);
  });

  it('returns 0 distance for the same city', () => {
    const result = computeLocationDistance('Hyderabad', 'Hyderabad, India');
    expect(result.distanceKm).toBe(0);
  });

  it('computes a real distance between two different known cities (was: hardcoded 4-city matrix)', () => {
    const result = computeLocationDistance('Austin, TX', 'San Francisco, CA');
    expect(result.distanceKm).toBeGreaterThan(2000);
    expect(result.distanceKm).toBeLessThan(2800);
    expect(result.candidateCity).toBe('Austin');
    expect(result.jobCity).toBe('San Francisco');
  });

  it('falls back to a moderate default distance when a location cannot be geocoded', () => {
    const result = computeLocationDistance('Nspira', 'Hyderabad');
    expect(result.distanceKm).toBeGreaterThan(0);
    expect(result.candidateCity).toBeNull();
  });
});
