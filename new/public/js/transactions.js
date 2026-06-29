// Suivi d'une transaction : création de la carte de résultat, interrogation de
// l'API (bloquante) et rendu de l'état terminal.
import { api, settings } from "./config.js";
import { esc, fmtNum, fmtBlockTime } from "./format.js";
import { $, cardHead } from "./dom.js";
import { createJob } from "./store.js";
import { on, emit } from "./events.js";

const results = $("#results");

// Lance le suivi d'une transaction et affiche sa carte.
export function handleTx(value, info) {
    const job = createJob(value, info.chain);

    const card = document.createElement("div");
    card.className = "card";
    card.dataset.job = job.id;
    results.appendChild(card);
    renderTxCard(job);

    // L'endpoint /check est bloquant : il poll côté serveur toutes les settings.pollMs
    // et ne répond qu'à l'état terminal.
    api("/check/" + encodeURIComponent(value))
        .then((data) => {
            job.state = data.passed ? "success" : "failed";
            job.result = data;
            if (data.chain) job.chain = data.chain;   // chaîne réelle résolue côté serveur
        })
        .catch((err) => { job.state = "error"; job.error = err.message || String(err); })
        .finally(() => {
            renderTxCard(job);
            emit("job:resolved", job);   // → le tiroir se met à jour et notifie l'OS si suivi
        });
}

function txStateLabel(job) {
    if (job.state === "pending") return `<span class="spinner"></span>En attente de finalisation…`;
    if (job.state === "success") return `✓ Transaction finalisée avec succès`;
    if (job.state === "error")   return `✗ Erreur réseau : ${esc(job.error || "")}`;
    return `✗ Transaction non finalisée / échouée`;
}

export function renderTxCard(job) {
    const card = results.querySelector(`.card[data-job="${job.id}"]`);
    if (!card) return;

    let html = cardHead(job.chain, "Transaction", job.value);
    html += `<div class="state ${job.state}">${txStateLabel(job)}</div>`;

    if (job.state === "pending") {
        html += `<div class="tx-actions">
            ${job.notified
                ? `<button class="btn-notify done">✓ Suivie dans les notifications</button>`
                : `<button class="btn-notify" data-track="${job.id}">🔔 Notifier</button>`}
            <span class="ago" data-since="${job.startedAt}">en attente depuis 0 s</span>
        </div>
        <div class="hint tx-hint">Vérification automatique côté serveur toutes les ${settings.pollMs / 1000} s.</div>`;
    } else {
        const st = job.result?.status;
        if (st?.statusDescription) html += `<div class="kvs kvs-1"><div class="kv"><span>Statut</span><b>${esc(st.statusDescription)}</b></div></div>`;
        const det = job.result?.details;
        if (det && (det.from || det.to || det.amount != null)) html += transferHTML(det);
        if (det) html += `<div class="kvs">${kvGrid(det, ["transaction", "inputs", "outputs", "from", "to", "amount", "asset", "type", "value"])}</div>`;
        if (job.result) html += `<details class="raw"><summary>Réponse brute de l'API</summary><pre>${esc(JSON.stringify(job.result, null, 2))}</pre></details>`;
    }
    card.innerHTML = html;
}

function transferHTML(det) {
    const amt = det.amount != null && isFinite(det.amount) ? fmtNum(det.amount) : "—";
    return `<div class="transfer">
        <div class="amt">${amt} <span>${esc(det.asset || "")}</span></div>
        <div class="flow">
            <div class="leg"><label>De</label><code>${esc(det.from || "—")}</code></div>
            <div class="ar">↓</div>
            <div class="leg"><label>À</label><code>${esc(det.to || "—")}</code></div>
        </div>
    </div>`;
}

function kvGrid(obj, skip) {
    skip = skip || [];
    const moneyKeys = ["value", "fee"];
    return Object.entries(obj)
        .filter(([k, v]) => !skip.includes(k) && (typeof v !== "object" || v === null))
        .map(([k, v]) => {
            let val;
            if (k === "blockTime" && typeof v === "number") val = fmtBlockTime(v);
            else if (moneyKeys.includes(k) && typeof v === "number") val = fmtNum(v);
            else val = (v === null ? "—" : String(v));
            return `<div class="kv"><span>${esc(k)}</span><b>${esc(val)}</b></div>`;
        })
        .join("");
}

// Câblage : clic « Notifier » (délégué) → demande de suivi, et rafraîchissement
// de la carte quand le suivi est (dé)activé.
export function wireTransactions() {
    results.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-track]");
        if (btn) emit("track:add", Number(btn.dataset.track));
    });
    on("job:tracked", (job) => renderTxCard(job));
}
