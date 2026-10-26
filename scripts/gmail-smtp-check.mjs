// Existing SMTP AUTH check, extracted for the independent operator. No message is sent.
import tls from 'node:tls';
const guard=(v,m)=>{if(!v)throw Error(m);};
export async function checkGmail(password) {
  const socket = tls.connect({ host:'smtp.gmail.com',port:465,servername:'smtp.gmail.com',rejectUnauthorized:true });
  socket.setTimeout(15000,()=>socket.destroy(new Error('SMTP timeout')));
  const lines=[], waiters=[]; let buffer='', failure;
  const fail = () => { failure=new Error('Gmail SMTP nie potwierdził bezpiecznego połączenia i hasła aplikacji. Sprawdź 2FA i hasło aplikacji. Nie wysłano wiadomości.'); while(waiters.length)waiters.shift().reject(failure); };
  socket.on('error',fail); socket.on('close',()=>{if(waiters.length)fail();});
  socket.on('data',chunk=>{buffer+=chunk.toString('utf8');if(buffer.length>65536){socket.destroy();fail();return;}let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end).replace(/\r$/,'');buffer=buffer.slice(end+1);if(waiters.length)waiters.shift().resolve(line);else lines.push(line);}});
  const line = () => failure ? Promise.reject(failure) : lines.length ? Promise.resolve(lines.shift()) : new Promise((resolve,reject)=>waiters.push({resolve,reject}));
  const response = async expected => {let value;do{value=await line();guard(/^\d{3}[- ]/.test(value),'Nieprawidłowa odpowiedź SMTP.');}while(value[3]==='-');guard(Number(value.slice(0,3))===expected,'Gmail odrzucił uwierzytelnienie SMTP; sprawdź hasło aplikacji. Nie wysłano wiadomości.');};
  try {
    await response(220); socket.write('EHLO shadow-bridge.eu\r\n'); await response(250);
    socket.write('AUTH LOGIN\r\n');await response(334);
    socket.write(Buffer.from('shadowbridge.trade@gmail.com').toString('base64')+'\r\n');await response(334);
    socket.write(Buffer.from(password).toString('base64')+'\r\n');await response(235);
    socket.write('QUIT\r\n');
  } finally { socket.destroy(); }
}
