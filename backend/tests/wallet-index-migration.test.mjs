import assert from 'node:assert/strict'
import { test } from 'node:test'
import { migrateWalletIndex } from '../scripts/migrate-wallet-index.mjs'

const legacy = { name: 'network_1_address_1', key: { network: 1, address: 1 }, unique: true }
const current = { ...legacy, partialFilterExpression: { verifiedAt: { $type: 'date' } } }
function fixture(indexes, failCreate = () => false) {
  const calls = []
  const collection = {
    listIndexes: () => ({ toArray: async () => indexes }),
    countDocuments: async () => 4,
    createIndex: async (key, options) => {
      calls.push(['create', key, options])
      if (failCreate(key, options)) throw new Error('Sensitive database failure')
    },
    dropIndex: async name => { calls.push(['drop', name]) },
  }
  return { collection, calls }
}

test('migration inspection detects the legacy index without changing indexes or documents', async () => {
  const { collection, calls } = fixture([legacy])
  assert.deepEqual(await migrateWalletIndex(collection), { status: 'legacy', walletRecords: 4, applied: false })
  assert.deepEqual(calls, [])
})

test('applying migration ensures owner uniqueness before replacing exactly the legacy claim index', async () => {
  const { collection, calls } = fixture([legacy])
  assert.deepEqual(await migrateWalletIndex(collection, { apply: true }), { status: 'current', walletRecords: 4, applied: true })
  assert.deepEqual(calls, [
    ['create', { ownerUserId: 1, network: 1, address: 1 }, { unique: true }],
    ['drop', legacy.name],
    ['create', legacy.key, { name: current.name, unique: true, partialFilterExpression: current.partialFilterExpression }],
  ])
})

test('a current index is retained and a missing index is added without dropping anything', async () => {
  for (const indexes of [[current], []]) {
    const { collection, calls } = fixture(indexes)
    const result = await migrateWalletIndex(collection, { apply: true })
    assert.equal(result.status, 'current')
    assert.equal(result.applied, indexes.length === 0)
    assert.equal(calls.some(([action]) => action === 'drop'), false)
  }
})

test('unknown or multiple claim definitions are refused before any change', async () => {
  for (const indexes of [[{ ...legacy, unique: false }], [{ ...legacy, name: 'custom' }], [legacy, current]]) {
    const { collection, calls } = fixture(indexes)
    await assert.rejects(migrateWalletIndex(collection, { apply: true }), /Inspect|inspect/)
    assert.deepEqual(calls, [])
  }
})

test('owner-index failure leaves the legacy index in place', async () => {
  const { collection, calls } = fixture([legacy], key => 'ownerUserId' in key)
  await assert.rejects(migrateWalletIndex(collection, { apply: true }))
  assert.equal(calls.some(([action]) => action === 'drop'), false)
})

test('failed replacement restores the previous index and reports no database details', async () => {
  const { collection, calls } = fixture([legacy], (_key, options) => Boolean(options.partialFilterExpression))
  await assert.rejects(migrateWalletIndex(collection, { apply: true }), error => {
    assert.match(error.message, /previous index was preserved or restored/)
    assert.doesNotMatch(error.message, /Sensitive/)
    return true
  })
  assert.deepEqual(calls.at(-1), ['create', legacy.key, { name: legacy.name, unique: true }])
})
