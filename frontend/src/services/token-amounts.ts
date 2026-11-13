export function toBaseUnits(value:string,decimals:number):string {
  if (!Number.isInteger(decimals)||decimals<0||decimals>36||value.length>115||!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)) throw new Error('Enter a positive token amount.')
  const [whole,fraction='']=value.split('.')
  if (fraction.length>decimals) throw new Error(`This token supports ${decimals} decimal places.`)
  const result=BigInt(whole+fraction.padEnd(decimals,'0')).toString()
  if (result==='0'||result.length>78) throw new Error('Enter a positive amount within the supported range.')
  return result
}
export function fromBaseUnits(value:string,decimals:number):string {
  if (!/^[0-9]+$/.test(value)||!Number.isInteger(decimals)||decimals<0||decimals>36) return value
  if (decimals===0) return value
  const padded=value.padStart(decimals+1,'0')
  const fraction=padded.slice(-decimals).replace(/0+$/,'')
  return padded.slice(0,-decimals)+(fraction?'.'+fraction:'')
}
