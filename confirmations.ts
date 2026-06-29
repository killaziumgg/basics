const RPC_URL = "https://api.mainnet.solana.com";

async function rpcCall(method: string, params: any[]): Promise<any> {
    const response = await fetch(RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
    });
    return (await response.json()).result;
}

// On prend la derniere tx du Token Program (tres actif) au niveau "confirmed"
// => elle vient d'entrer dans un bloc mais n'est pas encore finalisee.
const sigs = await rpcCall("getSignaturesForAddress", [
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    { limit: 1, commitment: "confirmed" }
]);
const sig = sigs[0].signature;
console.log(`tx fraiche : ${sig}\n`);

// On polle son statut toutes les 2s : confirmations monte, puis passe a null quand finalisee.
for (let i = 0; i < 10; i++) {
    const status = (await rpcCall("getSignatureStatuses", [[sig]])).value[0];
    console.log(`t+${i * 2}s`, JSON.stringify(status));
    if (status?.confirmations === null) break;   // finalisee, plus rien a observer
    await new Promise(resolve => setTimeout(resolve, 2000));
}
