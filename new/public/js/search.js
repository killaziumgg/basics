// Barre de recherche + affichage des résultats d'adresse (soldes).
// Les transactions sont déléguées au module transactions.js.
import { api } from "./config.js";
import { esc, fmtNum } from "./format.js";
import { $, cardHead } from "./dom.js";
import { detect } from "./detect.js";
import { handleTx } from "./transactions.js";

const results = $("#results");

// Câble la soumission du formulaire de recherche.
export function wireSearch() {
    $("#searchForm").addEventListener("submit", (e) => {
        e.preventDefault();
        const value = $("#searchInput").value.trim();
        if (!value) return;
        results.innerHTML = "";

        const info = detect(value);
        if (!info) {
            results.innerHTML = `<div class="card"><div class="errbox">Format non reconnu : ni adresse ni hash de transaction connu.</div></div>`;
            return;
        }

        if (info.kind === "address") handleAddress(value, info);
        else handleTx(value, info);
    });
}

async function handleAddress(value, info) {
    const label = info.display || info.chain;   // ex. « Tron » pour une adresse T... rattachée à l'EVM
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = cardHead(label, "Adresse", value) +
        `<div class="state pending"><span class="spinner"></span>Chargement du solde…</div>`;
    results.appendChild(card);

    try {
        const data = await api("/check/" + encodeURIComponent(value));
        card.innerHTML = cardHead(info.display || data.chain || info.chain, "Adresse", value) + renderBalances(data, info);
    } catch (err) {
        card.innerHTML = cardHead(label, "Adresse", value) +
            `<div class="errbox">Erreur réseau : ${esc(err.message || err)}. L'API (port 3000) tourne-t-elle ?</div>`;
    }
}

function balRow(label, value, unit) {
    return `<div class="bal"><span class="label">${esc(label)}</span><span class="v">${fmtNum(value)} <i>${esc(unit || "")}</i></span></div>`;
}

function renderBalances(data, info) {
    const chain = data.chain || info.chain;
    const b = data.balances || {};

    if (chain === "Bitcoin") {
        if (data.success !== true || b.native == null)
            return `<div class="errbox">${esc(data.error?.message || "Solde indisponible.")}</div>`;
        return balRow("Solde natif", b.native, "BTC");
    }

    if (chain === "EVM") {
        let rows = "";
        (b.native || []).forEach((n) => { rows += balRow(n.chainName + " · natif", n.balance, n.symbol || "ETH"); });
        (b.tokens || []).forEach((t) => { rows += balRow(t.chainName + " · " + t.token, t.balance, t.token); });
        return rows || `<div class="empty">Aucun solde trouvé sur les chaînes EVM testées.</div>`;
    }

    if (chain === "Solana") {
        if (data.success !== true || b.native == null)
            return `<div class="errbox">${esc(data.error?.message || "Solde indisponible.")}</div>`;
        let rows = balRow("Solde natif", b.native, "SOL");
        (b.tokens || []).forEach((o) => {
            const k = Object.keys(o)[0];
            rows += balRow("Token", o[k], k);
        });
        return rows;
    }

    return `<details class="raw" open><summary>Réponse brute</summary><pre>${esc(JSON.stringify(data, null, 2))}</pre></details>`;
}
