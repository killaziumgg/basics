import chains from "../input/chains.json" with { type: "json" };

interface RPCResponse {
    success: boolean;
    data?: any;
    error?: {
        message: string;
        code?: string;
    };
}

interface CongestionResult {
    success: boolean;
    data?: {
        chainName: string;
        chainId: number | null;
        isCongested: boolean;
        metric: number;
        threshold: number;
        unit: string;
        description: string;
    };
    error?: {
        message: string;
        details?: any;
    };
}

interface EVMCongestionResult {
    success: boolean;
    data?: Array<{
        chainName: string;
        chainId: number;
        isCongested: boolean;
        metric: number;
        threshold: number;
        unit: string;
        description: string;
    }>;
    error?: {
        message: string;
        details?: any;
    };
}

export class SolanaCongestion {
    static readonly SOLANA_RPCS = chains?.Solana?.ChainRPC;
    private readonly MAX_RETRIES = 5;
    private readonly RPC_TIMEOUT_MS = 3000;
    // Frais de priorité moyens (micro-lamports/CU) au-delà desquels on considère le réseau congestionné.
    // Plancher normal observé : 0 à ~1200 micro-lamports/CU ; en congestion la moyenne monte dans les milliers.
    private readonly CONGESTION_FEE_THRESHOLD = 10000;

    async rpcCall(method: string, params: any[]): Promise<RPCResponse> {
        const rpcs = SolanaCongestion.SOLANA_RPCS;

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

    async isCongested(): Promise<CongestionResult> {
        const result = await this.rpcCall('getRecentPrioritizationFees', []);

        if (result?.success !== true) {
            return {
                success: false,
                error: result?.error || { message: "Erreur inconnue" }
            };
        }

        const fees = result?.data;

        if (!Array.isArray(fees) || fees.length === 0) {
            return {
                success: false,
                error: { message: "Réponse RPC invalide pour getRecentPrioritizationFees", details: result?.data }
            };
        }

        const values = fees
            .map((f: any) => Number(f?.prioritizationFee))
            .filter((v: number) => Number.isFinite(v));

        if (values.length === 0) {
            return {
                success: false,
                error: { message: "Aucun frais de priorité exploitable", details: result?.data }
            };
        }

        const avgFee = values.reduce((sum: number, v: number) => sum + v, 0) / values.length;
        const isCongested = avgFee >= this.CONGESTION_FEE_THRESHOLD;

        return {
            success: true,
            data: {
                chainName: "Solana",
                chainId: null,
                isCongested,
                metric: avgFee,
                threshold: this.CONGESTION_FEE_THRESHOLD,
                unit: "micro-lamports/CU",
                description: isCongested
                    ? `Solana congestionnée : frais de priorité moyens élevés (${avgFee.toFixed(0)} micro-lamports/CU)`
                    : `Solana fluide : frais de priorité moyens faibles (${avgFee.toFixed(0)} micro-lamports/CU)`
            }
        };
    }
}

export class EVMCongestion {
    static readonly EVM_CHAINS = chains?.EVM?.Chains;
    private readonly MAX_RETRIES = 5;
    private readonly RPC_TIMEOUT_MS = 3000;
    // Seuil de base fee (en gwei) par chainId au-delà duquel on considère la chain congestionnée.
    // La base fee EIP-1559 EST le prix de la congestion : elle monte quand la demande dépasse la cible.
    // Valeurs par chaîne car le "normal" diffère (ETH ~quelques gwei, Base <0.05 gwei).
    private readonly CONGESTION_BASEFEE_THRESHOLD_GWEI: Record<number, number> = {
        1: 30,      // Ethereum
        8453: 0.1   // Base
    };
    // Seuil par défaut pour une chain non listée
    private readonly DEFAULT_BASEFEE_THRESHOLD_GWEI = 30;
    private readonly WEI_PER_GWEI = 1_000_000_000;

    private async rpcCallOnChain(chain: any, method: string, params: any[]): Promise<any | null> {
        const rpcs = chain?.ChainRPC;

        if (!Array.isArray(rpcs) || rpcs.length === 0) {
            return null;
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

                return data.result;

            } catch (error) {
                lastError = error as Error;
                console.warn(`Tentative ${attempt + 1}/${maxAttempts} échouée sur ${chain?.ChainName} avec RPC ${rpcUrl}: ${lastError.message}`);

                if (attempt < maxAttempts - 1) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }
        }

        return null;
    }

