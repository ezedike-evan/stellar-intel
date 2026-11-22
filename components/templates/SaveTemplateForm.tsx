import type { TemplateStoreError } from '@/lib/templates/store';

export function templateErrorMessage(
  result:
    | { ok: false; error: TemplateStoreError; message?: string }
    | { message?: string }
    | TemplateStoreError
    | string
): string {
  if (typeof result === 'string') {
    switch (result) {
      case 'duplicate_label':
        return 'A template with this name already exists for this direction.';
      case 'limit':
        return 'Maximum 50 templates reached.';
      case 'not_found':
        return 'Template not found.';
      case 'storage_unavailable':
        return 'Storage unavailable or quota exceeded.';
      default:
        return result || 'Invalid template input.';
    }
  }
  if (typeof result === 'object' && result !== null) {
    if ('message' in result && result.message) {
      return result.message;
    }
    if ('error' in result && typeof result.error === 'string') {
      return templateErrorMessage(result.error);
    }
  }
  return 'Invalid template input.';
}
