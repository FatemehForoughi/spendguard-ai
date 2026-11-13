import mongoose from 'mongoose'
import { mock } from 'node:test'

export const get = (row, path) => path.split('.').reduce((v, k) => v?.[k], row)
const equal = (a, b) => a instanceof mongoose.Types.ObjectId ? a.equals(b) : a instanceof Date ? +a === +b : a === b
export function matches(row, filter) {
  return Object.entries(filter).every(([path, wanted]) => {
    if (path === '$or') return wanted.some(f => matches(row, f))
    if (path === '$and') return wanted.every(f => matches(row, f))
    const value = get(row, path)
    if (wanted && typeof wanted === 'object' && !(wanted instanceof mongoose.Types.ObjectId) && !(wanted instanceof Date)) {
      return Object.entries(wanted).every(([op, v]) => {
        if (op === '$exists') return (value !== undefined) === v
        if (op === '$in') return v.some(x => equal(value, x))
        if (op === '$nin') return !v.some(x => equal(value, x))
        if (op === '$ne') return !equal(value, v)
        if (op === '$gt') return value > v
        if (op === '$gte') return value >= v
        if (op === '$lt') return value < v
        if (op === '$type') return v === 'date' ? value instanceof Date : typeof value === v
        return false
      })
    }
    return equal(value, wanted)
  })
}
function set(row, path, value, unset = false) {
  const keys = path.split('.')
  const last = keys.pop()
  for (const key of keys) row = row[key] ??= {}
  if (unset) delete row[last]; else row[last] = value
}
function update(row, change) {
  for (const [path, value] of Object.entries(change.$set ?? {})) set(row, path, value)
  for (const path of Object.keys(change.$unset ?? {})) set(row, path, undefined, true)
  for (const [path, value] of Object.entries(change.$inc ?? {})) set(row, path, (get(row, path) ?? 0) + value)
}
function clone(row) {
  if (row instanceof Date) return new Date(row)
  if (row instanceof mongoose.Types.ObjectId) return new mongoose.Types.ObjectId(row)
  if (Array.isArray(row)) return row.map(clone)
  if (row && typeof row === 'object') return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, clone(v)]))
  return row
}
export function memoryDatabase(Models) {
  const stores = new Map(Models.map(Model => [Model, []]))
  for (const Model of Models) {
    const rows = stores.get(Model)
    mock.method(Model.collection, 'insertOne', async row => {
      for (const [fields, options] of Model.schema.indexes()) {
        if (!options.unique || (options.partialFilterExpression && !matches(row, options.partialFilterExpression))) continue
        if (rows.some(r => (!options.partialFilterExpression || matches(r, options.partialFilterExpression)) && Object.keys(fields).every(k => equal(get(r, k), get(row, k))))) {
          throw Object.assign(new Error('Duplicate key'), { code: 11000 })
        }
      }
      rows.push(clone(row)); return { acknowledged: true, insertedId: row._id }
    })
    mock.method(Model.collection, 'findOne', async (filter, options = {}) => {
      const found = rows.filter(r => matches(r, filter))
      if (options.sort) found.sort((a,b) => { for (const [k,v] of Object.entries(options.sort)) { if (!equal(get(a,k),get(b,k))) return get(a,k) > get(b,k) ? v : -v } return 0 })
      return clone(found[0] ?? null)
    })
    mock.method(Model.collection, 'find', (filter, options = {}) => ({ toArray: async () => {
      const found = rows.filter(r => matches(r, filter))
      if (options.sort) found.sort((a,b) => { for (const [k,v] of Object.entries(options.sort)) { if (!equal(get(a,k),get(b,k))) return get(a,k) > get(b,k) ? v : -v } return 0 })
      return clone(found.slice(options.skip ?? 0, (options.skip ?? 0) + (options.limit || found.length)))
    } }))
    mock.method(Model.collection, 'updateOne', async (filter, change) => {
      const row = rows.find(r => matches(r, filter)); if (row) update(row, clone(change))
      return { acknowledged: true, matchedCount: row ? 1 : 0, modifiedCount: row ? 1 : 0 }
    })
    mock.method(Model.collection, 'updateMany', async (filter, change) => {
      const found = rows.filter(r => matches(r, filter)); found.forEach(r => update(r, clone(change)))
      return { acknowledged: true, matchedCount: found.length, modifiedCount: found.length }
    })
    mock.method(Model.collection, 'findOneAndUpdate', async (filter, change) => {
      const row = rows.find(r => matches(r, filter)); if (row) update(row, clone(change))
      return clone(row ?? null)
    })
    mock.method(Model.collection, 'countDocuments', async filter => rows.filter(r => matches(r, filter)).length)
  }
  return { stores, clear: () => { for (const rows of stores.values()) rows.length = 0 } }
}
