import { emit, readInput } from './lib/shared.mjs';
import { stopCheck } from './lib/stop.mjs';

const result = stopCheck(await readInput());
if (result) emit(result);
