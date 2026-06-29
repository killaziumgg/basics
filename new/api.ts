import express from "express";
import { Solana } from "./modules/solana.ts";
import { EVM } from "./modules/evm.ts";
import { Bitcoin } from "./modules/btc.ts";
import { SolanaCongestion, EVMCongestion, BitcoinCongestion } from "./modules/congestion.ts";
import { SolanaBlock, EVMBlock, BitcoinBlock } from "./modules/block.ts";
import config from "./input/config.json" with { type: "json" };
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = 3000;

// Sert le front (page unique) depuis new/public à la même origine que l'API → aucun souci de CORS.
app.use(express.static(path.join(__dirname, "public")));

const sol = new Solana();
const evm = new EVM();
const btc = new Bitcoin();

const solCongestion = new SolanaCongestion();
const evmCongestion = new EVMCongestion();
const btcCongestion = new BitcoinCongestion();

const solBlock = new SolanaBlock();
const evmBlock = new EVMBlock();
const btcBlock = new BitcoinBlock();

type Chain = "EVM" | "Solana" | "Bitcoin";
type Detection = { chain: Chain; kind: "address" | "tx"; alt?: "Tron" };

const POLL_INTERVAL_MS = Number(config.pollIntervalSeconds) * 1000 || 5000;
const ABSENCE_GRACE_CYCLES = 10;
const MAX_RPC_FAILURES = 3;

const ABSENCE_STATES = new Set(["DROPPED", "EXPIRED_OR_NOT_FOUND"]);

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

type Phase = "passed" | "failed" | "absent" | "pending" | "rpc_fail";

function classify(status: any): Phase {
    if (status?.success !== true || !status.data) return "rpc_fail";
    const s = status.data.transactionStatus;
    if (typeof s !== "string") return "pending";
    if (s === "FINALIZED_SUCCESS") return "passed";
    if (s.endsWith("_FAILED")) return "failed";
    if (ABSENCE_STATES.has(s)) return "absent";
    return "pending";
}

function detect(value: string): Detection | null {
    if (/^0x[0-9a-fA-F]{40}$/.test(value)) return { chain: "EVM", kind: "address" };
    if (/^0x[0-9a-fA-F]{64}$/.test(value)) return { chain: "EVM", kind: "tx" };

    // TRON : adresse Base58 commençant par 'T' (34 caractères). Rattachée à l'EVM (JSON-RPC eth de TRON).
    // À tester AVANT Solana, dont la regex Base58 capturerait aussi ces adresses.
    if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value)) return { chain: "EVM", kind: "address" };

    if (/^bc1[0-9a-z]{6,87}$/.test(value)) return { chain: "Bitcoin", kind: "address" };
    if (/^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(value)) return { chain: "Bitcoin", kind: "address" };

    // Hash 64-hex sans préfixe : format identique pour Bitcoin ET TRON → ambigu, on sondera les deux.
    if (/^[0-9a-fA-F]{64}$/.test(value)) return { chain: "Bitcoin", kind: "tx", alt: "Tron" };

    if (/^[1-9A-HJ-NP-Za-km-z]{86,90}$/.test(value)) return { chain: "Solana", kind: "tx" };

    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return { chain: "Solana", kind: "address" };

    return null;
}

app.get("/", (_req, res) => {
    res.json({ status: "ok" });
});

// Expose la config (notamment pollIntervalSeconds) au front.
app.get("/config", (_req, res) => {
    res.json(config);
});

