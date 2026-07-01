import "dotenv/config";
import { App } from "@microsoft/teams.apps";
import { DevtoolsPlugin } from "@microsoft/teams.dev";
import { Solana } from "../new/modules/solana.ts";
import { EVM } from "../new/modules/evm.ts";
import { Bitcoin } from "../new/modules/btc.ts";

const app = new App({ plugins: [new DevtoolsPlugin()] });

const sol = new Solana();
const evm = new EVM();
const btc = new Bitcoin();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function detect(value: string): { chain: "EVM" | "Solana" | "Bitcoin"; kind: "address" | "tx" } | null {
    if (/^0x[0-9a-fA-F]{40}$/.test(value)) return { chain: "EVM", kind: "address" };
    if (/^0x[0-9a-fA-F]{64}$/.test(value)) return { chain: "EVM", kind: "tx" };
    if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value)) return { chain: "EVM", kind: "address" };
    if (/^bc1[0-9a-z]{6,87}$/.test(value)) return { chain: "Bitcoin", kind: "address" };
    if (/^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(value)) return { chain: "Bitcoin", kind: "address" };
    if (/^[0-9a-fA-F]{64}$/.test(value)) return { chain: "Bitcoin", kind: "tx" };
    if (/^[1-9A-HJ-NP-Za-km-z]{86,90}$/.test(value)) return { chain: "Solana", kind: "tx" };
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return { chain: "Solana", kind: "address" };
    return null;
}

app.on("message", async ({ activity, send }) => {
    const value = (activity.text ?? "").trim();
    const conversationId = activity.conversation.id;

    if (!value) {
        await send("Colle une adresse ou un hash de transaction.");
        return;
    }

    await send("Analyse en cours...");

    check(value)
        .then((message) => app.send(conversationId, message))
        .catch((err) => app.send(conversationId, `Erreur : ${err.message}`));
});

async function check(value: string): Promise<string> {
    const info = detect(value);
    if (!info) return "Format non reconnu.";

    if (info.kind === "address") {
        if (info.chain === "EVM") {
            const native = await evm.get_eth_Balance(value);
            return `Adresse EVM\n${value}\nSolde : ${JSON.stringify(native.balances ?? native)}`;
        }
        if (info.chain === "Solana") {
            const native = await sol.get_sol_Balance(value);
            return `Adresse Solana\n${value}\nSolde : ${native.balance ?? "-"}`;
        }
        const native = await btc.get_btc_Balance(value);
        return `Adresse Bitcoin\n${value}\nSolde : ${native.balance ?? "-"}`;
    }

    const client = info.chain === "EVM" ? evm : info.chain === "Bitcoin" ? btc : sol;

    for (let i = 0; i < 60; i++) {
        const status = await client.getStatus(value);
        const s = status?.data?.transactionStatus;

        if (s === "FINALIZED_SUCCESS") return `Transaction finalisee sur ${info.chain}\n${value}`;
        if (typeof s === "string" && (s.endsWith("_FAILED") || s === "DROPPED" || s === "EXPIRED_OR_NOT_FOUND")) {
            return `Transaction non confirmee (${s}) sur ${info.chain}\n${value}`;
        }

        await sleep(5000);
    }

    return `Toujours en attente sur ${info.chain}\n${value}`;
}

const port = Number(process.env.PORT) || 3978;
app.start(port);
