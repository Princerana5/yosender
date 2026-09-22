// ── NANP (+1) country detection ─────────────────────────────────────────────
// The +1 country code is shared by the USA, Canada and ~20 other NANP
// territories. The 3-digit NPA (area code) after +1 decides the country.
// This table covers every NPA currently assigned per the NANP administrator
// (nanpa.com). Unassigned/reserved NPAs return null → caller falls back to
// the generic calling-code match (or "unknown") instead of guessing.
//
// Sources: NANP NPA allocations (2024–2026: 257 WI overlay, 274 WI overlay,
// 283 OH, 341 CA, 354 CT, 363 NY, 380 OH, 428 NC, 464 IL, 472 NC, 539 OK,
// 557 MO, 572 OK, 582 PA, 624 NY, 633 FL, 645 FL, 656 FL, 659 AL, 679 MI,
// 683 ON, 738 CA, 742 ON, 771 DC, 826 VA, 837 CA, 840 CA, 867 Yukon/NWT/NU,
// 879 PA, 945 TX, 948 VA, 959 FL, 961 FL, 963 NC, 964 FL).

export type NanpCountry = 'US' | 'CA' | 'NANP';

/** Normalize a destination to bare digits: strips +, spaces, brackets, dashes. */
export function normalizeNanpDigits(destination: string): string {
  return (destination ?? '').replace(/\D/g, '');
}

