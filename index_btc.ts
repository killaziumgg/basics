export {}

const API = 'https://mempool.space/api'

const txid = 'ffc6ff7c1e056bf02815cb2fd6992bf2bf7035086d9b95d596486b61cb59443c'

async function getTransaction(hash: string) {
  const res = await fetch(`${API}/tx/${hash}`)
  return await res.json()
}

const tx = await getTransaction(txid)

console.log(`txid    : ${tx.txid}`)
console.log(`statut  : ${tx.status.confirmed ? 'confirmée (block ' + tx.status.block_height + ')' : 'en attente'}`)
console.log(`frais   : ${tx.fee / 100_000_000} BTC`)

console.log(`\nEntrées (${tx.vin.length}) :`)
for (const vin of tx.vin) {
  console.log(`  ${vin.prevout.scriptpubkey_address}  ->  ${vin.prevout.value / 100_000_000} BTC`)
}

console.log(`\nSorties (${tx.vout.length}) :`)
for (const vout of tx.vout) {
  console.log(`  ${vout.scriptpubkey_address}  ->  ${vout.value / 100_000_000} BTC`)
}
