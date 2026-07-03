import { z } from 'zod';

export interface Sep6FormField {
  key: string;
  label: string;
  type: 'text' | 'select';
  required: boolean;
  choices?: string[];
}

export interface Sep6FormSchema {
  fields: Sep6FormField[];
  schema: z.ZodObject<Record<string, z.ZodTypeAny>>;
}

type RawField = { description: string; choices?: string[]; optional?: boolean };

function buildFieldValidator(field: RawField): z.ZodTypeAny {
  const required = field.optional !== true;
  const { choices } = field;

  if (choices && choices.length > 0) {
    const enumSchema = z.enum(choices as [string, ...string[]]);
    return required ? enumSchema : enumSchema.optional();
  }

  const stringSchema = z.string().min(1, `${field.description} is required`);
  return required ? stringSchema : z.string().optional();
}

export function buildSep6FormSchema(fields: Record<string, RawField>): Sep6FormSchema {
  const formFields: Sep6FormField[] = [];
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, raw] of Object.entries(fields)) {
    formFields.push({
      key,
      label: raw.description,
      type: raw.choices && raw.choices.length > 0 ? 'select' : 'text',
      required: raw.optional !== true,
      ...(raw.choices ? { choices: raw.choices } : {}),
    });
    shape[key] = buildFieldValidator(raw);
  }

  return {
    fields: formFields,
    schema: z.object(shape),
  };
}
