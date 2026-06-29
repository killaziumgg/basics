import { Solana } from "./modules/solana.ts";
import { EVM } from "./modules/evm.ts";
import { Bitcoin } from "./modules/btc.ts";

// --- Données de test réelles (issues du dossier exempleresponse) ---
const SOL_TX = "LeGKFsvmqtKrUsfcVtCVqvPnfvj2fbHhBMzmEuFnmPesFzUqebvGvn5BnJGPpKmEzg92PRvk5GKzNNF5VKgA3MY";
const SOL_ADDR = "DhDhc7jMRM444dVrN5vjymExUeP4CHr9Ahn9T8Cj45hS";

const ETH_TX = "0xbb4982aa11587aea583da46c315b6f0782dbe8d156cfcca00897af4bfab2a884";
const ETH_ADDR = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"; // vitalik.eth

const BTC_ADDR = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
const BTC_TX = "ffc6ff7c1e056bf02815cb2fd6992bf2bf7035086d9b95d596486b61cb59443c";

function show(label: string, value: any) {
    console.log(`\n=== ${label} ===`);
    console.log(JSON.stringify(value, null, 2));
}

async function timed<T>(label: string, fn: () => Promise<T>): Promise<void> {
    const start = performance.now();
    try {
        const res = await fn();
        show(`${label}  (${Math.round(performance.now() - start)}ms)`, res);
    } catch (e) {
        show(`${label}  — EXCEPTION`, e instanceof Error ? e.message : String(e));
    }
}

console.log("################  BITCOIN  ################");
const btc = new Bitcoin();
await timed("BTC get_btc_Balance", () => btc.get_btc_Balance(BTC_ADDR));
await timed("BTC getTransaction", () => btc.getTransaction(BTC_TX));
await timed("BTC getStatus", () => btc.getStatus(BTC_TX));

console.log("\n\n################  EVM  ################");
const evm = new EVM();
await timed("EVM get_eth_Balance", () => evm.get_eth_Balance(ETH_ADDR));
await timed("EVM get_erc20token_balance", () => evm.get_erc20token_balance(ETH_ADDR));
await timed("EVM getTransaction", () => evm.getTransaction(ETH_TX));
await timed("EVM getStatus", () => evm.getStatus(ETH_TX));

console.log("\n\n################  SOLANA  ################");
const sol = new Solana();
const SOL_FUNDED = "nigaoYcTvMWjayi4ZUberFkV8923RTu89pYKHQd6h3K"; // détient USDC
await timed("SOL get_sol_Balance (vide)", () => sol.get_sol_Balance(SOL_ADDR));
await timed("SOL get_sol_Balance (approvisionné)", () => sol.get_sol_Balance(SOL_FUNDED));
await timed("SOL get_spltoken_balance (approvisionné)", () => sol.get_spltoken_balance(SOL_FUNDED));
await timed("SOL getTransaction", () => sol.getTransaction(SOL_TX));
// getStatus boucle 30x (1s) si le RPC échoue — on le teste à part plus bas.

console.log("\n\nDONE.");
