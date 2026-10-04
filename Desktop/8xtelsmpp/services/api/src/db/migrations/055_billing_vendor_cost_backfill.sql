-- 055_billing_vendor_cost_backfill — fix vendor_cost=0 rows from before fixes
-- Old traffic had vendor_cost=0 due to routing not persisting it + billing not
-- computing it for delivery-component charges. Backfill non-destructively.

-- 1) billing_records where vendor_cost=0 but we know the cost from the route/messages
UPDATE billing_records br
SET vendor_cost = sub.cost
FROM (
  SELECT br2.message_id,
         COALESCE(
           (SELECT cost FROM vendor_rates vr WHERE vr.vendor_id=br2.vendor_id
              AND ( (SELECT m.destination FROM messages m WHERE m.id=br2.message_id) LIKE COALESCE(vr.prefix,'') || '%'
                 OR vr.country_id = (SELECT m2.country_id FROM messages m2 WHERE m2.id=br2.message_id))
            ORDER BY length(COALESCE(vr.prefix,'')) DESC LIMIT 1),
           (SELECT m3.vendor_cost FROM messages m3 WHERE m3.id=br2.message_id AND m3.vendor_cost IS NOT NULL AND m3.vendor_cost > 0),
           (SELECT r.internal_vendor_cost * COALESCE((SELECT m4.segments FROM messages m4 WHERE m4.id=br2.message_id),1)
              FROM messages m5 JOIN routes r ON r.id=m5.route_id WHERE m5.id=br2.message_id AND r.internal_vendor_cost IS NOT NULL)
         ) AS cost
  FROM billing_records br2 WHERE br2.vendor_cost = 0
) sub
WHERE br.message_id = sub.message_id AND sub.cost IS NOT NULL AND sub.cost > 0;

-- 2) messages where vendor_cost IS NULL/0 but route has a cost
UPDATE messages m
SET vendor_cost = r.internal_vendor_cost * COALESCE(m.segments,1)
FROM routes r
WHERE m.route_id = r.id
  AND (m.vendor_cost IS NULL OR m.vendor_cost = 0)
  AND r.internal_vendor_cost IS NOT NULL AND r.internal_vendor_cost > 0;
