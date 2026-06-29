import tokens from "../input/tokens_evm.json" with { type: "json" };
import chains from "../input/chains.json" with { type: "json" };
import { tronBase58ToEvmHex, evmHexToTronBase58, isTronAddress } from "./tron.ts";

const KNOWN_TOKENS: Record<string, Record<string, string>> = tokens;

interface RPCResponse {
    success: boolean;
    data?: any;
    error?: {
        message: string;
        code?: string;
    };
}

interface ChainResult {
    chainName: string;
    chainId: number;
    result: any;
}

interface TransactionStatusResult {
    success: boolean;
    data?: {
        chainName: string | null;
        chainId: number | null;
        blockNumber: number;
        confirmations: number;
        error: any;
        isFinalized: boolean;
        isSuccessful: boolean;
        transactionStatus: "EXPIRED_OR_NOT_FOUND" | "PENDING" | "CONFIRMED_SUCCESS" | "CONFIRMED_FAILED" |
                           "FINALIZED_SUCCESS" | "FINALIZED_FAILED";
        statusDescription: string;
    };
    error?: {
        message: string;
        details?: any;
    };
}

export class EVM {
    static readonly EVM_CHAINS = chains?.EVM?.Chains;
    private readonly MAX_RETRIES = 5;
    private readonly RPC_TIMEOUT_MS = 3000;
    private readonly FINALITY_CONFIRMATIONS = 12;

    // Format d'adresse d'une chaîne (par défaut "evm"). TRON utilise du Base58 → "tron".
    private chainAddressFormat(chain: any): "evm" | "tron" {
        return chain?.AddressFormat === "tron" ? "tron" : "evm";
    }

    // Format d'adresse déduit de la valeur saisie par l'utilisateur.
    private addressFormat(value: string): "evm" | "tron" {
        return isTronAddress(value) ? "tron" : "evm";
    }

    // Convertit une adresse vers la forme hex EVM (0x...) attendue par le JSON-RPC, selon la chaîne.
    private toEvmHexAddress(chain: any, value: string): string {
        if (this.chainAddressFormat(chain) === "tron") return tronBase58ToEvmHex(value);
        return value.toLowerCase();
    }

    // Chaînes EVM compatibles avec le format de l'adresse saisie (un 0x ne s'interroge pas sur TRON, et vice versa).
    private chainsForAddress(value: string): any[] {
        const fmt = this.addressFormat(value);
        return (EVM.EVM_CHAINS || []).filter((c: any) => this.chainAddressFormat(c) === fmt);
    }

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

    async rpcCall(method: string, params: any[]): Promise<RPCResponse> {
        const evmChains = EVM.EVM_CHAINS;

        if (!evmChains || evmChains.length === 0) {
            return {
                success: false,
                error: {
                    message: 'Aucune chain EVM disponible',
                    code: 'NO_CHAIN_AVAILABLE'
                }
            };
        }

        const results: ChainResult[] = await Promise.all(evmChains.map(async (chain: any) => ({
            chainName: chain?.ChainName,
            chainId: chain?.ChainId,
            result: await this.rpcCallOnChain(chain, method, params)
        })));

        const found = results.filter(r => r.result !== null && r.result !== undefined);

        if (found.length === 0) {
            return {
                success: false,
                error: {
                    message: `Aucun résultat pour ${method} sur les chains testées`,
                    code: 'NO_RESULT'
                }
            };
        }

        return {
            success: true,
            data: found
        };
    }

    async get_eth_Balance(walletAddress: string): Promise<any> {
        const chainsToQuery = this.chainsForAddress(walletAddress);

        if (chainsToQuery.length === 0) {
            return {
                success: false,
                error: { message: "Aucune chain EVM compatible avec ce format d'adresse" }
            };
        }

        const balances = await Promise.all(chainsToQuery.map(async (chain: any) => {
            let hexAddr: string;
            try {
                hexAddr = this.toEvmHexAddress(chain, walletAddress);
            } catch {
                return null;
            }

            const raw = await this.rpcCallOnChain(chain, 'eth_getBalance', [hexAddr, 'latest']);
            if (raw === null) return null;

            const decimals = Number(chain?.NativeDecimals ?? 18);
            const balance = Number(raw) / Math.pow(10, decimals);
            if (!Number.isFinite(balance)) return null;

            return {
                chainName: chain?.ChainName,
                chainId: chain?.ChainId,
                balance,
                symbol: chain?.NativeSymbol ?? "ETH"
            };
        }));

        return {
            success: true,
            balances: balances.filter((b) => b !== null)
        };
    }

