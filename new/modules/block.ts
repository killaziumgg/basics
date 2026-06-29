import chains from "../input/chains.json" with { type: "json" };

interface RPCResponse {
    success: boolean;
    data?: any;
    error?: {
        message: string;
        code?: string;
    };
}

interface BlockResult {
    success: boolean;
    data?: {
        blockNumber: number;
        timestamp: number;
    };
    error?: {
        message: string;
        details?: any;
    };
}

interface EVMBlockResult {
    success: boolean;
    data?: Array<{
        chainName: string;
        chainId: number;
        blockNumber: number;
        timestamp: number;
    }>;
    error?: {
        message: string;
        details?: any;
    };
}

export class SolanaBlock {
    static readonly SOLANA_RPCS = chains?.Solana?.ChainRPC;
    private readonly MAX_RETRIES = 5;
    private readonly RPC_TIMEOUT_MS = 3000;

    async rpcCall(method: string, params: any[]): Promise<RPCResponse> {
        const rpcs = SolanaBlock.SOLANA_RPCS;

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

    async getCurrentBlock(): Promise<BlockResult> {
        const result = await this.rpcCall('getBlockHeight', []);

        if (result?.success === true) {
            const blockNumber = Number(result?.data);

            if (!Number.isFinite(blockNumber)) {
                return {
                    success: false,
                    error: { message: "Réponse RPC invalide pour getBlockHeight", details: result?.data }
                };
            }

            return {
                success: true,
                data: {
                    blockNumber,
                    timestamp: Date.now()
                }
            };
        }

        return {
            success: false,
            error: result?.error || { message: "Erreur inconnue" }
        };
    }
}

export class EVMBlock {
    static readonly EVM_CHAINS = chains?.EVM?.Chains;
    private readonly MAX_RETRIES = 5;
    private readonly RPC_TIMEOUT_MS = 3000;

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

    async getCurrentBlock(): Promise<EVMBlockResult> {
        const evmChains = EVMBlock.EVM_CHAINS;

        if (!evmChains || evmChains.length === 0) {
            return {
                success: false,
                error: { message: 'Aucune chain EVM disponible' }
            };
        }

        const results = await Promise.all(evmChains.map(async (chain: any) => {
            const blockHex = await this.rpcCallOnChain(chain, 'eth_blockNumber', []);
            return {
                chainName: chain?.ChainName,
                chainId: chain?.ChainId,
                blockNumber: blockHex !== null ? Number(blockHex) : null,
                timestamp: Date.now()
            };
        }));

        const found = results.filter(r => r.blockNumber !== null && Number.isFinite(r.blockNumber)) as Array<{
            chainName: string;
            chainId: number;
            blockNumber: number;
            timestamp: number;
        }>;

        if (found.length === 0) {
            return {
                success: false,
                error: { message: 'Aucun résultat pour eth_blockNumber sur les chains testées' }
            };
        }

        return {
            success: true,
            data: found
        };
    }
}

export class BitcoinBlock {
    static readonly BITCOIN_RPCS = chains?.Bitcoin?.ChainRPC;
    private readonly MAX_RETRIES = 5;
    private readonly RPC_TIMEOUT_MS = 3000;

    async rpcCall(path: string): Promise<RPCResponse> {
        const rpcs = (BitcoinBlock.BITCOIN_RPCS || []).filter((url: string) => !!url);

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

    async getCurrentBlock(): Promise<BlockResult> {
        const result = await this.rpcCall('/blocks/tip/height');

        if (result?.success === true) {
            const blockNumber = Number(result?.data);

            if (!Number.isFinite(blockNumber)) {
                return {
                    success: false,
                    error: { message: "Réponse API invalide pour /blocks/tip/height", details: result?.data }
                };
            }

            return {
                success: true,
                data: {
                    blockNumber,
                    timestamp: Date.now()
                }
            };
        }

        return {
            success: false,
            error: result?.error || { message: "Erreur inconnue" }
        };
    }
}
