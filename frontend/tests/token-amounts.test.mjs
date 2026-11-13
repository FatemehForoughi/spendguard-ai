import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toBaseUnits, fromBaseUnits } from '../src/services/token-amounts.ts'
test('policy amounts preserve 24-digit precision and display without floating point rounding',()=>{
  assert.equal(toBaseUnits('99999999999999.123456789012345678901234',24),'99999999999999123456789012345678901234')
  assert.equal(fromBaseUnits('1000000000000000000000001',24),'1.000000000000000000000001')
  assert.equal(fromBaseUnits('1000000',6),'1')
  assert.throws(()=>toBaseUnits('1.0000001',6))
  assert.throws(()=>toBaseUnits('0',24))
})
