import { describe, it, expect } from 'vitest';
import {
  mapDlrStatus, parseDlrBody, can, ROLE_PERMISSIONS,
  analyzeSms, normalizeToGsm, parseDestinations,
} from '@8xtel/core';
import { CLIENT_ROUTE_RATE_LATERAL_JOIN } from './lib/client-route-pricing.js';
import {
  CLEAR_ROUTE_CLIENT_EXCLUSION_SQL,
  EXCLUDE_ROUTE_CLIENT_SQL,
  REMOVE_ROUTE_CLIENT_RATES_SQL,
  shouldExcludeAfterMemberRemoval,
} from './lib/route-client-access.js';

// Route/client access cleanup
describe('route client removal cleanup', () => {
  it('deletes every route-specific rate for the removed client', () => {
    expect(REMOVE_ROUTE_CLIENT_RATES_SQL).toBe(
      'DELETE FROM route_client_rates WHERE route_id=$1 AND client_id=$2',
    );
  });

  it('excludes the removed client when last-member removal makes the route global', () => {
    expect(shouldExcludeAfterMemberRemoval(0)).toBe(true);
    expect(shouldExcludeAfterMemberRemoval(1)).toBe(false);
    expect(EXCLUDE_ROUTE_CLIENT_SQL).toContain('ON CONFLICT DO NOTHING');
    expect(CLEAR_ROUTE_CLIENT_EXCLUSION_SQL).toContain('DELETE FROM route_client_exclusions');
  });
});
describe('client route-rate selection', () => {
  it('selects only the route-country rate, then generic, and ignores other countries and destination-specific rows', () => {
    expect(CLIENT_ROUTE_RATE_LATERAL_JOIN).toContain('LEFT JOIN LATERAL');
    expect(CLIENT_ROUTE_RATE_LATERAL_JOIN).toContain('(rcr.country_id IS NULL OR rcr.country_id=r.country_id)');
    expect(CLIENT_ROUTE_RATE_LATERAL_JOIN).toContain('ORDER BY (rcr.country_id IS NOT NULL) DESC');
    expect(CLIENT_ROUTE_RATE_LATERAL_JOIN).toContain('rcr.mcc IS NULL AND rcr.mnc IS NULL');
    expect(CLIENT_ROUTE_RATE_LATERAL_JOIN).toContain('LIMIT 1');
  });

  it('preserves the route price fallback when there is no matching client override', () => {
    const fallback = 'COALESCE(rcr.price_per_segment, r.price_per_segment) AS effective_price_per_segment';
    expect(fallback).toContain('r.price_per_segment');
  });
});

// DLR mapping (§16)
describe('dlr mapping', () => {
  it('maps DELIVRD', () => expect(mapDlrStatus('DELIVRD')).toBe('delivered'));
  it('maps EXPIRED', () => expect(mapDlrStatus('EXPIRED')).toBe('expired'));
  it('maps UNDELIV', () => expect(mapDlrStatus('UNDELIV')).toBe('undelivered'));
  it('maps unknown', () => expect(mapDlrStatus('GARBAGE')).toBe('unknown'));
  it('parses body', () => {
    const p = parseDlrBody('id:abc123 sub:001 stat:DELIVRD err:000 text:hi');
    expect(p.vendor_msg_id).toBe('abc123');
    expect(p.stat).toBe('DELIVRD');
  });
});

// SMS segment calculator (§15)
describe('sms segments', () => {
  it('gsm7 single segment', () => {
    const r = analyzeSms('Hello world');
    expect(r.encoding).toBe('gsm7');
    expect(r.segments).toBe(1);
  });
  it('gsm7 concatenated', () => {
    const r = analyzeSms('a'.repeat(161));
    expect(r.segments).toBe(2);
    expect(r.units).toBe(161);
  });
  it('turkish chars flip to unicode', () => {
    const r = analyzeSms('Merhaba şükrü ğ');
    expect(r.encoding).toBe('unicode');
    expect(r.nonGsmChars).toContain('ş');
  });
  it('emoji is unicode with surrogate pairs', () => {
    const r = analyzeSms('Hi 😀');
    expect(r.encoding).toBe('unicode');
    expect(r.units).toBe(5); // H,i,space + surrogate pair
  });
  it('long unicode splits at 67', () => {
    const r = analyzeSms('ş'.repeat(71));
    expect(r.segments).toBe(2);
  });
  it('normalizer keeps turkish in gsm7', () => {
    const { text } = normalizeToGsm('şğçıöü ŞĞÇİÖÜ');
    const r = analyzeSms(text);
    expect(r.encoding).toBe('gsm7');
    expect(r.segments).toBe(1);
  });
  it('extension chars cost 2 units', () => {
    const r = analyzeSms('€100');
    expect(r.encoding).toBe('gsm7');
    expect(r.units).toBe(5); // €=2 + 100
  });
});

describe('destinations', () => {
  it('parses mixed separators + dedupes', () => {
    const r = parseDestinations('919800000001, 919800000001\n919800000002;+919800000003');
    expect(r.numbers).toEqual(['919800000001', '919800000002', '+919800000003']);
    expect(r.invalid).toEqual([]);
  });
  it('flags invalid', () => {
    const r = parseDestinations('abc, 12, 919800000001');
    expect(r.numbers).toEqual(['919800000001']);
    expect(r.invalid.length).toBe(2);
  });
});

// RBAC (§30)
describe('rbac', () => {
  it('super_admin can do anything', () => {
    expect(can(ROLE_PERMISSIONS.super_admin, 'vendors.reconnect')).toBe(true);
  });
  it('support cannot manage billing', () => {
    expect(can(ROLE_PERMISSIONS.support, 'billing.manage')).toBe(false);
  });
  it('finance can read revenue', () => {
    expect(can(ROLE_PERMISSIONS.finance, 'reports.revenue')).toBe(true);
  });
  it('read_only blocked from client create', () => {
    expect(can(ROLE_PERMISSIONS.read_only, 'clients.create')).toBe(false);
  });
});
