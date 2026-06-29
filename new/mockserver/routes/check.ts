import express from "express";
import { Solana } from "../../modules/solana.ts";
import { EVM } from "../../modules/evm.ts";
import { Bitcoin } from "../../modules/btc.ts";
import config from "../../input/config.json" with { type: "json" };

const router = express.Router();

const sol = new Solana();
const evm = new EVM();
const btc = new Bitcoin();

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

// Détection alignée sur api.ts : même gestion TRON (adresse T... → EVM, hash 64-hex ambigu Bitcoin/TRON).
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

router.get("/:value", async (req, res) => {
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

        // Résolution de la chaîne qui détient réellement la tx via getTransaction (appel unique)
        // plutôt que getStatus (qui réessaie et bloquerait sur les chaînes qui ne l'ont pas).
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

export default router;