app.get("/check/:value", async (req, res) => {
    const value = req.params.value;
    const info = detect(value);

    if (!info) {
        res.status(400).json({
            success: false,
            error: "Format non reconnu (ni adresse ni hash de transaction connu)."
        });
        return;
    }

    try {
        if (info.kind === "address") {
            if (info.chain === "Bitcoin") {
                const bal = await btc.get_btc_Balance(value);
                res.json({
                    success: bal.success === true,
                    type: "address",
                    chain: "Bitcoin",
                    address: value,
                    balances: { native: bal.balance ?? null },
                    error: bal.error
                });
                return;
            }

            if (info.chain === "EVM") {
                const native = await evm.get_eth_Balance(value);
                const tokens = await evm.get_erc20token_balance(value);
                res.json({
                    success: true,
                    type: "address",
                    chain: "EVM",
                    address: value,
                    balances: {
                        native: native.balances ?? [],
                        tokens: tokens.holdings ?? []
                    }
                });
                return;
            }

            if (info.chain === "Solana") {
                const native = await sol.get_sol_Balance(value);
                const tokens = await sol.get_spltoken_balance(value);
                res.json({
                    success: native.success === true,
                    type: "address",
                    chain: "Solana",
                    address: value,
                    balances: {
                        native: native.balance ?? null,
                        tokens: tokens.holdings ?? []
                    },
                    error: native.error
                });
                return;
            }
        }

        type Candidate = { client: any; value: string; chain: string };
        let candidates: Candidate[];

        if (info.alt === "Tron") {
            // Hash 64-hex ambigu (même format Bitcoin et TRON) : on sonde Bitcoin puis TRON.
            // Le JSON-RPC eth de TRON attend le hash préfixé de "0x".
            candidates = [
                { client: btc, value, chain: "Bitcoin" },
                { client: evm, value: "0x" + value, chain: "Tron" }
            ];
        } else {
            const client = info.chain === "Bitcoin" ? btc : info.chain === "EVM" ? evm : sol;
            candidates = [{ client, value, chain: info.chain }];
        }

        let aborted = false;
        req.on("close", () => { aborted = true; });

        // Résolution de la chaîne qui détient réellement la tx. On utilise getTransaction (appel unique)
        // plutôt que getStatus (qui réessaie 30× et bloquerait ~30 s sur les chaînes qui ne l'ont pas).
        let active: Candidate | null = candidates.length === 1 ? candidates[0] : null;

        if (!active) {
            const RESOLVE_INTERVAL_MS = Math.min(POLL_INTERVAL_MS, 3000);
            let resolveRounds = 0;

            while (active === null && !aborted) {
                const probes = await Promise.all(candidates.map(async (c) => ({
                    candidate: c,
                    found: await c.client.getTransaction(c.value).then((r: any) => r?.success === true).catch(() => false)
                })));

                const hit = probes.find((p) => p.found);   // ordre des candidats = Bitcoin d'abord, puis TRON
                if (hit) { active = hit.candidate; break; }

                if (++resolveRounds >= ABSENCE_GRACE_CYCLES) break;
                if (!aborted) await sleep(RESOLVE_INTERVAL_MS);
            }

            if (aborted) return;

            if (!active) {
                res.json({
                    success: true,
                    type: "transaction",
                    chain: info.chain,
                    hash: value,
                    passed: false,
                    details: null,
                    status: {
                        transactionStatus: "EXPIRED_OR_NOT_FOUND",
                        statusDescription: "Transaction introuvable sur Bitcoin ni TRON."
                    }
                });
                return;
            }
        }

        let status: any;
        let outcome: "passed" | "error" | null = null;
        let absentCycles = 0;
        let rpcFailures = 0;

        while (outcome === null && !aborted) {
            status = await active.client.getStatus(active.value);
            const phase = classify(status);

            if (phase === "passed") { outcome = "passed"; break; }
            if (phase === "failed") { outcome = "error"; break; }

            if (phase === "rpc_fail") {
                if (++rpcFailures >= MAX_RPC_FAILURES) {
                    if (!aborted) {
                        res.status(502).json({
                            success: false,
                            type: "transaction",
                            chain: active.chain,
                            hash: value,
                            error: status?.error ?? { message: "RPC indisponible" }
                        });
                    }
                    return;
                }
            } else {
                rpcFailures = 0;
                if (phase === "absent") {
                    if (++absentCycles >= ABSENCE_GRACE_CYCLES) { outcome = "error"; break; }
                } else {
                    absentCycles = 0;
                }
            }

            if (!aborted) await sleep(POLL_INTERVAL_MS);
        }

        if (aborted) return;

        const details = await active.client.getTransaction(active.value);
        res.json({
            success: true,
            type: "transaction",
            chain: status?.data?.chainName ?? active.chain,
            hash: value,
            passed: outcome === "passed",
            details: details?.data ?? null,
            status: status.data ?? status.error
        });
    } catch (e) {
        res.status(500).json({
            success: false,
            error: e instanceof Error ? e.message : String(e)
        });
    }
});

app.get("/congestion", async (_req, res) => {
    try {
        const [solana, evmChains, bitcoin] = await Promise.all([
            solCongestion.isCongested(),
            evmCongestion.isCongested(),
            btcCongestion.isCongested()
        ]);

        res.json({
            success: true,
            congestion: {
                solana,
                evm: evmChains,
                bitcoin
            }
        });
    } catch (e) {
        res.status(500).json({
            success: false,
            error: e instanceof Error ? e.message : String(e)
        });
    }
});

app.get("/congestion/:chain", async (req, res) => {
    const chain = req.params.chain.toLowerCase();

    try {
        if (chain === "solana" || chain === "sol") {
            res.json(await solCongestion.isCongested());
            return;
        }
        if (chain === "evm" || chain === "eth" || chain === "ethereum") {
            res.json(await evmCongestion.isCongested());
            return;
        }
        if (chain === "bitcoin" || chain === "btc") {
            res.json(await btcCongestion.isCongested());
            return;
        }

        res.status(400).json({
            success: false,
            error: `Chain inconnue : ${req.params.chain} (attendu : solana, evm ou bitcoin)`
        });
    } catch (e) {
        res.status(500).json({
            success: false,
            error: e instanceof Error ? e.message : String(e)
        });
    }
});

app.get("/block", async (_req, res) => {
    try {
        const [solana, evmChains, bitcoin] = await Promise.all([
            solBlock.getCurrentBlock(),
            evmBlock.getCurrentBlock(),
            btcBlock.getCurrentBlock()
        ]);

        res.json({
            success: true,
            blocks: {
                solana,
                evm: evmChains,
                bitcoin
            }
        });
    } catch (e) {
        res.status(500).json({
            success: false,
            error: e instanceof Error ? e.message : String(e)
        });
    }
});

app.get("/block/:chain", async (req, res) => {
    const chain = req.params.chain.toLowerCase();

    try {
        if (chain === "solana" || chain === "sol") {
            res.json(await solBlock.getCurrentBlock());
            return;
        }
        if (chain === "evm" || chain === "eth" || chain === "ethereum") {
            res.json(await evmBlock.getCurrentBlock());
            return;
        }
        if (chain === "bitcoin" || chain === "btc") {
            res.json(await btcBlock.getCurrentBlock());
            return;
        }

        res.status(400).json({
            success: false,
            error: `Chain inconnue : ${req.params.chain} (attendu : solana, evm ou bitcoin)`
        });
    } catch (e) {
        res.status(500).json({
            success: false,
            error: e instanceof Error ? e.message : String(e)
        });
    }
});

const server = app.listen(PORT, () => {
    console.log(`API démarrée sur http://localhost:${PORT}`);
});
server.requestTimeout = 0;