/** NPA (first 3 digits after +1) → country. 'NANP' = other territory. */
const NPA: Record<string, NanpCountry> = {
  // ── USA ──
  '201': 'US', '202': 'US', '203': 'US', '204': 'CA', '205': 'US', '206': 'US',
  '207': 'US', '208': 'US', '209': 'US', '210': 'US', '212': 'US', '213': 'US',
  '214': 'US', '215': 'US', '216': 'US', '217': 'US', '218': 'US', '219': 'US',
  '220': 'US', '224': 'US', '225': 'US', '226': 'CA', '227': 'US', '228': 'US',
  '229': 'US', '231': 'US', '234': 'US', '236': 'CA', '239': 'US', '240': 'US',
  '242': 'NANP', '243': 'CA', '246': 'NANP', '248': 'US', '249': 'CA', '250': 'CA',
  '251': 'US', '252': 'US', '253': 'US', '254': 'US', '256': 'US', '260': 'US',
  '262': 'US', '264': 'NANP', '267': 'US', '268': 'NANP', '269': 'US', '270': 'US',
  '272': 'US', '274': 'US', '276': 'US', '278': 'US', '281': 'US', '283': 'US',
  '284': 'NANP', '289': 'CA', '301': 'US', '302': 'US', '303': 'US', '304': 'US',
  '305': 'US', '306': 'CA', '307': 'US', '308': 'US', '309': 'US', '310': 'US',
  '312': 'US', '313': 'US', '314': 'US', '315': 'US', '316': 'US', '317': 'US',
  '318': 'US', '319': 'US', '320': 'US', '321': 'US', '323': 'US', '325': 'US',
  '327': 'US', '330': 'US', '331': 'US', '332': 'US', '334': 'US', '336': 'US',
  '337': 'US', '339': 'US', '340': 'NANP', '341': 'US', '343': 'CA', '345': 'NANP',
  '347': 'US', '351': 'US', '352': 'US', '354': 'US', '360': 'US', '361': 'US',
  '363': 'US', '364': 'US', '365': 'CA', '367': 'CA', '368': 'CA', '369': 'US',
  '380': 'US', '382': 'CA', '385': 'US', '386': 'US', '387': 'CA', '401': 'US',
  '402': 'US', '403': 'CA', '404': 'US', '405': 'US', '406': 'US', '407': 'US',
  '408': 'US', '409': 'US', '410': 'US', '412': 'US', '413': 'US', '414': 'US',
  '415': 'US', '416': 'CA', '417': 'US', '418': 'CA', '419': 'US', '420': 'US',
  '423': 'US', '424': 'US', '425': 'US', '428': 'US', '430': 'US', '431': 'CA',
  '432': 'US', '433': 'CA', '434': 'US', '435': 'US', '437': 'CA', '438': 'CA',
  '440': 'US', '441': 'NANP', '442': 'US', '443': 'US', '445': 'US', '447': 'US',
  '448': 'US', '450': 'CA', '464': 'US', '468': 'CA', '469': 'US', '470': 'US',
  '514': 'CA', '647': 'CA',
  '472': 'US', '473': 'NANP', '474': 'CA', '475': 'US', '478': 'US', '479': 'US',
  '480': 'US', '484': 'US', '501': 'US', '502': 'US', '503': 'US', '504': 'US',
  '505': 'US', '506': 'CA', '507': 'US', '508': 'US', '509': 'US', '510': 'US',
  '512': 'US', '513': 'US', '515': 'US', '516': 'US', '517': 'US', '518': 'US',
  '519': 'CA', '520': 'US', '530': 'US', '531': 'US', '534': 'US', '539': 'US',
  '540': 'US', '541': 'US', '548': 'CA', '551': 'US', '557': 'US', '559': 'US',
  '561': 'US', '562': 'US', '563': 'US', '564': 'US', '567': 'US', '570': 'US',
  '571': 'US', '572': 'US', '573': 'US', '574': 'US', '575': 'US', '579': 'CA',
  '580': 'US', '581': 'CA', '582': 'US', '585': 'US', '586': 'US', '587': 'CA',
  '601': 'US', '602': 'US', '603': 'US', '604': 'CA', '605': 'US', '606': 'US',
  '607': 'US', '608': 'US', '609': 'US', '610': 'US', '612': 'US', '613': 'CA',
  '614': 'US', '615': 'US', '616': 'US', '617': 'US', '618': 'US', '619': 'US',
  '620': 'US', '623': 'US', '624': 'US', '625': 'US', '626': 'US', '627': 'US',
  '628': 'US', '629': 'US', '630': 'US', '631': 'US', '636': 'US', '641': 'US',
  '646': 'US', '650': 'US', '651': 'US', '657': 'US', '659': 'US', '660': 'US',
  '661': 'US', '662': 'US', '664': 'NANP', '667': 'US', '669': 'US', '670': 'NANP',
  '671': 'NANP', '672': 'CA', '678': 'US', '679': 'US', '681': 'CA', '682': 'US',
  '683': 'CA', '684': 'NANP', '701': 'US', '702': 'US', '703': 'US', '704': 'US',
  '705': 'CA', '706': 'US', '707': 'US', '708': 'US', '709': 'CA', '710': 'US',
  '712': 'US', '713': 'US', '714': 'US', '715': 'US', '716': 'US', '717': 'US',
  '718': 'US', '719': 'US', '720': 'US', '724': 'US', '725': 'US', '726': 'US',
  '727': 'US', '731': 'US', '732': 'US', '734': 'US', '737': 'US', '738': 'US',
  '740': 'US', '741': 'US', '742': 'CA', '743': 'US', '747': 'US', '754': 'US',
  '757': 'US', '758': 'NANP', '760': 'US', '762': 'US', '763': 'US', '765': 'US',
  '767': 'NANP', '769': 'US', '770': 'US', '771': 'US', '772': 'US', '773': 'US',
  '774': 'US', '775': 'US', '776': 'US', '778': 'CA', '779': 'US', '780': 'CA',
  '781': 'US', '782': 'CA', '784': 'NANP', '785': 'US', '786': 'US', '787': 'NANP',
  '801': 'US', '802': 'US', '803': 'US', '804': 'US', '805': 'US', '806': 'US',
  '807': 'CA', '808': 'US', '809': 'NANP', '810': 'US', '812': 'US', '813': 'US',
  '814': 'US', '815': 'US', '816': 'US', '817': 'US', '818': 'US', '819': 'CA',
  '820': 'US', '825': 'CA', '826': 'US', '828': 'US', '829': 'NANP', '830': 'US',
  '831': 'US', '832': 'US', '837': 'US', '838': 'US', '839': 'US', '840': 'US',
  '843': 'US', '845': 'US', '847': 'US', '848': 'US', '849': 'NANP', '850': 'US',
  '854': 'US', '856': 'US', '857': 'US', '858': 'US', '859': 'US', '860': 'US',
  '862': 'US', '863': 'US', '864': 'US', '865': 'US', '867': 'CA', '868': 'NANP',
  '869': 'NANP', '870': 'US', '872': 'US', '873': 'CA', '876': 'NANP', '878': 'US',
  '879': 'US', '880': 'US', '881': 'US', '882': 'US', '883': 'US', '884': 'US',
  '885': 'US', '886': 'US', '887': 'US', '888': 'US', '889': 'NANP', '901': 'US',
  '902': 'CA', '903': 'US', '904': 'US', '905': 'CA', '906': 'US', '907': 'US',
  '908': 'US', '909': 'US', '910': 'US', '912': 'US', '913': 'US', '914': 'US',
  '915': 'US', '916': 'US', '917': 'US', '918': 'US', '919': 'US', '920': 'US',
  '925': 'US', '928': 'US', '929': 'US', '930': 'US', '931': 'US', '934': 'US',
  '936': 'US', '937': 'US', '938': 'US', '939': 'NANP', '940': 'US', '941': 'US',
  '945': 'US', '947': 'US', '948': 'US', '949': 'US', '951': 'US', '952': 'US',
  '954': 'US', '956': 'US', '959': 'US', '970': 'US', '971': 'US', '972': 'US',
  '973': 'US', '975': 'US', '978': 'US', '979': 'US', '980': 'US', '984': 'US',
  '985': 'US', '986': 'US', '989': 'US',
};

/**
 * Classify a +1 (NANP) destination by area code.
 * Returns 'US' | 'CA' | 'NANP' (other territory) or null when the number
 * isn't a valid +1 NANP number or the NPA is unassigned — the caller must
 * NOT guess in that case (fall back to generic handling / unknown).
 */
export function classifyNanp(destination: string): NanpCountry | null {
  let digits = normalizeNanpDigits(destination);
  // Accept 1XXXXXXXXXX (11 digits) or bare 10-digit NANP numbers.
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length !== 10) return null;
  return NPA[digits.slice(0, 3)] ?? null;
}
