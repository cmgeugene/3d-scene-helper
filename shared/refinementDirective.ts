import { z } from 'zod';

const directiveItemSchema = z.string().trim().min(1).max(240);

function normalizedItem(value: string) {
  return value.toLocaleLowerCase();
}

export const refinementDirectiveSchema = z
  .strictObject({
    version: z.literal(1),
    preserve: z.array(directiveItemSchema).max(16),
    change: z.array(directiveItemSchema).min(1).max(16),
  })
  .superRefine((directive, context) => {
    for (const field of ['preserve', 'change'] as const) {
      const seen = new Set<string>();
      directive[field].forEach((value, index) => {
        const normalized = normalizedItem(value);
        if (seen.has(normalized)) {
          context.addIssue({
            code: 'custom',
            path: [field, index],
            message: `${field} 항목은 중복될 수 없습니다.`,
          });
        }
        seen.add(normalized);
      });
    }

    const preserved = new Set(directive.preserve.map(normalizedItem));
    directive.change.forEach((value, index) => {
      if (!preserved.has(normalizedItem(value))) return;
      context.addIssue({
        code: 'custom',
        path: ['change', index],
        message: '같은 항목을 유지하면서 동시에 변경할 수 없습니다.',
      });
    });
  });

export type RefinementDirective = z.infer<typeof refinementDirectiveSchema>;

export function createRefinementDirective(
  changeText: string,
  preserveText: string,
): RefinementDirective {
  const lines = (value: string) =>
    value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '');
  return refinementDirectiveSchema.parse({
    version: 1,
    preserve: lines(preserveText),
    change: lines(changeText),
  });
}
