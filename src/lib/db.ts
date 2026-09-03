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
export type Campaign={id:string;userId:string;accountId:string|null;managed:boolean;name:string;message:string;destinations:string[];delayMs:number;scheduledAt:string|null;mode:"post"|"forward";forwardFrom?:string;status:string;successful:number;failed:number;createdAt:string;logs:any[];repeatIntervalId?:string|null;repeatEveryMins?:number|null;delayMins?:number|null;imagePreview?:string|null;nextRunAt?:string|null;lastRunAt?:string|null};
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

// seed rental pool with demo accounts if empty — so marketplace is never empty
export function ensureRentalPoolSeed(){
  const pool = getRentalPool();
  if(pool.length) return;
  const now = new Date().toISOString();
  const demo: RentalPoolAccount[] = [
    { id: "rent_pool_1", phone: "+91 90000 00001", username: "sender_hub_01", displayName: "Sender Hub 01", firstName: "Sender", session: "", status: "available", pricePerDay: 1, createdAt: now },
    { id: "rent_pool_2", phone: "+91 90000 00002", username: "sender_hub_02", displayName: "Sender Hub 02", firstName: "Sender", session: "", status: "available", pricePerDay: 1, createdAt: now },
    { id: "rent_pool_3", phone: "+91 90000 00003", username: "sender_hub_03", displayName: "Sender Hub 03", firstName: "Sender", session: "", status: "available", pricePerDay: 1, createdAt: now },
    { id: "rent_pool_4", phone: "+91 90000 00004", username: "sender_hub_04", displayName: "Sender Hub 04", firstName: "Sender", session: "", status: "available", pricePerDay: 1, createdAt: now },
    { id: "rent_pool_5", phone: "+91 90000 00005", username: "sender_hub_05", displayName: "Sender Hub 05", firstName: "Sender", session: "", status: "available", pricePerDay: 1, createdAt: now },
    { id: "rent_pool_6", phone: "+91 90000 00006", username: "sender_hub_06", displayName: "Sender Hub 06", firstName: "Sender", session: "", status: "available", pricePerDay: 1, createdAt: now },
  ];
  saveRentalPool(demo);
}
