// Panneau « état des réseaux » (bas gauche) : dernier bloc et congestion par chaîne.
import { api, settings } from "./config.js";
import { esc, fmtNum } from "./format.js";
import { $ } from "./dom.js";

const chainBody = $("#chainBody");

const CHAIN_DEFS = [
    { key: "bitcoin",  name: "Bitcoin"  },
    { key: "ethereum", name: "Ethereum", chainId: 1 },
    { key: "base",     name: "Base",     chainId: 8453 },
    { key: "tron",     name: "Tron",     chainId: 728126428 },
    { key: "solana",   name: "Solana"   },
];

let lastChains = null;

const evmEntry = (arr, id) => (Array.isArray(arr) ? arr.find((x) => x.chainId === id) : null) || null;

// Extrait { block, congestion } pour une chaîne donnée depuis les dernières données récupérées.
function pickChain(def) {
    const blocks = lastChains?.blocks || {};
    const cong = lastChains?.cong || {};
    let block = null, congestion = null;

    if (def.chainId) {
        block = evmEntry(blocks.evm?.data, def.chainId);
        congestion = evmEntry(cong.evm?.data, def.chainId);
    } else {
        block = blocks[def.key]?.data || null;       // { blockNumber, timestamp }
        congestion = cong[def.key]?.data || null;    // { isCongested, metric, unit, description }
    }
    return { block, congestion };
}

async function refreshChains() {
    try {
        const [blocks, cong] = await Promise.all([api("/block"), api("/congestion")]);
        lastChains = { blocks: blocks.blocks || {}, cong: cong.congestion || {} };
    } catch {
        lastChains = lastChains || { blocks: {}, cong: {} };
    }
    renderChains();
}

function renderChains() {
    chainBody.innerHTML = CHAIN_DEFS.map((def) => {
        const { block, congestion } = pickChain(def);

        const blockNum = block && isFinite(block.blockNumber) ? Number(block.blockNumber).toLocaleString("fr-FR") : "—";
        const ts = block?.timestamp;

        let chip;
        if (!congestion) chip = `<span class="chip unk"><span class="d"></span>Inconnu</span>`;
        else if (congestion.isCongested) chip = `<span class="chip bad"><span class="d"></span>Congestionné</span>`;
        else chip = `<span class="chip ok"><span class="d"></span>Fluide</span>`;

        const metric = congestion ? `${fmtNum(congestion.metric)} ${esc(congestion.unit || "")}` : "—";
        const ago = ts ? `<span data-ago="${ts}">il y a 0 s</span>` : "dernier bloc indisponible";

        return `<div class="chain-row">
            <div class="info">
                <div class="name">${def.name}</div>
                <div class="sub">Bloc #${blockNum} · ${metric}</div>
                <div class="ago">Vérifié ${ago}</div>
            </div>
            <div class="right">${chip}</div>
        </div>`;
    }).join("");
}

// Démarre le panneau : premier chargement puis rafraîchissement périodique.
export async function startChains() {
    await refreshChains();
    setInterval(refreshChains, settings.pollMs);
}
