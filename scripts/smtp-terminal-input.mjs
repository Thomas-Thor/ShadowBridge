// Normalize only the terminal bracketed-paste envelope; never log input.
import{gmailAuthSettings}from'./production-config.mjs';
export function terminalAnswer(value){
 if(typeof value!=='string')throw Error('TERMINAL_INPUT_INVALID');
 let answer=value.trim();
 if(answer.startsWith('\x1b[200~')&&answer.endsWith('\x1b[201~'))answer=answer.slice(6,-6).trim();
 return answer;
}
export function gmailCredentialInput(value){
 const answer=terminalAnswer(value);
 if(answer.toUpperCase()==='BRAK')throw Error('GMAIL_APP_PASSWORD_UNAVAILABLE');
 if(!answer)throw Error('GMAIL_CREDENTIAL_INPUT_EMPTY_NO_PROFILE_WRITTEN');
 if(/[\x00-\x1f\x7f-\x9f]/.test(answer))throw Error('GMAIL_CREDENTIAL_CONTROL_INPUT_REJECTED_NO_PROFILE_WRITTEN');
 try{return gmailAuthSettings(answer).GOTRUE_SMTP_PASS;}
 catch{throw Error('GMAIL_APP_PASSWORD_FORMAT_INVALID_NO_PROFILE_WRITTEN');}
}
