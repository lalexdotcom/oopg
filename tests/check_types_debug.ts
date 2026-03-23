import { required, varchar, datetime, boolean } from '../src/types';
import type { InputType, OutputType } from '../src/types';

const cols = {
  name: required(varchar(100)),
  score: { type: 'int' as const },
  createdAt: datetime(),
  active: boolean(false),
  notes: { type: 'text' as const, required: true as const },
} as const;

type IT = InputType<typeof cols>;
type OT = OutputType<typeof cols>;

// Trigger a deliberate error to reveal the actual types
const _it: IT = {} as any;
const _nameType: string = _it.name; // if IT['name'] is not string, this errors
const _ot: OT = {} as any;
const _nameOutput: string = _ot.name;
