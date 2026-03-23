export async function uploadFileWithTarget(
  file: File,
  target: {
    uploadMethod: 'POST' | 'PUT';
    uploadUrl: string;
    uploadHeaders?: Record<string, string>;
    uploadFields?: Record<string, string>;
  },
) {
  if (target.uploadMethod === 'PUT') {
    const response = await fetch(target.uploadUrl, {
      body: file,
      headers: target.uploadHeaders,
      method: 'PUT',
    });

    if (!response.ok) {
      throw new Error(`Failed to upload ${file.name}.`);
    }

    return null;
  }

  const formData = new FormData();
  for (const [key, value] of Object.entries(target.uploadFields ?? {})) {
    formData.append(key, value);
  }
  formData.append('file', file);

  const response = await fetch(target.uploadUrl, {
    body: formData,
    headers: target.uploadHeaders,
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error(`Failed to upload ${file.name}.`);
  }

  const payload: unknown = await response.json();
  if (
    !payload ||
    typeof payload !== 'object' ||
    !('storageId' in payload) ||
    typeof payload.storageId !== 'string'
  ) {
    throw new Error('Upload did not return a storage identifier.');
  }

  return payload.storageId;
}
