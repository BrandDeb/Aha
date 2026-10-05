/**
 * NanoCLI Studio — the workspace.
 * Copyright (c) 2026 BrandDeb. All rights reserved. Proprietary; see LICENSE.
 */

import { WorkspaceProvider } from '@/workspace/store';
import { ToastProvider } from '@/workspace/toasts';
import { Workspace } from '@/workspace/Workspace';

export default function HomePage() {
  return (
    <WorkspaceProvider>
      <ToastProvider>
        <Workspace />
      </ToastProvider>
    </WorkspaceProvider>
  );
}
