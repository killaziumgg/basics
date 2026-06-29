import ethBalanceEth from "../exempleresponse/eth/eth_getBalance_eth.json" with { type: "json" };
import ethBalanceBase from "../exempleresponse/base/eth_getBalance_base.json" with { type: "json" };
import ethCallEth from "../exempleresponse/eth/eth_call.json" with { type: "json" };
import ethCallBase from "../exempleresponse/base/eth_call.json" with { type: "json" };
import txEth from "../exempleresponse/eth/eth_getTransactionByHash_eth.json" with { type: "json" };
import txBase from "../exempleresponse/base/eth_getTransactionByHash_base.json" with { type: "json" };
import btcAddress from "../exempleresponse/btc/btc_address.json" with { type: "json" };
import btcTx from "../exempleresponse/btc/btc_address_txs.json" with { type: "json" };
import solTokens from "../exempleresponse/sol/getTokenAccountsByOwner_sol.json" with { type: "json" };

const rpc = (result: any) => ({ jsonrpc: "2.0", id: 1, result });

const DECIMALS_6 = "0x0000000000000000000000000000000000000000000000000000000000000006";

const receiptFor = (tx: any) =>
    rpc({
        transactionHash: tx.result.hash,
        blockHash: tx.result.blockHash,
        blockNumber: tx.result.blockNumber,
        from: tx.result.from,
        to: tx.result.to,
        status: "0x1"
    });

const blockAfter = (hex: string, plus: number) => "0x" + (BigInt(hex) + BigInt(plus)).toString(16);

const SOL_BALANCE = rpc({ context: { apiVersion: "4.0.0", slot: 425716513 }, value: 4551140860 });

const SOL_SIG_STATUS = rpc({
    context: { apiVersion: "4.0.0", slot: 425716513 },
    value: [
        {
            slot: 425121102,
            confirmations: null,
            confirmationStatus: "finalized",
            err: null,
            status: { Ok: null }
        }
    ]
});

const SOL_TX = rpc({
    blockTime: 1780925822,
    slot: 425121102,
    meta: { err: null, fee: 10050, computeUnitsConsumed: 450 },
    transaction: {
        message: {
            accountKeys: [
                "DhDhc7jMRM444dVrN5vjymExUeP4CHr9Ahn9T8Cj45hS",
                "BW1C3SLCkYhdFAMXcVR37rhE795x3nrB5Pohwtce9Qbc",
                "11111111111111111111111111111111"
            ],
            recentBlockhash: "FXcdtz7GzdXwvKCzuxqzhpHRXVUSJGqcG38z9rMqGVZr"
        },
        signatures: [
            "LeGKFsvmqtKrUsfcVtCVqvPnfvj2fbHhBMzmEuFnmPesFzUqebvGvn5BnJGPpKmEzg92PRvk5GKzNNF5VKgA3MY"
        ]
    }
});

const BTC_TIP = Number((btcTx as any)?.status?.block_height ?? 0) + 10;

function json(obj: any): Response {
    return new Response(JSON.stringify(obj), {
        status: 200,
        headers: { "content-type": "application/json" }
    });
}

export async function mockFetch(input: any, options: any = {}): Promise<Response> {
    const url = typeof input === "string" ? input : input?.url ?? String(input);
    const isBase = url.includes("base");

    if (options?.method === "POST" && options.body) {
        const { method, params } = JSON.parse(options.body);

        switch (method) {
            case "eth_getBalance":
                return json(isBase ? ethBalanceBase : ethBalanceEth);
            case "eth_call": {
                const data = params?.[0]?.data ?? "";
                if (data.startsWith("0x313ce567")) return json(rpc(DECIMALS_6));
                return json(isBase ? ethCallBase : ethCallEth);
            }
            case "eth_getTransactionByHash":
                return json(isBase ? txBase : txEth);
            case "eth_getTransactionReceipt":
                return json(receiptFor(isBase ? txBase : txEth));
            case "eth_blockNumber":
                return json(rpc(blockAfter((isBase ? txBase : txEth).result.blockNumber, 50)));

            case "getBalance":
                return json(SOL_BALANCE);
            case "getTokenAccountsByOwner":
                return json(solTokens);
            case "getTransaction":
                return json(SOL_TX);
            case "getSignatureStatuses":
                return json(SOL_SIG_STATUS);
        }
    }

    if (url.includes("/blocks/tip/height")) return json(BTC_TIP);
    if (url.includes("/address/")) return json(btcAddress);
    if (url.includes("/tx/")) return json(btcTx);

    return new Response(JSON.stringify({ error: "no fixture for this request" }), {
        status: 404,
        headers: { "content-type": "application/json" }
    });
}
