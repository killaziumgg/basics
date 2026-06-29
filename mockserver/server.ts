import express from "express";
import { Solana } from "../new/modules/solana.ts";
import { EVM } from "../new/modules/evm.ts";
import { Bitcoin } from "../new/modules/btc.ts";
import config from "../new/input/config.json" with { type: "json" };
import { mockFetch } from "./mockfetch.ts";

globalThis.fetch = mockFetch as any;

const app = express();
const PORT = 3001;

const sol = new Solana();
const evm = new EVM();
const btc = new Bitcoin();

type Chain = "EVM" | "Solana" | "Bitcoin";
type Detection = { chain: Chain; kind: "address" | "tx" };

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

    if (/^bc1[0-9a-z]{6,87}$/.test(value)) return { chain: "Bitcoin", kind: "address" };
    if (/^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(value)) return { chain: "Bitcoin", kind: "address" };

    if (/^[0-9a-fA-F]{64}$/.test(value)) return { chain: "Bitcoin", kind: "tx" };

    if (/^[1-9A-HJ-NP-Za-km-z]{86,90}$/.test(value)) return { chain: "Solana", kind: "tx" };

    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return { chain: "Solana", kind: "address" };

    return null;
}

app.get("/", (_req, res) => {
    res.json({ status: "ok", mock: true });
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

            const native = await sol.get_sol_Balance(value);
            const tokens = await sol.get_spltoken_balance(value);
            res.json({
                success: true,
                type: "address",
                chain: "Solana",
                address: value,
                balances: {
                    native: native.balance ?? null,
                    tokens: tokens.holdings ?? []
                }
            });
            return;
        }

        const client: any = info.chain === "Bitcoin" ? btc : info.chain === "EVM" ? evm : sol;

        let aborted = false;
        req.on("close", () => { aborted = true; });

        let status: any;
        let outcome: "passed" | "error" | null = null;
        let absentCycles = 0;
        let rpcFailures = 0;

        while (outcome === null && !aborted) {
            status = await client.getStatus(value);
            const phase = classify(status);

            if (phase === "passed") { outcome = "passed"; break; }
            if (phase === "failed") { outcome = "error"; break; }

            if (phase === "rpc_fail") {
                if (++rpcFailures >= MAX_RPC_FAILURES) {
                    if (!aborted) {
                        res.status(502).json({
                            success: false,
                            type: "transaction",
                            chain: info.chain,
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

        const details = await client.getTransaction(value);
        res.json({
            success: true,
            type: "transaction",
            chain: status?.data?.chainName ?? info.chain,
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

const server = app.listen(PORT, () => {
    console.log(`Mock API démarrée sur http://localhost:${PORT}`);
});
server.requestTimeout = 0;
