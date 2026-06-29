import chains from "../input/chains.json" with { type: "json" };

interface APIResponse {
    success: boolean;
    data?: any;
    error?: {
        message: string;
        code?: string;
    };
}

interface TransactionStatusResult {
    success: boolean;
    data?: {
        blockHeight: number;
        confirmations: number;
        error: any;
        isFinalized: boolean;
        isSuccessful: boolean;
        transactionStatus: "EXPIRED_OR_NOT_FOUND" | "PENDING" | "CONFIRMED_SUCCESS" |
                           "FINALIZED_SUCCESS";
        statusDescription: string;
    };
    error?: {
        message: string;
        details?: any;
    };
}

export class Bitcoin {
    static readonly BITCOIN_RPCS = chains?.Bitcoin?.ChainRPC;
    private readonly MAX_RETRIES = 5;
    private readonly RPC_TIMEOUT_MS = 3000;
    private readonly FINALITY_CONFIRMATIONS = 6;

    async rpcCall(path: string): Promise<APIResponse> {
        const rpcs = (Bitcoin.BITCOIN_RPCS || []).filter((url: string) => !!url);

        if (!Array.isArray(rpcs) || rpcs.length === 0) {
            return {
                success: false,
                error: {
                    message: 'Aucun RPC Bitcoin disponible',
                    code: 'NO_RPC_AVAILABLE'
                }
            };
        }

        const maxAttempts = Math.max(this.MAX_RETRIES, rpcs.length);
        let lastError: Error | null = null;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const rpcUrl = rpcs[attempt % rpcs.length];

            try {
                const response = await fetch(`${rpcUrl}${path}`, {
                    signal: AbortSignal.timeout(this.RPC_TIMEOUT_MS)
                });

                if (response.status === 404) {
                    return {
                        success: true,
                        data: null
                    };
                }

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status} ${response.statusText}`);
                }

                const data: any = await response.json();

                return {
                    success: true,
                    data: data
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

    async get_btc_Balance(address: string): Promise<any> {
        const result = await this.rpcCall(`/address/${address}`);

        if (result?.success === true) {
            if (result.data === null) {
                return {
                    success: false,
                    error: { message: "Adresse non trouvée" }
                };
            }

            const stats = result?.data?.chain_stats;
            const sats = Number(stats?.funded_txo_sum) - Number(stats?.spent_txo_sum);

            if (!Number.isFinite(sats)) {
                return {
                    success: false,
                    error: { message: "Réponse API invalide pour l'adresse", details: result?.data }
                };
            }

            const response = {
                "success": true,
                "balance": sats / 100_000_000
            };
            return response;
        }

        return {
            success: false,
            error: result?.error || { message: "Erreur inconnue" }
        };
    }

    async getTransaction(txid: string): Promise<any> {
        const result = await this.rpcCall(`/tx/${txid}`);

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

        const block_height = tx.status?.block_height ?? null;
        const block_time = tx.status?.block_time ?? null;
        const tx_confirmed = tx.status?.confirmed === true;
        const fee_sats = Number(tx.fee);
        const gas_fee = Number.isFinite(fee_sats) ? fee_sats / 100_000_000 : null;

        // Bitcoin = UTXO : on résume les entrées (émetteurs) et sorties (destinataires).
        const vin: any[] = Array.isArray(tx.vin) ? tx.vin : [];
        const vout: any[] = Array.isArray(tx.vout) ? tx.vout : [];

        const inputs = vin.map((i: any) => ({
            address: i?.prevout?.scriptpubkey_address ?? null,
            value: Number(i?.prevout?.value ?? 0) / 100_000_000
        }));
        const outputs = vout.map((o: any) => ({
            address: o?.scriptpubkey_address ?? null,
            value: Number(o?.value ?? 0) / 100_000_000
        }));

        // Émetteur principal = entrée qui apporte le plus de BTC.
        let from: string | null = null;
        let fromVal = -1;
        for (const i of inputs) { if (i.address && i.value > fromVal) { fromVal = i.value; from = i.address; } }

        // Destinataire principal = plus grosse sortie qui ne revient PAS à un émetteur (sinon plus grosse sortie = self-send).
        const senderSet = new Set(inputs.map((i) => i.address).filter(Boolean));
        let to: string | null = null;
        let amount = 0;
        for (const o of outputs) { if (o.address && !senderSet.has(o.address) && o.value > amount) { amount = o.value; to = o.address; } }
        if (to === null) {
            for (const o of outputs) { if (o.value > amount) { amount = o.value; to = o.address; } }
        }

        return {
            success: true,
            data: {
                blockHeight: block_height,
                blockTime: block_time,
                confirmed: tx_confirmed,
                fee: gas_fee,
                from,
                to,
                amount,
                asset: "BTC",
                type: "native",
                inputs,
                outputs,
                transaction: tx
            }
        };
    }

    async getStatus(txid: string): Promise<TransactionStatusResult> {
        const MAX_RETRIES = 30;
        const RETRY_DELAY_MS = 1000;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const result = await this.rpcCall(`/tx/${txid}`);

                if (result?.success !== true) {
                    if (attempt === MAX_RETRIES) {
                        return {
                            success: false,
                            error: {
                                message: "Échec de l'appel API après toutes les tentatives",
                                details: result?.error
                            }
                        };
                    }
                    console.warn(`Tentative ${attempt}/${MAX_RETRIES} échouée, retry dans ${RETRY_DELAY_MS}ms...`);
                    await this.sleep(RETRY_DELAY_MS);
                    continue;
                }

                const tx = result.data;

                if (!tx) {
                    if (attempt === MAX_RETRIES) {
                        return {
                            success: true,
                            data: {
                                blockHeight: 0,
                                confirmations: 0,
                                error: null,
                                isFinalized: false,
                                isSuccessful: false,
                                transactionStatus: 'EXPIRED_OR_NOT_FOUND',
                                statusDescription: "Transaction introuvable - elle n'existe pas ou a été évincée de la mempool"
                            }
                        };
                    }

                    console.log(`Tentative ${attempt}/${MAX_RETRIES} - transaction introuvable, retry dans ${RETRY_DELAY_MS}ms...`);
                    await this.sleep(RETRY_DELAY_MS);
                    continue;
                }

                if (tx.status?.confirmed !== true) {
                    return {
                        success: true,
                        data: {
                            blockHeight: 0,
                            confirmations: 0,
                            error: null,
                            isFinalized: false,
                            isSuccessful: false,
                            transactionStatus: 'PENDING',
                            statusDescription: 'Transaction en attente dans la mempool - pas encore minée'
                        }
                    };
                }

                const blockHeight = Number(tx.status?.block_height);
                const tipResult = await this.rpcCall('/blocks/tip/height');
                const tipHeight = Number(tipResult?.data);
                const confirmations = (Number.isFinite(tipHeight) && Number.isFinite(blockHeight)) ? tipHeight - blockHeight + 1 : 0;

                const isSuccessful = true;
                const isFinalized = confirmations >= this.FINALITY_CONFIRMATIONS;

                let transactionStatus: "EXPIRED_OR_NOT_FOUND" | "PENDING" | "CONFIRMED_SUCCESS" |
                    "FINALIZED_SUCCESS";
                let statusDescription: string;

                if (isFinalized) {
                    transactionStatus = 'FINALIZED_SUCCESS';
                    statusDescription = `Transaction finalisée avec succès (${confirmations} confirmations)`;
                } else {
                    transactionStatus = 'CONFIRMED_SUCCESS';
                    statusDescription = `Transaction confirmée avec succès (${confirmations} confirmation(s) sur ${this.FINALITY_CONFIRMATIONS} requises pour finalité)`;
                }

                return {
                    success: true,
                    data: {
                        blockHeight,
                        confirmations,
                        error: null,
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

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }


}
