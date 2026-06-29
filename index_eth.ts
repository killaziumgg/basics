export {}

// Quelques chains EVM avec un RPC public (publicnode)
const CHAINS = [
  { name: 'Ethereum',  chainId: 1,     rpc: 'https://ethereum-rpc.publicnode.com' },
  { name: 'Base',      chainId: 8453,  rpc: 'https://base-rpc.publicnode.com' },
  { name: 'Optimism',  chainId: 10,    rpc: 'https://optimism-rpc.publicnode.com' },
  { name: 'Arbitrum',  chainId: 42161, rpc: 'https://arbitrum-one-rpc.publicnode.com' },
  { name: 'Polygon',   chainId: 137,   rpc: 'https://polygon-bor-rpc.publicnode.com' },
  { name: 'BNB Chain', chainId: 56,    rpc: 'https://bsc-rpc.publicnode.com' },
]

const txHash = '0x9de4f1ed38af6f007702d9447b3c06e2fc247c7ba60c101d9ae9d5447cc75f74'

// Demande la tx à un RPC ; renvoie la tx ou null si elle n'existe pas sur cette chain
async function getTx(rpc: string, hash: string) {
  try {
    const res = await fetch(rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionByHash', params: [hash] }),
    })
    const json = await res.json()
    return json.result ?? null
  } catch {
    return null // RPC injoignable / rate-limit
  }
}

// On interroge toutes les chains en parallèle
const results = await Promise.all(
  CHAINS.map(async (c) => ({ chain: c, tx: await getTx(c.rpc, txHash) }))
)

const found = results.filter((r) => r.tx !== null)

if (found.length === 0) {
  console.log('Transaction introuvable sur les chains testées.')
} else {
  for (const f of found) {
    console.log(`✅ ${f.chain.name} (chainId ${f.chain.chainId})`)
    console.log(`   block   : ${BigInt(f.tx.blockNumber)}`)
    console.log(`   from    : ${f.tx.from}`)
    console.log(`   to      : ${f.tx.to}`)
    if (f.tx.chainId) console.log(`   chainId dans la tx : ${BigInt(f.tx.chainId)}`)
  }
}
