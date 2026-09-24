export const STRATEGIES: Array<[string, string]> = [
  ['priority', 'Strict priority order'],
  ['failover', 'Try next vendor on failure'],
  ['round_robin', 'Rotate across vendors'],
  ['least_cost', 'Cheapest vendor first'],
  ['percentage', 'Weighted distribution'],
];
export const STRATEGY_HINT: Record<string, string> = {
  priority: 'First healthy vendor in priority order wins. Use for premium vs economy chains.',
  failover: 'Same as priority, but the chain is retried hop-by-hop on submit errors.',
  round_robin: 'Rotates the starting vendor per message. Use to spread load evenly.',
  least_cost: 'Cheapest vendor with a rate on file goes first. Needs vendor rates.',
  percentage: 'Weighted random pick per message (weight = % share). Full chain kept behind the pick for failover.',
};
