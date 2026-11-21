// Guards the CI workflow's security and coverage settings against accidental changes
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const workflow = YAML.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', '.github', 'workflows', 'ci.yml'), 'utf8')
);

test('workflow token is read-only', () => {
  expect(workflow.permissions).toEqual({ contents: 'read' });
});

test('no job escalates its own permissions', () => {
  for (const [name, job] of Object.entries(workflow.jobs)) {
    const perms = job.permissions;
    if (perms === undefined) continue;
    const values = typeof perms === 'string' ? [perms] : Object.values(perms);
    expect({ job: name, values }).toEqual({ job: name, values: values.filter((v) => v === 'read' || v === 'none') });
  }
});

test('tests run with both DB_* variables and DATABASE_URL-only configuration', () => {
  expect(workflow.jobs['lint-and-test'].strategy.matrix['db-config']).toEqual(
    expect.arrayContaining(['db-vars', 'database-url'])
  );
});
