import { Client } from "xrpl";
import { getStatus, getTransaction, isCongested } from "./xrp.ts";

const ADDRESS = "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe";
const HASH = "2DF8C202DB505B0D73B77D25DFD4F8349896FCA34D68743FA23A54B329CD008F";

const client = new Client("wss://xrplcluster.com");
await client.connect();

console.log("Solde XRP   :", await client.getXrpBalance(ADDRESS));

const balances = await client.getBalances(ADDRESS);
console.log("Tokens      :", balances.filter((b) => b.currency !== "XRP"));

console.log("Transaction :", await getTransaction(client, HASH));

console.log("Statut      :", await getStatus(client, HASH));

console.log("Ledger      :", await client.getLedgerIndex());

console.log("Congestion  :", await isCongested(client));

await client.disconnect();
