import express from "express";
import { SolanaCongestion, EVMCongestion, BitcoinCongestion } from "../../modules/congestion.ts";

const router = express.Router();

const solCongestion = new SolanaCongestion();
const evmCongestion = new EVMCongestion();
const btcCongestion = new BitcoinCongestion();

router.get("/", async (_req, res) => {
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

router.get("/:chain", async (req, res) => {
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

export default router;
