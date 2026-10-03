export const REMOVE_ROUTE_CLIENT_RATES_SQL =
  'DELETE FROM route_client_rates WHERE route_id=$1 AND client_id=$2';

export const CLEAR_ROUTE_CLIENT_EXCLUSION_SQL =
  'DELETE FROM route_client_exclusions WHERE route_id=$1 AND client_id=$2';

export const EXCLUDE_ROUTE_CLIENT_SQL =
  'INSERT INTO route_client_exclusions (route_id, client_id) VALUES ($1,$2) ON CONFLICT DO NOTHING';

export function shouldExcludeAfterMemberRemoval(memberCount: number): boolean {
  return memberCount === 0;
}
