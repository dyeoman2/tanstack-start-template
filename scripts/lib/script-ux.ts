export function hasHelpFlag(argv = process.argv): boolean {
  return argv.includes('--help') || argv.includes('-h');
}

export function hasFlag(name: string, argv = process.argv): boolean {
  return argv.includes(name);
}

export function routeLogsToStderrWhenJson(json: boolean) {
  if (!json) {
    return;
  }

  const originalLog = console.log.bind(console);
  console.log = (...args: unknown[]) => {
    const text = args
      .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg, null, 2)))
      .join(' ');
    process.stderr.write(`${text}\n`);
  };

  return originalLog;
}

export function printScriptIntro(input: {
  modifies?: string;
  prereqs?: string;
  safeToRerun: string;
  title: string;
  what: string;
}) {
  console.log(`${input.title}\n`);
  console.log(`What this does: ${input.what}`);
  if (input.prereqs) {
    console.log(`Prereqs: ${input.prereqs}`);
  }
  if (input.modifies) {
    console.log(`Modifies: ${input.modifies}`);
  }
  console.log(`Safe to rerun: ${input.safeToRerun}\n`);
}

export function printTargetSummary(title: string, lines: string[]) {
  console.log(`${title}:`);
  for (const line of lines) {
    console.log(`- ${line}`);
  }
  console.log('');
}

export function printStatusSummary(
  title: string,
  entries: Array<{ label: string; value: string }>,
) {
  console.log(`${title}:`);
  for (const entry of entries) {
    console.log(`- ${entry.label}: ${entry.value}`);
  }
  console.log('');
}

export const SCRIPT_OUTPUT_SCHEMA_VERSION = 1;

export function emitStructuredOutput(payload: Record<string, unknown>) {
  process.stdout.write(
    `${JSON.stringify({ schemaVersion: SCRIPT_OUTPUT_SCHEMA_VERSION, ...payload }, null, 2)}\n`,
  );
}

export function printFinalChangeSummary(input: {
  changedLocally?: string[];
  changedRemotely?: string[];
  nextCommands?: string[];
  readiness?: Record<string, string>;
  warnings?: string[];
}) {
  console.log('Final summary:');
  if (input.readiness && Object.keys(input.readiness).length > 0) {
    console.log('Readiness:');
    for (const [key, value] of Object.entries(input.readiness)) {
      console.log(`- ${key}: ${value}`);
    }
  }
  console.log('Changed locally:');
  if (!input.changedLocally || input.changedLocally.length === 0) {
    console.log('- None');
  } else {
    for (const line of input.changedLocally) {
      console.log(`- ${line}`);
    }
  }
  console.log('Changed remotely:');
  if (!input.changedRemotely || input.changedRemotely.length === 0) {
    console.log('- None');
  } else {
    for (const line of input.changedRemotely) {
      console.log(`- ${line}`);
    }
  }
  console.log('Warnings:');
  if (!input.warnings || input.warnings.length === 0) {
    console.log('- None');
  } else {
    for (const line of input.warnings) {
      console.log(`- ${line}`);
    }
  }
  console.log('Next commands:');
  if (!input.nextCommands || input.nextCommands.length === 0) {
    console.log('- None');
  } else {
    for (const line of input.nextCommands) {
      console.log(`- ${line}`);
    }
  }
  console.log('');
}
