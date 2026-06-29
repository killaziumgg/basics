import { writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"

// chain = nom court (= dossier + suffixe fichier), coin natif, RPC public
const CHAINS = [
  { short: 'base',     coin: 'ETH', rpc: 'https://base-rpc.publicnode.com' },
  { short: 'optimism', coin: 'ETH', rpc: 'https://optimism-rpc.publicnode.com' },
  { short: 'arbitrum', coin: 'ETH', rpc: 'https://arbitrum-one-rpc.publicnode.com' },
  { short: 'polygon',  coin: 'POL', rpc: 'https://polygon-bor-rpc.publicnode.com' },
  { short: 'bsc',      coin: 'BNB', rpc: 'https://bsc-rpc.publicnode.com' },
]

const OUT_DIR = 'exempleresponse'

async function rpc(url: string, method: string, params: any[]) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const json = await res.json()
  return json.result
}

// envoi du coin natif = pas de data (input 0x) + un montant non nul + un destinataire
function isNativeTransfer(tx: any) {
  return tx && tx.to && tx.input === '0x' && tx.value && tx.value !== '0x0'
}

// node gen_examples.ts <chain>  -> ne traite que cette chain ; sinon toutes
const only = process.argv[2]
const chains = only ? CHAINS.filter((c) => c.short === only) : CHAINS

for (const c of chains) {
  let blockNum = BigInt(await rpc(c.rpc, 'eth_blockNumber', []))
  let hash: string | null = null

  // on remonte les blocs récents jusqu'à trouver un envoi natif
  for (let i = 0; i < 400 && !hash; i++) {
    const block = await rpc(c.rpc, 'eth_getBlockByNumber', ['0x' + blockNum.toString(16), true])
    const tx = block?.transactions?.find(isNativeTransfer)
    if (tx) hash = tx.hash
    blockNum -= 1n
  }

  if (!hash) {
    console.log(`❌ ${c.short}: aucun envoi natif trouvé dans les 15 derniers blocs`)
    continue
  }

  // on récupère la tx au format exact eth_getTransactionByHash
  const result = await rpc(c.rpc, 'eth_getTransactionByHash', [hash])
  const envelope = { jsonrpc: '2.0', id: 1, result }

  const dir = join(OUT_DIR, c.short)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `eth_getTransactionByHash_${c.short}.json`)
  writeFileSync(file, JSON.stringify(envelope, null, 2) + '\n')

  const amount = Number(BigInt(result.value)) / 1e18
  console.log(`✅ ${c.short.padEnd(9)} ${amount.toFixed(6)} ${c.coin}  ${hash}  -> ${file}`)
}
