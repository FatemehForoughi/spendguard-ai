import { test, expect } from '@playwright/test'

const agentId='a'.repeat(24),intentId='b'.repeat(24),grantId='c'.repeat(24),externalId='d'.repeat(64)
const publicKey='ed25519:'+'1'.repeat(32)
const policy={id:'e'.repeat(24),version:1,status:'DRAFT',allowedSourceAssets:['usdc'],allowedDestinationAssets:['near'],spendingLimits:[{assetId:'usdc',maxPerOperationBaseUnits:'10000000',dailyLimitBaseUnits:'30000000'}],requiresUserApproval:true,balanceSource:'public'}
async function fixture(page,{connected=true,risk='ALLOW',live=true}={}) {
  const agent={id:agentId,name:'My trading agent',status:'PENDING',walletId:'wallet-one',busy:false,externalAgentId:externalId,createdAt:new Date().toISOString()}
  const p=structuredClone(policy),agents=[],grants=[],intents=[],operations=[],signed=[],requests=[]
  const session={user:{id:'user-one'},wallet:{id:'wallet-one',address:'alice.near',network:'near:mainnet',verificationStatus:'VERIFIED',verifiedAt:new Date().toISOString()},expiresAt:new Date(Date.now()+3600000).toISOString()}
  await page.addInitScript(()=>{
    let listener
    const seen=new Set()
    window.meteorCom={addMessageDataListener(fn){listener=fn},sendMessageData(data){if(!data.inputs||seen.has(data.uid))return;seen.add(data.uid);setTimeout(()=>listener({uid:data.uid,status:'closed_success',payload:{accountId:'alice.near',publicKey:'ed25519:'+'1'.repeat(32),signature:'A'.repeat(86)+'==',state:data.inputs.state}}),0)}}
  })
  function intent(type){const row={id:intentId,agentId,type,status:'PENDING_SIGNATURE',expiresAt:new Date(Date.now()+300000).toISOString(),generated:{type,agent_id:externalId,signer:{type:'near',account_id:'alice.near',public_key:publicKey},intent:{standard:'nep413',payload:{message:JSON.stringify({action:type,policy:p}),recipient:'outlayer.near',nonce:Buffer.alloc(32,1).toString('base64')}},preview:{summary:'Authorize '+type}}};intents.unshift(row);return row}
  await page.route('**/api/**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname,body=req.method()==='POST'?req.postDataJSON():undefined
    requests.push({path,body});let data
    if(path==='/api/wallet/config')data={networkId:'mainnet',walletProvider:'meteor-wallet',challengeLifetimeSeconds:300}
    else if(path==='/api/auth/session')data=connected?session:null
    else if(path==='/api/workspace/config')data={liveExecutionEnabled:live}
    else if(path==='/api/workspace/tokens')data=[{asset_id:'usdc',symbol:'USDC',decimals:6,blockchain:'near'},{asset_id:'near',symbol:'NEAR',decimals:24,blockchain:'near'}]
    else if(path==='/api/workspace/agents'&&req.method()==='GET')data=agents
    else if(path==='/api/workspace/agents') {expect(body.policy.spendingLimits[0].maxPerOperationBaseUnits).toBe('10000000');expect(body.policy.spendingLimits[0].dailyLimitBaseUnits).toBe('30000000');agents.push(agent);data={agent,intent:intent('agent_create')}}
    else if(path===`/api/workspace/agents/${agentId}`)data={agent,policies:[p],grants,intents}
    else if(path===`/api/workspace/agents/${agentId}/balances`)data={source:'public',balances:[{asset_id:'usdc',symbol:'USDC',decimals:6,balance_raw:'100000000',available_raw:'100000000'}]}
    else if(path===`/api/workspace/agents/${agentId}/grants`)data=intent('grant_issue')
    else if(path===`/api/workspace/intents/${intentId}/submit`){signed.push(body);expect(body.payload).toEqual(intents[0].generated.intent.payload);intents[0].status='SUCCESS';if(intents[0].type==='agent_create'){agent.status='ACTIVE';p.status='ACTIVE'}if(intents[0].type==='grant_issue')grants.push({id:grantId,status:'ACTIVE',expiresAt:new Date(Date.now()+86400000).toISOString(),policyVersion:1});if(intents[0].type==='approval_vote'){operations[0].operation.executionStatus='SUCCESS';operations[0].operation.actualOutputAmountBaseUnits='2000000000000000000000000';operations[0].operation.transactionHash='confirmedhash'}data=intents[0]}
    else if(path==='/api/workspace/operations'&&req.method()==='GET')data=operations
    else if(path==='/api/workspace/operations'){
      const row={id:body.requestId,agentId,request:'Swap 5 USDC to NEAR',createdAt:new Date().toISOString(),risk:{status:risk,score:risk==='BLOCK'?90:5,message:'Review this operation',reasons:[]},operation:{operationId:body.requestId,inputAssetId:'usdc',outputAssetId:'near',inputAmountBaseUnits:'5000000',minimumOutputAmountBaseUnits:'1000000000000000000000000',balanceSource:'public',policyVersion:1,decisionReasons:[],executionStatus:risk==='BLOCK'?'BLOCKED':'PENDING_APPROVAL',quote:{estimatedOutputAmountBaseUnits:'2000000000000000000000000',feeUsd:'0.01',feePercent:'0.2',warnings:[],reviewExpiresAt:new Date(Date.now()+120000).toISOString()},approval:{status:'PENDING',reference:'f1ac3333-e222-4222-8222-111111111111',reviewedOperationDigest:'a'.repeat(64)}}};operations.unshift(row);data=row
    }
    else if(path.endsWith('/decision')){expect(body.digest).toBe(operations[0].operation.approval.reviewedOperationDigest);operations[0].operation.approval.status=body.verdict==='approve'?'APPROVED':'REJECTED';operations[0].operation.executionStatus=body.verdict==='approve'?'DRAFT':'REJECTED';data=operations[0]}
    else if(path.endsWith('/execute')){expect(operations[0].operation.approval.status).toBe('APPROVED');Object.assign(operations[0].operation,{executionStatus:'PENDING_APPROVAL',submittedAt:new Date().toISOString(),correlationId:'op_'+'A'.repeat(43),providerApprovalId:'f1ac3333-e222-4222-8222-111111111111'});data=operations[0]}
    else if(path.endsWith('/provider-approval'))data=intent('approval_vote')
    else return route.fulfill({status:404,json:{success:false,message:'Unexpected endpoint'}})
    await route.fulfill({json:{success:true,data}})
  })
  return {requests,signed,agents,p,grants,operations}
}
async function setupAgent(page){
  await page.goto('/')
  await page.getByRole('button',{name:'Agents & Policies',exact:true}).click()
  await page.getByLabel('Agent name',{exact:true}).fill('My trading agent')
  await page.getByRole('combobox',{name:'Source asset',exact:true}).selectOption('usdc')
  await page.getByRole('combobox',{name:'Destination asset',exact:true}).selectOption('near')
  await page.getByLabel('Maximum per swap',{exact:true}).fill('10')
  await page.getByLabel('Limit per 24 hours',{exact:true}).fill('30')
  await page.getByRole('button',{name:'Prepare agent for signing'}).click()
  await expect(page.getByRole('heading',{name:'Review owner authorization'})).toBeVisible()
  await page.getByRole('button',{name:'Review & sign in Meteor'}).click()
  await expect(page.getByText('Policy version 1 · public balance')).toBeVisible()
  await page.getByRole('button',{name:'Prepare authorization',exact:true}).click()
  await page.getByRole('button',{name:'Review & sign in Meteor'}).click()
  await expect(page.getByText('Authorization · ACTIVE · policy v1')).toBeVisible()
  await page.getByRole('button',{name:'Swaps',exact:true}).click()
  await expect(page.getByRole('combobox',{name:'Sell',exact:true})).toHaveValue('usdc')
  await page.getByLabel('Amount to sell',{exact:true}).fill('5')
  await page.getByLabel('Minimum amount to receive',{exact:true}).fill('1')
  await page.getByRole('button',{name:'Get preview & risk assessment'}).click()
  await expect(page.getByText('Swap 5 USDC to NEAR',{exact:true})).toBeVisible()
}
test('complete agent, grant, preview, local approval, wallet vote and settlement flow through the actual Meteor SDK',async({page},testInfo)=>{
  const state=await fixture(page)
  const errors=[];page.on('pageerror',e=>errors.push(e.message))
  await setupAgent(page)
  await expect(page.getByText('Minimum receive',{exact:false})).toContainText('1 NEAR')
  await page.screenshot({path:testInfo.outputPath('preview.png'),fullPage:true})
  await page.getByRole('button',{name:'Approve this preview'}).click()
  await page.getByRole('button',{name:'Execute reviewed swap'}).click()
  await page.getByRole('button',{name:'Review wallet approval'}).click()
  await page.getByRole('button',{name:'Review & sign in Meteor'}).click()
  await expect(page.getByText('SUCCESS',{exact:true})).toBeVisible()
  await expect(page.getByText('confirmedhash',{exact:true})).toBeVisible()
  await page.screenshot({path:testInfo.outputPath('synthetic-settlement.png'),fullPage:true})
  expect(state.signed).toHaveLength(3)
  expect(state.requests.filter(r=>r.path.endsWith('/execute'))).toHaveLength(1)
  expect(errors).toEqual([])
  expect(await page.evaluate(()=>Object.entries(localStorage).some(([k,v])=>/keystore|private|secret|pending_key/.test(k)||/ed25519:/.test(v)))).toBe(false)
})
test('BLOCK prevents frontend approval and execution',async({page})=>{
  await fixture(page,{risk:'BLOCK'})
  await setupAgent(page)
  await expect(page.getByText('BLOCKED',{exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:'Approve this preview'})).toHaveCount(0)
  await expect(page.getByRole('button',{name:'Execute reviewed swap'})).toHaveCount(0)
})
test('execution remains disabled in preview mode',async({page})=>{
  await fixture(page,{live:false})
  await setupAgent(page)
  await page.getByRole('button',{name:'Approve this preview'}).click()
  await expect(page.getByRole('button',{name:'Execute reviewed swap'})).toBeDisabled()
})
test('mobile navigation exposes accessible agent workspace without horizontal overflow',async({page})=>{
  await page.setViewportSize({width:390,height:844})
  await fixture(page,{connected:false})
  await page.goto('/')
  await page.getByRole('button',{name:'Agents & Policies',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Connect your wallet to begin'})).toBeVisible()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})