    async get_erc20token_balance(walletAddress: string): Promise<any> {
        interface Response {
            success: boolean;
            holdings: Array<{[key: string]: any}>;
        }

        const chainsToQuery = this.chainsForAddress(walletAddress);

        if (chainsToQuery.length === 0) {
            return {
                success: false,
                error: { message: "Aucune chain EVM compatible avec ce format d'adresse" }
            };
        }

        let response: Response = {
            "success": true,
            "holdings": []
        };

        await Promise.all(chainsToQuery.map(async (chain: any) => {
            const chainTokens = KNOWN_TOKENS[chain?.ChainTicker] || {};

            let walletHex: string;
            try {
                walletHex = this.toEvmHexAddress(chain, walletAddress);
            } catch {
                return;
            }
            const callData = '0x70a08231' + walletHex.toLowerCase().replace('0x', '').padStart(64, '0');

            for (const contract of Object.keys(chainTokens)) {
                let contractHex: string;
                try {
                    contractHex = this.toEvmHexAddress(chain, contract);
                } catch {
                    continue;
                }

                const balanceHex = await this.rpcCallOnChain(chain, 'eth_call', [{ to: contractHex, data: callData }, 'latest']);
                const decimalsHex = await this.rpcCallOnChain(chain, 'eth_call', [{ to: contractHex, data: '0x313ce567' }, 'latest']);

                if (balanceHex === null || decimalsHex === null) {
                    continue;
                }

                const balance = Number(balanceHex) / Math.pow(10, Number(decimalsHex));

                if (!Number.isFinite(balance)) {
                    continue;
                }

                response.holdings.push({
                    "chainName": chain?.ChainName,
                    "chainId": chain?.ChainId,
                    "token": chainTokens[contract],
                    "balance": balance
                });
            }
        }));

        return response;
    }

    async getTransaction(txHash: string): Promise<any> {
        const result = await this.rpcCall('eth_getTransactionByHash', [txHash]);

        if (result?.success !== true) {
            return {
                success: false,
                error: result?.error || { message: "Transaction non trouvée" }
            };
        }

        const found: ChainResult = result.data[0];
        const tx = found.result;
        const chain = EVM.EVM_CHAINS?.find((c: any) => c?.ChainId === found.chainId);
        const nativeDecimals = Number(chain?.NativeDecimals ?? 18);
        const nativeSymbol = chain?.NativeSymbol ?? "ETH";

        // Par défaut : transfert natif. from = signataire, to = destinataire, montant = tx.value.
        let from: string = tx.from;
        let to: string = tx.to;
        let amount: number = Number(tx.value) / Math.pow(10, nativeDecimals);
        let asset: string = nativeSymbol;
        let type: "native" | "token" = "native";

        // Détection d'un transfert ERC-20 via le sélecteur de fonction (4 premiers octets de l'input).
        const input: string = typeof tx.input === "string" ? tx.input : "0x";
        const selector = input.slice(0, 10).toLowerCase();
        const TRANSFER = "0xa9059cbb";       // transfer(address,uint256)
        const TRANSFER_FROM = "0x23b872dd";  // transferFrom(address,address,uint256)

        if (selector === TRANSFER || selector === TRANSFER_FROM) {
            try {
                const contract = tx.to;

                // Décimales du token (eth_call decimals()) + symbole connu si répertorié.
                const decimalsHex = await this.rpcCallOnChain(chain, 'eth_call', [{ to: contract, data: '0x313ce567' }, 'latest']);
                const decimals = decimalsHex !== null ? Number(decimalsHex) : 18;

                // Les contrats connus sont stockés dans leur format natif (0x pour EVM, Base58 pour TRON) :
                // on indexe par leur forme hex EVM pour retrouver le symbole à partir du contract de la tx.
                const chainTokens: Record<string, string> = KNOWN_TOKENS[chain?.ChainTicker ?? ""] || {};
                const symbolMap: Record<string, string> = {};
                for (const k of Object.keys(chainTokens)) {
                    try {
                        symbolMap[this.toEvmHexAddress(chain, k).toLowerCase()] = chainTokens[k];
                    } catch {
                        symbolMap[k.toLowerCase()] = chainTokens[k];
                    }
                }

                let amountRaw: bigint;
                if (selector === TRANSFER) {
                    to = '0x' + input.slice(34, 74);
                    amountRaw = BigInt('0x' + (input.slice(74, 138) || '0'));
                } else {
                    from = '0x' + input.slice(34, 74);
                    to = '0x' + input.slice(98, 138);
                    amountRaw = BigInt('0x' + (input.slice(138, 202) || '0'));
                }

                amount = Number(amountRaw) / Math.pow(10, decimals);
                asset = symbolMap[String(contract).toLowerCase()] || "tokens";
                type = "token";
            } catch {
                // décodage impossible → on conserve les infos natives
            }
        }

        // TRON renvoie des adresses au format hex EVM : on les réaffiche en Base58 (T...).
        if (this.chainAddressFormat(chain) === "tron") {
            try { if (from) from = evmHexToTronBase58(from); } catch { /* on garde la forme hex */ }
            try { if (to) to = evmHexToTronBase58(to); } catch { /* on garde la forme hex */ }
        }

        return {
            success: true,
            data: {
                chainName: found.chainName,
                chainId: found.chainId,
                blockNumber: tx.blockNumber !== null ? Number(tx.blockNumber) : null,
                blockTime: tx.blockTimestamp != null ? Number(tx.blockTimestamp) : null,
                from,
                to,
                amount,
                asset,
                type,
                transaction: tx
            }
        };
    }

