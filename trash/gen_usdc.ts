import { writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"

// Adresse du USDC natif (Circle) par chain + RPC public
const CHAINS = [
  { short: 'base',     usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', rpc: 'https://base-rpc.publicnode.com' },
  { short: 'optimism', usdc: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', rpc: 'https://optimism-rpc.publicnode.com' },
  { short: 'arbitrum', usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', rpc: 'https://arbitrum-one-rpc.publicnode.com' },
  { short: 'polygon',  usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', rpc: 'https://polygon-bor-rpc.publicnode.com' },
  { short: 'bsc',      usdc: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', rpc: 'https://bsc-rpc.publicnode.com' },
]

const OUT_DIR = 'exempleresponse'
const TRANSFER = '0xa9059cbb' // selecteur de transfer(address,uint256)

async function rpc(url: string, method: string, params: any[]) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const json = await res.json()
  return json.result
}

// envoi d'USDC = transfer() vers le contrat USDC de la chain
function isUsdcTransfer(tx: any, usdc: string) {
  return tx && tx.to && tx.to.toLowerCase() === usdc.toLowerCase()
    && typeof tx.input === 'string' && tx.input.startsWith(TRANSFER)
}

// lit un uint via eth_call (decimals)
async function callUint(rpcUrl: string, to: string, selector: string) {
  const r = await rpc(rpcUrl, 'eth_call', [{ to, data: selector }, 'latest'])
  return BigInt(r)
}

const only = process.argv[2]
const chains = only ? CHAINS.filter((c) => c.short === only) : CHAINS

for (const c of chains) {
  let blockNum = BigInt(await rpc(c.rpc, 'eth_blockNumber', []))
  let hash: string | null = null

  for (let i = 0; i < 400 && !hash; i++) {
    const block = await rpc(c.rpc, 'eth_getBlockByNumber', ['0x' + blockNum.toString(16), true])
    const tx = block?.transactions?.find((t: any) => isUsdcTransfer(t, c.usdc))
    if (tx) hash = tx.hash
    blockNum -= 1n
  }

  if (!hash) {
    console.log(`❌ ${c.short}: aucun transfer USDC trouvé`)
    continue
  }

  const result = await rpc(c.rpc, 'eth_getTransactionByHash', [hash])
  const envelope = { jsonrpc: '2.0', id: 1, result }

  const dir = join(OUT_DIR, c.short)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `eth_getTransactionByHash_usdc_${c.short}.json`)
  writeFileSync(file, JSON.stringify(envelope, null, 2) + '\n')

  // verification + montant : symbol() doit valoir USDC, montant = 32 derniers octets de input
  const decimals = await callUint(c.rpc, c.usdc, '0x313ce567') // decimals()
  const amount = Number(BigInt('0x' + result.input.slice(-64))) / 10 ** Number(decimals)
  console.log(`✅ ${c.short.padEnd(9)} ${amount.toFixed(2)} USDC (dec ${decimals})  ${hash}  -> ${file}`)
}
