import { describe, it, expect } from 'vitest';
import { mapDlrStatus, parseDlrBody, can, ROLE_PERMISSIONS } from '@8xtel/core';

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
