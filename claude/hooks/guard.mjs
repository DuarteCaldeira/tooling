import { bashBlockReason, blockReason } from './lib/guard-rules.mjs';
import { emit, readInput } from './lib/shared.mjs';
import { markCommand } from './lib/stop.mjs';

const input = await readInput();
const shell = input.tool_name === 'Bash' || input.tool_name === 'PowerShell';
const reason = shell
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
// Shares this PreToolUse process (one Node start per command): lets track-edit find the files a
// shell command wrote.
else if (shell) markCommand(input);
