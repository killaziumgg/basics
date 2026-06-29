import tokens from "../input/tokens_sol.json" with { type: "json" };
import chains from "../input/chains.json" with { type: "json" };

const KNOWN_MINTS: Record<string, string> = tokens;

interface RPCResponse {
    success: boolean;
    data?: any;
    error?: {
        message: string;
        code?: string;
    };
}

interface SolanaRpcContext {
    apiVersion: string;
    slot: number;
}

interface SolanaTransactionStatus {
    confirmationStatus: 'processed' | 'confirmed' | 'finalized';
    confirmations: number | null;
    err: any;
    slot: number;
    status: { Ok: null } | { Err: any };
}

interface SolanaRpcResponse {
    context: SolanaRpcContext;
    value: (SolanaTransactionStatus | null)[];
}

interface TransactionStatusResult {
    success: boolean;
    data?: {
        slot: number;
        confirmations: number | null;
        confirmationStatus: 'processed' | 'confirmed' | 'finalized';
        error: any;
        isFinalized: boolean;
        isSuccessful: boolean;
        transactionStatus: "EXPIRED_OR_NOT_FOUND" | "DROPPED" | "CONFIRMED_SUCCESS" | "FINALIZED_FAILED" |
                           "FINALIZED_SUCCESS" | "CONFIRMED_FAILED" | "PROCESSED_SUCCESS" | "PROCESSED_FAILED";
        statusDescription: string;
    };
    error?: {
        message: string;
        details?: any;
    };
}

export class Solana {
    static readonly SOLANA_RPCS = chains?.Solana?.ChainRPC;
    private readonly MAX_RETRIES = 5;
    private readonly RPC_TIMEOUT_MS = 3000;
    static readonly TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

