import fs from 'node:fs';
import assert from 'node:assert/strict';

const frontend = fs.readFileSync(new URL('../frontend/src/pages/Workflow.jsx', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server/index.mjs', import.meta.url), 'utf8');

assert.match(frontend, /function serializeCozeFileRef\(value\)/);
assert.match(frontend, /items\.map\(serializeCozeFileRef\)\.filter\(Boolean\)/);
assert.match(frontend, /serializeCozeFileRef\(Array\.isArray\(parsed\) \? parsed\[0\] : parsed\)/);

assert.match(server, /function normalizeCozeWorkflowParameters\(parameters, fields\)/);
assert.match(server, /normalized\[field\.key\] = items\.map\(serializeCozeWorkflowFileRef\)\.filter\(Boolean\)/);
assert.match(server, /const parameters = normalizeCozeWorkflowParameters\(body\.parameters \|\| \{\}, runtime\.formFields \|\| \[\]\)/);
assert.match(server, /c === 6020/);

console.log('Coze workflow file parameter contract: ok');
