import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import { env } from '../src/config/env.ts'
import { AgentModel, PolicyModel, TransactionModel } from '../src/models/index.ts'
import { OwnerIntentModel } from '../src/models/owner-intent.model.ts'
import { SecretModel } from '../src/models/secret.model.ts'
import assert from 'node:assert/strict'

// Test in a fresh database, never in the URI's configured application database.
const databaseName='spendguard_integration_'+randomUUID().replaceAll('-','')
if (!env.MONGODB_URI) throw new Error('Configure MONGODB_URI before running database validation.')
let client
try {
  client=await mongoose.createConnection(env.MONGODB_URI,{dbName:databaseName,serverSelectionTimeoutMS:10000}).asPromise()
  const models=[AgentModel,PolicyModel,TransactionModel,OwnerIntentModel,SecretModel].map(M=>client.model(M.modelName,M.schema.clone()))
  await Promise.all(models.map(M=>M.init()))
  const [Agent,Policy,Transaction]=models
  const owner=new mongoose.Types.ObjectId(),wallet=new mongoose.Types.ObjectId()
  const agent=await Agent.create({ownerUserId:owner,walletId:wallet,name:'Integration agent',operationType:'SWAP',status:'PENDING'})
  const locks=await Promise.all(Array.from({length:12},(_,i)=>Agent.findOneAndUpdate({_id:agent._id,busyOperationId:{$exists:false}},{$set:{busyOperationId:'request-'+i}},{returnDocument:'after'})))
  assert.equal(locks.filter(Boolean).length,1)
  const policy={ownerUserId:owner,agentId:agent._id,version:1,status:'ACTIVE',allowedSourceAssets:['usdc'],allowedDestinationAssets:['near'],requiresUserApproval:true,
    spendingLimits:[{assetId:'usdc',maxPerOperationBaseUnits:'1',dailyLimitBaseUnits:'2'}]}
  await Policy.create(policy)
  await assert.rejects(Policy.create({...policy,version:2}),{code:11000})
  const id=randomUUID(), operation={type:'SWAP',operationId:id,inputAssetId:'usdc',outputAssetId:'near',inputAmountBaseUnits:'1'}
  await Transaction.create({ownerUserId:owner,agentId:agent._id,request:'Integration preview',operation})
  await assert.rejects(Transaction.create({ownerUserId:owner,agentId:agent._id,request:'Duplicate preview',operation}),{code:11000})
  console.log('Database validation passed: indexes, concurrent dispatch lock, policy uniqueness, operation uniqueness.')
} catch {
  console.error('Database validation failed. Check connectivity and isolated-database permissions. No credentials were displayed.')
  process.exitCode=1
} finally {
  if (client?.db) {
    // Only the randomly named isolated test database is eligible for cleanup.
    if (!/^spendguard_integration_[a-f0-9]{32}$/.test(databaseName)||client.name!==databaseName)throw new Error('Unexpected test database name')
    await client.dropDatabase()
    await client.close()
  }
}
