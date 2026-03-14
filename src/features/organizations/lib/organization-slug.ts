const ORGANIZATION_SLUG_SUFFIX_LENGTH = 8;
export const MAX_ORGANIZATION_SLUG_LENGTH = 48;

export function normalizeOrganizationSlug(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug.length > 0 ? slug : 'organization';
}

export function generateOrganizationSlug(name: string) {
  const suffix = crypto.randomUUID().slice(0, ORGANIZATION_SLUG_SUFFIX_LENGTH);
  const base = normalizeOrganizationSlug(name);
  const maxBaseLength = Math.max(1, MAX_ORGANIZATION_SLUG_LENGTH - suffix.length - 1);

  return `${base.slice(0, maxBaseLength)}-${suffix}`;
}
