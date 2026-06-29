import { Client } from "xrpl";

async function getStatus(client, hash) {
  try {
    const { result } = await client.request({ command: "tx", transaction: hash });

    if (!result.validated) return "PENDING";
    return result.meta?.TransactionResult === "tesSUCCESS" ? "SUCCESS" : "FAILED";
  } catch (error) {
    if (error?.data?.error === "txnNotFound") return "NOT_FOUND";
    throw error;
  }
}

const client = new Client("wss://xrplcluster.com");
await client.connect();

const hash = "0A2FD80F17FF6B288BD7E1E44328DBC398AA6EF0A70A9A438E8BA8E5F7243B82";
const status = await getStatus(client, hash);

console.log("Statut :", status);

await client.disconnect();
