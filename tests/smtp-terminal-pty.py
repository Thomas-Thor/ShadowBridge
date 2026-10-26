"""Fictional terminal input only; never contacts SMTP or production."""
import os, pty, select, time, secrets, signal
code = r"""import {question} from './scripts/smtp-production-operator.mjs';
import {gmailCredentialInput} from './scripts/smtp-terminal-input.mjs';
await question('VISIBLE: ');
const value=await question('HIDDEN: ',true);
let result='VALID';try{gmailCredentialInput(value)}catch(e){result=e.message}
console.log('RESULT:'+result);
await question('AFTER: ');console.log('COMPLETE');"""
cases = [('typed unavailable', 'BRAK', 'GMAIL_APP_PASSWORD_UNAVAILABLE'),
         ('pasted unavailable', '\x1b[200~BRAK\x1b[201~', 'GMAIL_APP_PASSWORD_UNAVAILABLE'),
         ('pasted fictional credential', '\x1b[200~'+secrets.token_hex(8)+'\x1b[201~', 'VALID')]
for name, answer, expected in cases:
    pid, fd = pty.fork()
    if pid == 0:
        os.execvp('node', ['node', '--input-type=module', '-e', code])
    output = b''; step = 0; deadline = time.monotonic()+8; completed=False
    try:
        while time.monotonic() < deadline:
            if not select.select([fd], [], [], 0.2)[0]: continue
            try: chunk = os.read(fd, 8192)
            except OSError: break
            if not chunk: break
            output += chunk
            if step == 0 and b'VISIBLE: ' in output:
                os.write(fd, b'\n'); step=1
            if step == 1 and b'HIDDEN: ' in output:
                os.write(fd, (answer+'\n').encode()); step=2
            if step == 2 and b'AFTER: ' in output:
                os.write(fd, b'public-echo-check\n'); step=3
            if b'COMPLETE' in output: completed=True; break
        assert completed, 'Terminal fixture timed out'
        assert ('RESULT:'+expected).encode() in output, 'Unexpected sanitized classification'
        assert b'public-echo-check' in output, 'Terminal echo not restored'
        if expected == 'VALID':
            assert answer[6:-6].encode() not in output, 'Fictional credential echoed'
        assert answer.encode() not in output, 'Hidden answer echoed'
        _, status = os.waitpid(pid, 0)
        assert os.waitstatus_to_exitcode(status) == 0
    finally:
        os.close(fd)
        if not completed:
            try: os.kill(pid, signal.SIGKILL); os.waitpid(pid,0)
            except ProcessLookupError: pass
    print('PASS '+name+'; no echo; normal echo restored')
