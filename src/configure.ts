import { types } from 'pg';

export function configure(): void {
  types.setTypeParser(types.builtins.INT8, (val) => Number.parseInt(val, 10));
  types.setTypeParser(types.builtins.INT4, (val) => Number.parseInt(val, 10));
  types.setTypeParser(types.builtins.NUMERIC, (val) => Number.parseFloat(val));
}
