const RPC_URL = "https://api.mainnet.solana.com";

const sig = process.argv[2] ?? "4vh4Ay14WjPbaJR6TDNmGoS4Lu9CMdc3DF3pcazTSyMW181QS6XX8jEvDRxJ6uBo5j7ViW14LkB7MXLJ51BMQpiC";

const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTransaction",
        params: [sig, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }]
    })
});

const tx = (await response.json()).result;

console.log("err :", JSON.stringify(tx?.meta?.err));
console.log("\n--- logMessages ---");
for (const line of tx?.meta?.logMessages ?? []) console.log(line);
