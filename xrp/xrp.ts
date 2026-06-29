import { Client, dropsToXrp } from "xrpl";

export async function getStatus(client: Client, hash: string) {
  try {
    const { result } = await client.request({ command: "tx", transaction: hash });
    if (!result.validated) return "PENDING";
    return (result.meta as any)?.TransactionResult === "tesSUCCESS" ? "SUCCESS" : "FAILED";
  } catch (e: any) {
    if (e?.data?.error === "txnNotFound") return "NOT_FOUND";
    throw e;
  }
}

export async function getTransaction(client: Client, hash: string) {
  const { result } = await client.request({ command: "tx", transaction: hash });
  const t = result.tx_json as any;
  const meta = result.meta as any;
  const a = meta?.delivered_amount;

  return {
    type: t.TransactionType,
    from: t.Account,
    to: t.Destination ?? null,
    amount: typeof a === "string" ? Number(dropsToXrp(a)) : a?.value ?? null,
    asset: typeof a === "string" ? "XRP" : a?.currency ?? null,
    fee: Number(dropsToXrp(t.Fee)),
    status: meta?.TransactionResult,
    ledger: result.ledger_index,
  };
}

export async function isCongested(client: Client) {
  const { result } = await client.request({ command: "fee" });
  return {
    congested: Number(result.drops.open_ledger_fee) > Number(result.drops.base_fee),
    queueSize: Number(result.current_queue_size),
  };
}
