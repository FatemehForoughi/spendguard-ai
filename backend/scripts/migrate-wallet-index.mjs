import { pathToFileURL } from 'node:url'
import dotenv from 'dotenv'
import mongoose from 'mongoose'

const claimKey = { network: 1, address: 1 }
const claimOptions = {
  name: 'network_1_address_1',
  unique: true,
  partialFilterExpression: { verifiedAt: { $type: 'date' } },
}
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)

// Run explicitly with the API stopped. This only changes indexes, never documents.
export async function migrateWalletIndex(collection, { apply = false } = {}) {
  const indexes = await collection.listIndexes().toArray()
  const claims = indexes.filter(index => same(index.key, claimKey))
  if (claims.length > 1) throw new Error('Multiple wallet claim indexes exist. Inspect their definitions before migrating.')
  const existing = claims[0]
  const current = existing?.name === claimOptions.name && existing.unique === true &&
    !existing.sparse && !existing.collation && same(existing.partialFilterExpression, claimOptions.partialFilterExpression)
  const legacy = existing?.name === claimOptions.name && existing.unique === true &&
    !existing.partialFilterExpression && !existing.sparse && !existing.collation
  if (existing && !current && !legacy) {
    throw new Error('Unrecognized wallet index. Inspect its definition before migrating.')
  }
  const report = {
    status: current ? 'current' : legacy ? 'legacy' : 'missing',
    walletRecords: await collection.countDocuments({}),
    applied: false,
  }
  if (!apply) return report

  // Keep owner uniqueness in place before replacing the global claim index.
  await collection.createIndex({ ownerUserId: 1, network: 1, address: 1 }, { unique: true })
  if (current) return report
  if (legacy) await collection.dropIndex(existing.name)
  try {
    await collection.createIndex(claimKey, claimOptions)
  } catch {
    if (legacy) {
      try {
        await collection.createIndex(claimKey, { name: existing.name, unique: true })
      } catch {
        throw new Error('Wallet index replacement and restoration failed. Keep the API stopped and inspect database indexes.')
      }
    }
    throw new Error('Wallet index replacement failed. The previous index was preserved or restored; keep the API stopped and inspect database indexes.')
  }
  return { ...report, status: 'current', applied: true }
}

async function main() {
  const args = process.argv.slice(2)
  if (args.some(arg => arg !== '--apply')) {
    console.error('Usage: npm run migrate:wallet-index -- [--apply]')
    process.exitCode = 1
    return
  }
  dotenv.config({ quiet: true })
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is not configured.')
    process.exitCode = 1
    return
  }
  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10_000 })
    const collection = mongoose.connection.db.collection('wallets')
    if (!(await mongoose.connection.db.listCollections({ name: 'wallets' }).hasNext())) {
      console.log('No wallet collection exists. Start the backend to create its indexes.')
      return
    }
    const report = await migrateWalletIndex(collection, { apply: args.includes('--apply') })
    console.log(JSON.stringify(report))
    if (report.status === 'legacy' || report.status === 'missing') {
      console.log('Stop all API instances, then run npm run migrate:wallet-index -- --apply to update wallet indexes. Wallet records are retained.')
    }
  } catch (error) {
    // Application messages are fixed strings; database errors may contain credentials.
    console.error(error?.constructor === Error ? error.message : 'Could not migrate wallet indexes. Check database access and index definitions.')
    process.exitCode = 1
  } finally { await mongoose.disconnect() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
