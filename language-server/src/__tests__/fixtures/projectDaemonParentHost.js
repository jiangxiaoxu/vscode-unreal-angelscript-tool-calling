'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');

const serverPath = process.argv[2];
const projectRoot = process.argv[3];
const uprojectPath = path.join(projectRoot, 'ParentDeath.uproject');
const projectIdentity = process.platform == 'win32' ? uprojectPath.toLowerCase() : uprojectPath;
const child = spawn(process.execPath, [serverPath], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
let buffer = Buffer.alloc(0);

child.stdout.on('data', (data) => {
    buffer = Buffer.concat([buffer, data]);
    while (true)
    {
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd < 0)
            return;
        const header = buffer.subarray(0, headerEnd).toString('ascii');
        const length = Number(/Content-Length:\s*(\d+)/i.exec(header)?.[1]);
        if (!Number.isSafeInteger(length) || buffer.length < headerEnd + 4 + length)
            return;
        const message = JSON.parse(buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString('utf8'));
        buffer = buffer.subarray(headerEnd + 4 + length);
        if (message.id == 1)
        {
            process.stdout.write(`${child.pid}\n`);
            setInterval(() => {}, 1000);
            return;
        }
    }
});
child.stderr.pipe(process.stderr);

const initialize = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
        processId: process.pid,
        rootUri: `file:///${projectRoot.replace(/\\/g, '/')}`,
        capabilities: {},
        initializationOptions: {
            role: 'project-daemon',
            canonicalProjectRoot: projectRoot,
            uprojectPath,
            projectIdentity,
            unreal: { debuggerPort: 1 },
        },
    },
};
const body = Buffer.from(JSON.stringify(initialize), 'utf8');
child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
child.stdin.write(body);
