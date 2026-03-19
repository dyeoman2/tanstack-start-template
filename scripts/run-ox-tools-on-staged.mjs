import { spawnSync } from 'node:child_process';
import path from 'node:path';

const ignoredPathFragments = [
  'src/routeTree.gen.ts',
  'convex/_generated/',
  'convex/betterAuth/_generated/',
];

function main() {
  const files = process.argv
    .slice(2)
    .map((file) => path.normalize(file))
    .filter((file) => !isIgnoredFile(file));

  if (files.length === 0) {
    process.exit(0);
  }

  runCommand(['exec', 'oxlint', '--fix', ...files]);
  runCommand(['exec', 'oxfmt', ...files]);
}

function isIgnoredFile(file) {
  return ignoredPathFragments.some((fragment) => file.includes(path.normalize(fragment)));
}

function runCommand(args) {
  const result = spawnSync('pnpm', args, {
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

main();