    async isCongested(): Promise<EVMCongestionResult> {
        const evmChains = EVMCongestion.EVM_CHAINS;

        if (!evmChains || evmChains.length === 0) {
            return {
                success: false,
                error: { message: 'Aucune chain EVM disponible' }
            };
        }

        const results = await Promise.all(evmChains.map(async (chain: any) => {
            // Chaînes sans marché de gas EIP-1559 (ex. TRON, qui renvoie baseFeePerGas "0x0") :
            // la métrique de base fee n'a aucun sens → on les ignore pour la congestion.
            if (chain?.SupportsBaseFee === false) {
                return null;
            }

            const block = await this.rpcCallOnChain(chain, 'eth_getBlockByNumber', ['latest', false]);

            // Garde-fou : Number(null) vaudrait 0 et afficherait à tort « fluide, 0 gwei ».
            const rawBaseFee = block?.baseFeePerGas;
            if (rawBaseFee == null) {
                return null;
            }

            const baseFeeWei = Number(rawBaseFee);

            if (!Number.isFinite(baseFeeWei)) {
                return null;
            }

            const baseFeeGwei = baseFeeWei / this.WEI_PER_GWEI;
            const threshold = this.CONGESTION_BASEFEE_THRESHOLD_GWEI[chain?.ChainId] ?? this.DEFAULT_BASEFEE_THRESHOLD_GWEI;
            const isCongested = baseFeeGwei >= threshold;

            return {
                chainName: chain?.ChainName,
                chainId: chain?.ChainId,
                isCongested,
                metric: baseFeeGwei,
                threshold,
                unit: "gwei (base fee)",
                description: isCongested
                    ? `${chain?.ChainName} congestionnée : base fee élevée (${baseFeeGwei.toFixed(3)} gwei)`
                    : `${chain?.ChainName} fluide : base fee faible (${baseFeeGwei.toFixed(3)} gwei)`
            };
        }));

        const found = results.filter((r): r is NonNullable<typeof r> => r !== null);

        if (found.length === 0) {
            return {
                success: false,
                error: { message: 'Aucun résultat exploitable pour eth_getBlockByNumber sur les chains testées' }
            };
        }

        return {
            success: true,
            data: found
        };
    }
}

export class BitcoinCongestion {
    static readonly BITCOIN_RPCS = chains?.Bitcoin?.ChainRPC;
    private readonly MAX_RETRIES = 5;
    private readonly RPC_TIMEOUT_MS = 3000;
    // Cible de confirmation (en blocs) dont on lit le fee rate dans /fee-estimates (standard Esplora).
    // "1" = fee rate nécessaire pour passer au prochain bloc.
    private readonly NEXT_BLOCK_TARGET = "1";
    // Fee rate (sat/vB) pour le prochain bloc au-delà duquel on considère le réseau congestionné.
    // Le fee rate EST le prix de la congestion sur Bitcoin (métrique cohérente avec Solana/EVM,
    // contrairement au volume brut du mempool qui est gonflé par la poussière à frais quasi nuls).
    // Plancher normal : 1 à ~10 sat/vB ; congestion : 30 à 200+ sat/vB.
    private readonly CONGESTION_FEERATE_THRESHOLD = 30;

    async rpcCall(path: string): Promise<RPCResponse> {
        const rpcs = (BitcoinCongestion.BITCOIN_RPCS || []).filter((url: string) => !!url);

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

    async isCongested(): Promise<CongestionResult> {
        const result = await this.rpcCall('/fee-estimates');

        if (result?.success !== true) {
            return {
                success: false,
                error: result?.error || { message: "Erreur inconnue" }
            };
        }

        const estimates = result?.data;

        if (!estimates || typeof estimates !== "object") {
            return {
                success: false,
                error: { message: "Réponse API invalide pour /fee-estimates", details: result?.data }
            };
        }

        const feeRate = Number(estimates[this.NEXT_BLOCK_TARGET]);

        if (!Number.isFinite(feeRate)) {
            return {
                success: false,
                error: { message: "Aucun fee rate exploitable pour le prochain bloc", details: result?.data }
            };
        }

        const isCongested = feeRate >= this.CONGESTION_FEERATE_THRESHOLD;

        return {
            success: true,
            data: {
                chainName: "Bitcoin",
                chainId: null,
                isCongested,
                metric: feeRate,
                threshold: this.CONGESTION_FEERATE_THRESHOLD,
                unit: "sat/vB (prochain bloc)",
                description: isCongested
                    ? `Bitcoin congestionnée : fee rate élevé pour le prochain bloc (${feeRate.toFixed(2)} sat/vB)`
                    : `Bitcoin fluide : fee rate faible pour le prochain bloc (${feeRate.toFixed(2)} sat/vB)`
            }
        };
    }
}