    async rpcCall(method: string, params: any[]): Promise<RPCResponse> {
        const rpcs = Solana.SOLANA_RPCS;

        if (!Array.isArray(rpcs) || rpcs.length === 0) {
            return {
                success: false,
                error: {
                    message: 'Aucun RPC Solana disponible',
                    code: 'NO_RPC_AVAILABLE'
                }
            };
        }

        const maxAttempts = Math.max(this.MAX_RETRIES, rpcs.length);
        let lastError: Error | null = null;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const rpcUrl = rpcs[attempt % rpcs.length];

            try {
                const response = await fetch(rpcUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        id: 1,
                        method: method,
                        params: params
                    }),
                    signal: AbortSignal.timeout(this.RPC_TIMEOUT_MS)
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status} ${response.statusText}`);
                }

                const data: any = await response.json();

                if (data.error) {
                    throw new Error(`RPC Error: ${data.error.message}`);
                }

                return {
                    success: true,
                    data: data.result
                };

            } catch (error) {
                lastError = error as Error;
                console.warn(`Tentative ${attempt + 1}/${maxAttempts} échouée avec RPC ${rpcUrl}: ${lastError.message}`);

                if (attempt < maxAttempts - 1) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }
        }

        return {
            success: false,
            error: {
                message: `Tous les RPCs ont échoué après ${maxAttempts} tentatives`,
                code: 'ALL_RPC_FAILED'
            }
        };
    }

    async get_sol_Balance(walletAddress: string): Promise<any> {
        const result = await this.rpcCall('getBalance',[walletAddress]);

        if (result?.success === true) {
            const lamports = Number(result?.data?.value);

            if (!Number.isFinite(lamports)) {
                return {
                    success: false,
                    error: { message: "Réponse RPC invalide pour getBalance", details: result?.data }
                };
            }

            const response = {
                "success": true,
                "balance": lamports / 1_000_000_000
            };
            return response;
        }


        return {
            success: false,
            error: result?.error || { message: "Erreur inconnue" }
        };
    }

    async get_spltoken_balance(walletAddress: string): Promise<any> {
        interface Response {
            success: boolean;
            holdings: Array<{[key: string]: number}>;
        }

        const result = await this.rpcCall('getTokenAccountsByOwner',[
            walletAddress,
            { programId: Solana.TOKEN_PROGRAM_ID },
            { encoding: 'jsonParsed' }
        ]);

        if (result?.success !== true) {
            return {
                success: false,
                error: result?.error || { message: "Erreur inconnue" }
            };
        }

        const holdings = result?.data?.value;

        if (!Array.isArray(holdings)) {
            return {
                success: false,
                error: { message: "Réponse RPC invalide pour getTokenAccountsByOwner", details: result?.data }
            };
        }

        let response:Response = {
            "success" : true,
            "holdings" : []
        };

        for (const [ticker, mintAddress] of Object.entries(KNOWN_MINTS)) {
            let balance = 0;

            for (const holding of holdings) {
                const info = holding?.account?.data?.parsed?.info;

                if (info?.mint === mintAddress) {
                    const amount = Number(info?.tokenAmount?.uiAmount);

                    if (Number.isFinite(amount)) {
                        balance += amount;
                    }
                }
            }

            response.holdings.push({ [ticker]: balance });
        }

        return response;
    }

    async getTransaction(signature: string): Promise<any> {
        const result = await this.rpcCall('getTransaction', [signature, { maxSupportedTransactionVersion: 0, encoding: 'jsonParsed' }]);

        if (result?.success !== true) {
            return {
                success: false,
                error: result?.error || { message: "Transaction non trouvée" }
            };
        }

        const tx = result.data;

        if (!tx) {
            return {
                success: false,
                error: { message: "Transaction non trouvée" }
            };
        }

        const slot_time = tx.blockTime;
        const slot = tx.slot;
        const tx_status = tx.meta?.err ?? null;
        const fee_lamports = Number(tx.meta?.fee);
        const gas_fee = Number.isFinite(fee_lamports) ? fee_lamports / 1_000_000_000 : null;

        // Extraction émetteur / destinataire / montant à partir des soldes avant/après.
        const meta = tx.meta || {};
        const message = tx.transaction?.message || {};
        const rawKeys: any[] = message.accountKeys || [];
        const keyAt = (i: number): string | null => {
            const a = rawKeys[i];
            return typeof a === "string" ? a : (a?.pubkey ?? null);
        };

        // tokens_sol.json = { ticker: mint } → on inverse pour retrouver le symbole depuis le mint.
        const mintToSymbol: Record<string, string> = {};
        for (const [sym, mint] of Object.entries(KNOWN_MINTS)) mintToSymbol[mint] = sym;

        let from: string | null = keyAt(0);   // le signataire (compte 0) = émetteur
        let to: string | null = null;
        let amount = 0;
        let asset = "SOL";
        let type: "native" | "token" = "native";

        const preTok: any[] = meta.preTokenBalances || [];
        const postTok: any[] = meta.postTokenBalances || [];

        if (postTok.length > 0) {
            // TOKEN : on apparie avant/après par accountIndex, le destinataire = celui qui GAGNE le plus.
            let best: { owner: string; mint: string; delta: number } | null = null;
            for (const p of postTok) {
                const pre = preTok.find((b: any) => b.accountIndex === p.accountIndex);
                const postAmt = Number(p?.uiTokenAmount?.uiAmount ?? p?.uiTokenAmount?.uiAmountString ?? 0);
                const preAmt = Number(pre?.uiTokenAmount?.uiAmount ?? pre?.uiTokenAmount?.uiAmountString ?? 0);
                const delta = postAmt - preAmt;
                if (delta > 0 && (!best || delta > best.delta)) best = { owner: p.owner, mint: p.mint, delta };
            }
            if (best) {
                type = "token";
                to = best.owner;
                amount = best.delta;
                asset = mintToSymbol[best.mint] || (best.mint ? best.mint.slice(0, 4) + "…" + best.mint.slice(-4) : "tokens");
            }
        } else {
            // SOL : le destinataire = le compte (hors émetteur) qui gagne le plus.
            const pre: any[] = meta.preBalances || [];
            const post: any[] = meta.postBalances || [];
            for (let i = 1; i < post.length; i++) {
                const delta = (Number(post[i]) - Number(pre[i])) / 1_000_000_000;
                if (delta > amount) { amount = delta; to = keyAt(i); }
            }
        }

        return {
            success: true,
            data: {
                slot: slot,
                blockTime: slot_time,
                status: tx_status,
                fee: gas_fee,
                from,
                to,
                amount,
                asset,
                type,
                transaction: tx
            }
        };
    }

    async getStatus(signature: string): Promise<TransactionStatusResult> {
        const MAX_RETRIES = 30;
        const RETRY_DELAY_MS = 1000;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const result = await this.rpcCall('getSignatureStatuses',[[signature],
                    { searchTransactionHistory: true }
                ]);

                if (result?.success !== true) {
                    if (attempt === MAX_RETRIES) {
                        return {
                            success: false,
                            error: {
                                message: "Échec de l'appel RPC après toutes les tentatives",
                                details: result?.error
                            }
                        };
                    }
                    console.warn(`Tentative ${attempt}/${MAX_RETRIES} échouée, retry dans ${RETRY_DELAY_MS}ms...`);
                    await this.sleep(RETRY_DELAY_MS);
                    continue;
                }

                const rpcResponse: SolanaRpcResponse = result.data;

                if (!rpcResponse?.value || !Array.isArray(rpcResponse.value)) {
                    if (attempt === MAX_RETRIES) {
                        return {
                            success: false,
                            error: {
                                message: "Réponse RPC invalide",
                                details: rpcResponse
                            }
                        };
                    }
                    await this.sleep(RETRY_DELAY_MS);
                    continue;
                }

                const txStatus = rpcResponse.value[0];

                if (txStatus === null) {

                    if (attempt >= 10) {
                        const txResult = await this.rpcCall('getTransaction',[signature, { maxSupportedTransactionVersion: 0 }]);

                        if (txResult?.success === true && txResult.data === null) {
                            return {
                                success: true,
                                data: {
                                    slot: 0,
                                    confirmations: null,
                                    confirmationStatus: 'processed',
                                    error: null,
                                    isFinalized: false,
                                    isSuccessful: false,
                                    transactionStatus: 'DROPPED',
                                    statusDescription: 'Transaction dropped - elle a été rejetée par le réseau (probablement à cause d\'un blockhash expiré ou de frais insuffisants)'
                                }
                            };
                        }
                    }

                    if (attempt === MAX_RETRIES) {
                        return {
                            success: true,
                            data: {
                                slot: 0,
                                confirmations: null,
                                confirmationStatus: 'processed',
                                error: null,
                                isFinalized: false,
                                isSuccessful: false,
                                transactionStatus: 'EXPIRED_OR_NOT_FOUND',
                                statusDescription: 'Transaction expirée ou introuvable - elle n\'a pas été traitée dans les délais'
                            }
                        };
                    }

                    console.log(`Tentative ${attempt}/${MAX_RETRIES} - transaction en attente, retry dans ${RETRY_DELAY_MS}ms...`);
                    await this.sleep(RETRY_DELAY_MS);
                    continue;
                }

                const slot = txStatus.slot;
                const confirmations = txStatus.confirmations;
                const confirmationStatus = txStatus.confirmationStatus;
                const error = txStatus.err;

                const isFinalized = confirmationStatus === 'finalized';
                const isSuccessful = error === null;

                let transactionStatus: "EXPIRED_OR_NOT_FOUND" | "DROPPED" | "CONFIRMED_SUCCESS" | "FINALIZED_FAILED" |
                    "FINALIZED_SUCCESS" | "CONFIRMED_FAILED" | "PROCESSED_SUCCESS" | "PROCESSED_FAILED";
                let statusDescription: string;


                if (isFinalized) {
                    if (isSuccessful) {
                        transactionStatus = 'FINALIZED_SUCCESS';
                        statusDescription = 'Transaction finalisée avec succès';
                    } else {
                        transactionStatus = 'FINALIZED_FAILED';
                        statusDescription = `Transaction finalisée mais échouée: ${this.decodeTransactionError(error)}`;
                    }
                } else if (confirmationStatus === 'confirmed') {
                    if (isSuccessful) {
                        transactionStatus = 'CONFIRMED_SUCCESS';
                        statusDescription = `Transaction confirmée avec succès (${confirmations} confirmations)`;
                    } else {
                        transactionStatus = 'CONFIRMED_FAILED';
                        statusDescription = `Transaction confirmée mais échouée: ${this.decodeTransactionError(error)}`;
                    }
                } else {
                    if (isSuccessful) {
                        transactionStatus = 'PROCESSED_SUCCESS';
                        statusDescription = 'Transaction traitée avec succès (en attente de confirmation)';
                    } else {
                        transactionStatus = 'PROCESSED_FAILED';
                        statusDescription = `Transaction traitée mais échouée: ${this.decodeTransactionError(error)}`;
                    }
                }

                return {
                    success: true,
                    data: {
                        slot,
                        confirmations,
                        confirmationStatus,
                        error,
                        isFinalized,
                        isSuccessful,
                        transactionStatus,
                        statusDescription
                    }
                };

            } catch (error) {
                console.error(`Tentative ${attempt}/${MAX_RETRIES} - erreur:`, error);

                if (attempt === MAX_RETRIES) {
                    return {
                        success: false,
                        error: {
                            message: "Erreur technique lors de la vérification du statut",
                            details: error instanceof Error ? error.message : String(error)
                        }
                    };
                }

                await this.sleep(RETRY_DELAY_MS);
            }
        }

        return {
            success: false,
            error: { message: "Erreur inattendue dans la boucle de retry" }
        };
    }

    private decodeTransactionError(error: any): string {
        try {
            if (!error) return "Aucune erreur";

            if (typeof error === 'string') {
                return `Erreur: ${error}`;
            }

            if (Array.isArray(error.InstructionError)) {
                const [instructionIndex, instructionError] = error.InstructionError;

                if (typeof instructionError === 'string') {
                    if (instructionError === 'InsufficientFunds') {
                        return `Fonds insuffisants (instruction ${instructionIndex})`;
                    }
                    return `Erreur ${instructionError} dans l'instruction ${instructionIndex}`;
                }

                if (instructionError?.Custom !== undefined) {
                    return `Erreur custom ${instructionError.Custom} dans l'instruction ${instructionIndex}`;
                }

                return `Erreur instruction ${instructionIndex}: ${Object.keys(instructionError || {})[0] || 'Inconnue'}`;
            }

            if (error.InsufficientFundsForFee !== undefined) {
                return "Fonds insuffisants pour les frais";
            }

            if (error.BlockhashNotFound !== undefined) {
                return "Blockhash expiré";
            }

            return `Erreur: ${Object.keys(error)[0] || 'Inconnue'}`;
        } catch {
            return `Erreur non décodable: ${JSON.stringify(error)}`;
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }


}
