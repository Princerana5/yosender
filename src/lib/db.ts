import fs from "fs"; import path from "path";
const DB_DIR = process.env.VERCEL ? path.join("/tmp", ".data") : path.join(process.cwd(), ".data");
const USERS_FILE = path.join(DB_DIR, "users.json");
const ACCS_FILE = path.join(DB_DIR, "tg_accounts.json");
const CAMPS_FILE = path.join(DB_DIR, "campaigns.json");
const RENTAL_POOL_FILE = path.join(DB_DIR, "rental_pool.json");
const RENTALS_FILE = path.join(DB_DIR, "rentals.json");
function ensure(){ if(!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR,{recursive:true}); for(const f of [USERS_FILE,ACCS_FILE,CAMPS_FILE,RENTAL_POOL_FILE,RENTALS_FILE]) if(!fs.existsSync(f)) fs.writeFileSync(f,"[]"); }
export type User={id:string;name:string;email:string;passwordHash:string;createdAt:string;telegramUsername?:string;lastLoginAt?:string;isBanned?:boolean};
export type TgAccount={id:string;userId:string;phone:string;username:string;displayName:string;firstName:string;session:string;status:string;createdAt:string;isRental?:boolean;rentalId?:string;rentalExpiresAt?:string;rentalPoolId?:string};
export type Campaign={id:string;userId:string;accountId:string|null;managed:boolean;name:string;message:string;destinations:string[];delayMs:number;scheduledAt:string|null;mode:"post"|"forward";forwardFrom?:string;status:string;successful:number;failed:number;createdAt:string;logs:any[];claimedDests?:string[];repeatIntervalId?:string|null;repeatEveryMins?:number|null;delayMins?:number|null;imagePreview?:string|null;nextRunAt?:string|null;lastRunAt?:string|null};
export type RentalPoolAccount={id:string;phone:string;username:string;displayName:string;firstName:string;session:string;status:"available"|"rented"|"banned";pricePerDay:number;createdAt:string;rentedBy?:string|null;rentedAt?:string|null;expiresAt?:string|null};
export type Rental={id:string;userId:string;poolAccountId:string;tgAccountId:string;phone:string;username:string;displayName:string;firstName:string;price:number;rentedAt:string;expiresAt:string;status:"active"|"expired"|"banned"};
function read<T>(file:string):T[]{ensure(); return JSON.parse(fs.readFileSync(file,"utf-8"));}
function write(file:string,data:any){ensure(); fs.writeFileSync(file,JSON.stringify(data,null,2));}
export function getUsers():User[]{return read(USERS_FILE);}
export function saveUsers(u:User[]){write(USERS_FILE,u);}
export function getAccounts():TgAccount[]{return read(ACCS_FILE);}
export function saveAccounts(a:TgAccount[]){write(ACCS_FILE,a);}
export function getCampaigns():Campaign[]{return read(CAMPS_FILE);}
export function saveCampaigns(c:Campaign[]){write(CAMPS_FILE,c);}
export function getRentalPool():RentalPoolAccount[]{return read<RentalPoolAccount>(RENTAL_POOL_FILE);}
export function saveRentalPool(p:RentalPoolAccount[]){write(RENTAL_POOL_FILE,p);}
export function getRentals():Rental[]{return read<Rental>(RENTALS_FILE);}
export function saveRentals(r:Rental[]){write(RENTALS_FILE,r);}

// No auto-seed: dummy pool accounts were re-appearing after admin deleted them.
// Marketplace shows an empty state when the pool is empty; admin adds real accounts.
export function ensureRentalPoolSeed(){}
