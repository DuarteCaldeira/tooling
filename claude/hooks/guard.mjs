import { bashBlockReason, blockReason } from './lib/guard-rules.mjs';
import { emit, readInput } from './lib/shared.mjs';

const input = await readInput();
const reason =
  input.tool_name === 'Bash' || input.tool_name === 'PowerShell'
    ? bashBlockReason(input.tool_input?.command)
    : blockReason(input.tool_input?.file_path ?? input.tool_input?.notebook_path);
if (reason)
  emit({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  });
