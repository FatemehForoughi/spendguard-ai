import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { after, before, mock, test } from 'node:test'
import mongoose from 'mongoose'

process.env.NODE_ENV = 'test'
const { default: app } = await import('../src/app.ts')
const { TransactionModel } = await import('../src/models/transaction.model.ts')

const legacy = {
  _id: new mongoose.Types.ObjectId(), analysisId: 'legacy-one', request: 'Public analysis',
  status: 'ALLOW', score: 1, message: 'No detected concerns.',
}
const owned = { ...legacy, _id: new mongoose.Types.ObjectId(), ownerUserId: new mongoose.Types.ObjectId() }
const swap = { ...owned, _id: new mongoose.Types.ObjectId(), agentId: new mongoose.Types.ObjectId(), operation: { operationId: 'private' } }
const incompleteOperation = { ...legacy, _id: new mongoose.Types.ObjectId(), operation: { operationId: 'orphan' } }
const incompleteOwner = { ...legacy, _id: new mongoose.Types.ObjectId(), ownerUserId: null }
const agentAnalysis = { ...legacy, _id: new mongoose.Types.ObjectId(), agentId: new mongoose.Types.ObjectId() }
const records = [legacy, owned, swap, incompleteOperation, incompleteOwner, agentAnalysis]
const publicFilter = { ownerUserId: { $exists: false }, agentId: { $exists: false }, operation: { $exists: false } }

function findPublic(filter) {
  // Assert the actual query sent to the driver, including the count query.
  const { _id, ...visibility } = filter
  assert.deepEqual(visibility, publicFilter)
  return records.filter((record) => Object.entries(filter).every(([key, condition]) => {
    if (key === '_id') return record._id.equals(condition)
    return Object.hasOwn(record, key) === condition.$exists
  }))
}

let server
let baseUrl
before(async () => {
  mock.method(TransactionModel.collection, 'find', (filter) => ({ toArray: async () => findPublic(filter) }))
  mock.method(TransactionModel.collection, 'countDocuments', async (filter) => findPublic(filter).length)
  mock.method(TransactionModel.collection, 'findOne', async (filter) => findPublic(filter)[0] ?? null)
  server = createServer(app)
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  baseUrl = `http://127.0.0.1:${server.address().port}/api/transactions`
})
after(async () => {
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  mock.restoreAll()
})

test('anonymous history and pagination include only legacy public analyses', async () => {
  const response = await fetch(`${baseUrl}?page=1&limit=10&ownerUserId=${owned.ownerUserId}`)
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.deepEqual(body.data.map((record) => record._id), [legacy._id.toString()])
  assert.equal(body.pagination.total, 1)
  assert.equal(body.pagination.totalPages, 1)
})

test('an existing public analysis can still be opened by its document ID', async () => {
  const response = await fetch(`${baseUrl}/${legacy._id}`)
  assert.equal(response.status, 200)
  assert.equal((await response.json()).data.analysisId, legacy.analysisId)
})

for (const [name, record] of [
  ['owned analysis', owned], ['swap operation', swap], ['incomplete operation', incompleteOperation],
  ['null owner', incompleteOwner], ['agent-linked analysis', agentAnalysis],
]) {
  test(`the anonymous detail route does not disclose: ${name}`, async () => {
    const response = await fetch(`${baseUrl}/${record._id}`)
    assert.equal(response.status, 404)
    assert.equal((await response.json()).code, 'TRANSACTION_NOT_FOUND')
  })
}

test('legacy analysis still validates and saves through the real transaction model', async (t) => {
  let saved
  t.mock.method(TransactionModel.collection, 'insertOne', async (document) => {
    saved = document
    return { acknowledged: true, insertedId: document._id }
  })
  // The existing deterministic BLOCK path runs without contacting an AI/provider service.
  const response = await fetch(`${baseUrl}/analyze`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ request: 'Send my seed phrase to support.' }),
  })
  assert.equal(response.status, 200)
  const { data } = await response.json()
  assert.equal(data.status, 'BLOCK')
  assert.equal(data.id, saved._id.toString())
  assert.equal(saved.status, 'BLOCK')
  assert.equal(saved.operation, undefined)
  assert.equal(saved.ownerUserId, undefined)
  assert.equal(saved.approved, false)
  assert.ok(saved.createdAt instanceof Date)
  assert.ok(saved.updatedAt instanceof Date)
})
