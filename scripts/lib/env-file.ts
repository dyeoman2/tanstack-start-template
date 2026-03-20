export function formatEnvValue(value: string) {
  if (/^[A-Za-z0-9._:/@-]+$/.test(value)) {
    return value;
  }

  return JSON.stringify(value);
}

function normalizeEnvContent(lines: string[]) {
  return `${lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()}\n`;
}

function findSectionInsertIndex(lines: string[], sectionMarker: string) {
  const sectionStart = lines.findIndex((line) => line.includes(sectionMarker));
  if (sectionStart === -1) {
    return -1;
  }

  for (let index = sectionStart + 1; index < lines.length; index += 1) {
    if (
      lines[index]?.startsWith('# ==========================================') &&
      index > sectionStart + 1
    ) {
      return index - 1 >= 0 && lines[index - 1] === '' ? index - 1 : index;
    }
  }

  return lines.length;
}

export function upsertStructuredEnvValue(
  envContent: string,
  name: string,
  value: string,
  options?: {
    sectionMarker?: string;
  },
) {
  const nextLine = `${name}=${formatEnvValue(value)}`;
  const lines = envContent.split('\n');
  const output: string[] = [];
  let inserted = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const isActive = trimmed.startsWith(`${name}=`);
    const isCommentPlaceholder =
      trimmed.startsWith(`# ${name}=`) || trimmed.startsWith(`#${name}=`);

    if (isActive || isCommentPlaceholder) {
      if (!inserted) {
        output.push(nextLine);
        inserted = true;
      }
      continue;
    }

    output.push(line);
  }

  if (inserted) {
    return normalizeEnvContent(output);
  }

  if (options?.sectionMarker) {
    const insertAt = findSectionInsertIndex(output, options.sectionMarker);
    if (insertAt !== -1) {
      const nextOutput = [...output];
      nextOutput.splice(insertAt, 0, nextLine);
      return normalizeEnvContent(nextOutput);
    }
  }

  return `${output
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()}\n\n${nextLine}\n`;
}

export function removeStructuredEnvValue(envContent: string, name: string) {
  const lines = envContent.split('\n');
  const output = lines.filter((line) => {
    const trimmed = line.trim();
    return (
      !trimmed.startsWith(`${name}=`) &&
      !trimmed.startsWith(`# ${name}=`) &&
      !trimmed.startsWith(`#${name}=`)
    );
  });

  return `${output
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()}\n`;
}
