import { describe, expect, test } from '@rstest/core';
import { columnTypeToSQL } from '../src/utils';

describe('columnTypeToSQL', () => {
  describe('scale validation', () => {
    test('throws when scale is used with varchar type', () => {
      // biome-ignore lint/suspicious/noExplicitAny: testing runtime guard for untyped callers
      expect(() => columnTypeToSQL({ type: 'varchar', precision: 10, scale: 2 } as any)).toThrowError(
        'columnTypeToSQL: scale is only valid for numeric and decimal types',
      );
    });

    test('throws when scale is used with float type', () => {
      // biome-ignore lint/suspicious/noExplicitAny: testing runtime guard for untyped callers
      expect(() => columnTypeToSQL({ type: 'float', precision: 8, scale: 2 } as any)).toThrowError(
        'columnTypeToSQL: scale is only valid for numeric and decimal types',
      );
    });

    test('does not throw when scale is used with numeric type', () => {
      expect(columnTypeToSQL({ type: 'numeric', precision: 10, scale: 2 })).toBe('numeric(10,2)');
    });

    test('does not throw when scale is used with decimal type', () => {
      expect(columnTypeToSQL({ type: 'decimal', precision: 10, scale: 2 })).toBe('decimal(10,2)');
    });
  });
});
