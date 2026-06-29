import express from "express";
import { SolanaBlock, EVMBlock, BitcoinBlock } from "../../modules/block.ts";

const router = express.Router();

const solBlock = new SolanaBlock();
const evmBlock = new EVMBlock();
const btcBlock = new BitcoinBlock();

router.get("/", async (_req, res) => {
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

router.get("/:chain", async (req, res) => {
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

export default router;
