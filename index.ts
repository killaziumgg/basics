import { createSolanaRpc, Address, address, Signature } from "@solana/kit";
import tokens from "./tokens.json" with { type: "json" };

const KNOWN_MINTS: Record<string, string> = tokens;

(BigInt.prototype as any).toJSON = function () { return this.toString(); };

const RPC_URL = "https://api.mainnet.solana.com";

const rpc = createSolanaRpc(RPC_URL);


async function getBalance(walletAddress: Address): Promise<number> {
    const { value } = await rpc.getBalance(walletAddress).send();
    return Number(value) / 1_000_000_000;
}


// const sol_amount = await getBalance(address("nigaoYcTvMWjayi4ZUberFkV8923RTu89pYKHQd6h3K"))
// console.log(`Balance: ${Number(sol_amount)} SOL`);


async function getTransaction(signature: string): Promise<string> {
    const tx       = await rpc.getTransaction(signature as Signature, {encoding: "jsonParsed"}).send();
    const accounts = tx?.transaction?.message?.accountKeys
    const preBal   = tx?.meta?.preBalances
    const postBal  = tx?.meta?.postBalances
    const preTok   = tx?.meta?.preTokenBalances  ?? []
    const postTok  = tx?.meta?.postTokenBalances ?? []

    const sender    = accounts?.[0]?.pubkey                            // signataire = émetteur (fiable)
    const sol_spent = (Number(preBal?.[0]) - Number(postBal?.[0])) / 1e9  // SOL perdu par l'émetteur (≥ frais)
    const prio_fee  = Number(tx?.meta?.fee) / 1e9
    const slot      = tx?.slot

    let reciever: string | undefined
    let mint = "So11111111111111111111111111111111111111112"
    let amount = 0   // montant transféré (en token si token, sinon en SOL)

    if (postTok.length > 0) {
        // TOKEN : on apparie avant/après par accountIndex, le receveur = celui qui GAGNE.
        const recv = postTok
            .map((p: any) => ({
                owner: p.owner,
                mint:  p.mint,
                delta: Number(p.uiTokenAmount.uiAmountString)
                     - Number(preTok.find((b: any) => b.accountIndex === p.accountIndex)?.uiTokenAmount?.uiAmountString ?? 0),
            }))
            .find((m: any) => m.delta > 0)
        reciever = recv?.owner
        mint     = recv?.mint ?? mint
        amount   = recv?.delta ?? 0
    } else {
        // SOL : le receveur = le compte (hors émetteur) qui gagne le plus.
        for (let i = 1; i < (postBal?.length ?? 0); i++) {
            const delta = (Number(postBal?.[i]) - Number(preBal?.[i])) / 1e9
            if (delta > amount) { amount = delta; reciever = accounts?.[i]?.pubkey }
        }
    }

    const token_name = KNOWN_MINTS[mint] ?? mint

    console.log({ sender, reciever, token_name, amount, sol_spent, prio_fee, slot })

    return JSON.stringify(tx);
}


// const tx_details = await getTransaction("3scxU6jETe77ZFT4juhU15Yfn73mvyChLvkdcBhA6oYcPyCetc7c2MXjtAxND5N7Y6jxqNzogLr7hbismmHXC8Zo")
// console.log(`${tx_details}`)


async function getTransactionStatus(signature: string): Promise<string> {
    const { value } = await rpc
        .getSignatureStatuses([signature as Signature], { searchTransactionHistory: true })
        .send();

    const status = value[0]

    if (status === null) {
        // jamais vue par le cluster : pas encore propagée, expirée (blockhash périmé), ou signature invalide
        console.log({ signature, status: "introuvable" })
        return JSON.stringify(null)
    }

    const success   = status.err === null                          // incluse dans un bloc ET exécutée sans erreur
    const finalized = status.confirmationStatus === "finalized"    // le bloc est irréversible

    console.log({
        slot: status.slot,
        confirmationStatus: status.confirmationStatus,  // processed | confirmed | finalized
        confirmations: status.confirmations,            // null = finalisée (rooted)
        success,
        finalized,
        err: status.err,
    })

    return JSON.stringify(status)
}


// const tx_status = await getTransactionStatus("3scxU6jETe77ZFT4juhU15Yfn73mvyChLvkdcBhA6oYcPyCetc7c2MXjtAxND5N7Y6jxqNzogLr7hbismmHXC8Zo")
// console.log(`${tx_status}`)


async function get_wallet_transaction(walletAddress: Address, limit: number): Promise<string> {
    
    let signaturesForConfig = {
    limit: limit
    };

    let signatures = await rpc
    .getSignaturesForAddress(walletAddress, signaturesForConfig)
    .send();

    // console.log(signatures);

    return JSON.stringify(signatures)
}



async function get_token_accounts_by_owner(walletAddress: string): Promise<string> {

    const response = await fetch(RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "getTokenAccountsByOwner",
            params: [
                walletAddress,
                { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },  // Token Program (SPL)
                { encoding: "jsonParsed" }
            ]
        })
    });

    const data = await response.json();

    for (const account of data.result?.value ?? []) {
        const info       = account.account.data.parsed.info
        const mint       = info.mint
        const token_name = KNOWN_MINTS[mint] ?? mint
        const amount     = Number(info.tokenAmount.uiAmountString)

        console.log({ token_name, mint, amount })
    }

    return JSON.stringify(data.result)
}


// const token_accounts = await get_token_accounts_by_owner("nigaoYcTvMWjayi4ZUberFkV8923RTu89pYKHQd6h3K")
// console.log(`${token_accounts}`)


async function get_wallet_full_transaction(walletAddress: Address, limit: number): Promise<string> {
    
    let signaturesForConfig = {
    limit: limit
    };

    let signatures = await rpc
    .getSignaturesForAddress(walletAddress, signaturesForConfig)
    .send();

    // console.log(signatures);

    for (const tx of signatures) {
        console.log(tx.signature)
        const full_tx = await getTransaction(tx.signature)
    }

    return JSON.stringify(signatures)
}

await get_wallet_full_transaction(address("nigaoYcTvMWjayi4ZUberFkV8923RTu89pYKHQd6h3K"), 1)