    async getStatus(txHash: string): Promise<TransactionStatusResult> {
        const MAX_RETRIES = 30;
        const RETRY_DELAY_MS = 1000;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const result = await this.rpcCall('eth_getTransactionReceipt', [txHash]);

                if (result?.success !== true) {
                    if (attempt === MAX_RETRIES) {
                        const txResult = await this.rpcCall('eth_getTransactionByHash', [txHash]);

                        if (txResult?.success === true) {
                            const pending: ChainResult = txResult.data[0];
                            return {
                                success: true,
                                data: {
                                    chainName: pending.chainName,
                                    chainId: pending.chainId,
                                    blockNumber: 0,
                                    confirmations: 0,
                                    error: null,
                                    isFinalized: false,
                                    isSuccessful: false,
                                    transactionStatus: 'PENDING',
                                    statusDescription: `Transaction en attente sur ${pending.chainName} - elle est dans la mempool mais pas encore minée`
                                }
                            };
                        }

                        return {
                            success: true,
                            data: {
                                chainName: null,
                                chainId: null,
                                blockNumber: 0,
                                confirmations: 0,
                                error: null,
                                isFinalized: false,
                                isSuccessful: false,
                                transactionStatus: 'EXPIRED_OR_NOT_FOUND',
                                statusDescription: "Transaction introuvable sur les chains testées - elle n'a pas été traitée dans les délais"
                            }
                        };
                    }

                    console.log(`Tentative ${attempt}/${MAX_RETRIES} - transaction en attente, retry dans ${RETRY_DELAY_MS}ms...`);
                    await this.sleep(RETRY_DELAY_MS);
                    continue;
                }

                const found: ChainResult = result.data[0];
                const receipt = found.result;

                const chain = EVM.EVM_CHAINS?.find((c: any) => c?.ChainId === found.chainId);
                const latestBlockHex = await this.rpcCallOnChain(chain, 'eth_blockNumber', []);

                // Tip momentanément indisponible : on réessaie plutôt que d'annoncer une tx minée avec 0 confirmation.
                if (latestBlockHex === null && attempt < MAX_RETRIES) {
                    await this.sleep(RETRY_DELAY_MS);
                    continue;
                }

                const blockNumber = Number(receipt.blockNumber);
                const confirmations = latestBlockHex !== null ? Number(latestBlockHex) - blockNumber + 1 : 0;

                const finality = Number(chain?.Finality ?? this.FINALITY_CONFIRMATIONS);
                const isSuccessful = receipt.status === '0x1';
                const isFinalized = confirmations >= finality;

                let transactionStatus: "EXPIRED_OR_NOT_FOUND" | "PENDING" | "CONFIRMED_SUCCESS" | "CONFIRMED_FAILED" |
                    "FINALIZED_SUCCESS" | "FINALIZED_FAILED";
                let statusDescription: string;

                if (isFinalized) {
                    if (isSuccessful) {
                        transactionStatus = 'FINALIZED_SUCCESS';
                        statusDescription = `Transaction finalisée avec succès sur ${found.chainName} (${confirmations} confirmations)`;
                    } else {
                        transactionStatus = 'FINALIZED_FAILED';
                        statusDescription = `Transaction finalisée mais échouée sur ${found.chainName} (revert)`;
                    }
                } else {
                    if (isSuccessful) {
                        transactionStatus = 'CONFIRMED_SUCCESS';
                        statusDescription = `Transaction confirmée avec succès sur ${found.chainName} (${confirmations} confirmations)`;
                    } else {
                        transactionStatus = 'CONFIRMED_FAILED';
                        statusDescription = `Transaction confirmée mais échouée sur ${found.chainName} (revert)`;
                    }
                }

                return {
                    success: true,
                    data: {
                        chainName: found.chainName,
                        chainId: found.chainId,
                        blockNumber,
                        confirmations,
                        error: isSuccessful ? null : receipt.status,
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
