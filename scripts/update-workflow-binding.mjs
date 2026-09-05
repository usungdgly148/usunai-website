import { kvGet, kvPut } from '../server/kv-local.js';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const key = process.argv[i];
  if (key.startsWith('--')) args.set(key.slice(2), process.argv[i + 1] || '');
}

const siteId = args.get('site-id');
const expectedWorkflowId = args.get('expected-workflow-id');
const nextWorkflowId = args.get('next-workflow-id');
const apply = process.argv.includes('--apply');

if (!siteId || !expectedWorkflowId || !nextWorkflowId) {
  console.error('Usage: node scripts/update-workflow-binding.mjs --site-id <id> --expected-workflow-id <id> --next-workflow-id <id> [--apply]');
  process.exit(2);
}

const workflows = await kvGet('workflows');
if (!Array.isArray(workflows)) {
  console.error('The workflows configuration is unavailable.');
  process.exit(1);
}

const matches = workflows
  .map((workflow, index) => ({ workflow, index }))
  .filter(({ workflow }) => String(workflow?.id) === String(siteId));

if (matches.length !== 1) {
  console.error(`Expected one website workflow for ${siteId}, found ${matches.length}.`);
  process.exit(1);
}

const { workflow, index } = matches[0];
if (String(workflow.workflowId) !== String(expectedWorkflowId)) {
  console.error(`Binding changed unexpectedly: expected ${expectedWorkflowId}, found ${workflow.workflowId || '(empty)'}.`);
  process.exit(1);
}

console.log(JSON.stringify({
  siteId: String(siteId),
  currentWorkflowId: String(workflow.workflowId),
  nextWorkflowId: String(nextWorkflowId),
  apply,
}));

if (apply) {
  const next = workflows.slice();
  next[index] = { ...workflow, workflowId: String(nextWorkflowId) };
  await kvPut('workflows', next);
  console.log('Workflow binding updated.');
}
