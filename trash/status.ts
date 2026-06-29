import { createSolanaRpc, type Signature } from "@solana/kit";

(BigInt.prototype as any).toJSON = function () { return this.toString(); };

const RPC_URL = "https://api.mainnet.solana.com";

const rpc = createSolanaRpc(RPC_URL);


// --- Version 1 : avec @solana/kit (comme dans index.ts) ---
// .send() renvoie le champ "result" de la réponse JSON-RPC : { context, value }
async function getSignatureStatuses(signature: string) {
    const response = await rpc
        .getSignatureStatuses([signature as Signature], { searchTransactionHistory: true })
        .send();

    console.log("=== @solana/kit — result ===");
    console.log(JSON.stringify(response, null, 2));
}


// --- Version 2 : fetch brut, pour voir l'enveloppe JSON-RPC complète ---
// { jsonrpc, id, result: { context, value } } telle qu'elle arrive sur le réseau
async function getSignatureStatusesRaw(signature: string) {
    const response = await fetch(RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "getSignatureStatuses",
            params: [
                [signature],
                { searchTransactionHistory: true }
            ]
        })
    });

    const data = await response.json();

    console.log("=== fetch brut — enveloppe JSON-RPC complète ===");
    console.log(JSON.stringify(data, null, 2));
}


const sig = "3scxU6jETe77ZFT4juhU15Yfn73mvyChLvkdcBhA6oYcPyCetc7c2MXjtAxND5N7Y6jxqNzogLr7hbismmHXC8Zo"

await getSignatureStatuses(sig)
await getSignatureStatusesRaw(sig)
