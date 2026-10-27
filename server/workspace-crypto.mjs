import {randomBytes,createCipheriv,createDecipheriv,createHash} from 'node:crypto';
import {ApiError} from './validation.mjs';
export const sha256=v=>createHash('sha256').update(typeof v==='string'||Buffer.isBuffer(v)?v:JSON.stringify(v)).digest('hex');
export function seal(value,key,context){
 if(!Buffer.isBuffer(key)||key.length!==32)throw new ApiError(503,'PRIVATE_STORAGE_UNCONFIGURED','Private file storage has not been configured.');
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(context));
 const data=Buffer.concat([cipher.update(Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value))),cipher.final()]);
 return Buffer.concat([Buffer.from('SB2'),iv,cipher.getAuthTag(),data]).toString('hex');
}
export function open(cipher,key,context,{json=false}={}){
 if(!Buffer.isBuffer(key)||key.length!==32)throw new ApiError(503,'PRIVATE_STORAGE_UNCONFIGURED','Private file storage has not been configured.');
 try{
  const b=Buffer.from(cipher,'hex');if(b.subarray(0,3).toString()!=='SB2'||b.length<31)throw Error();
  const decipher=createDecipheriv('aes-256-gcm',key,b.subarray(3,15));decipher.setAuthTag(b.subarray(15,31));decipher.setAAD(Buffer.from(context));
  const value=Buffer.concat([decipher.update(b.subarray(31)),decipher.final()]);return json?JSON.parse(value.toString('utf8')):value;
 }catch{throw new ApiError(503,'PRIVATE_STORAGE_UNAVAILABLE','Private data could not be opened. Check the protected storage key and backup.');}
}
