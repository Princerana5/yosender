export const CLIENT_ROUTE_RATE_LATERAL_JOIN = `LEFT JOIN LATERAL (
  SELECT rcr.price_per_segment, rcr.currency
  FROM route_client_rates rcr
  WHERE rcr.route_id=r.id
    AND rcr.client_id=$1::uuid
    AND (rcr.country_id IS NULL OR rcr.country_id=r.country_id)
    -- Route detail has no MCC/MNC context; only use route-wide rates.
    AND rcr.mcc IS NULL AND rcr.mnc IS NULL
  ORDER BY (rcr.country_id IS NOT NULL) DESC,
           rcr.effective_from DESC, rcr.id DESC
  LIMIT 1
) rcr ON true`;
