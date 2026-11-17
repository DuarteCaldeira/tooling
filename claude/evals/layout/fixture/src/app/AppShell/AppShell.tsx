import { Stack } from '@dcaldeira/design-system';
import type { ReactNode } from 'react';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <Stack direction="column" height="screen">
      <Stack as="header" direction="row" justify="between" align="center" padding="md">
        Billy
      </Stack>
      <Stack as="main" direction="column" gap="lg" padding={{ x: 'md', y: 'lg' }}>
        {children}
      </Stack>
    </Stack>
  );
}
