export {}

declare global {
  interface Window {
    agenthubDesktop?: {
      isDesktop: boolean
      selectWorkspace(): Promise<{ token: string; name: string } | null>
      getWorkspace(): Promise<{ token: string; name: string } | null>
      invokeTool(request: { workspaceToken: string; name: string; arguments: Record<string, unknown>; approved?: boolean }): Promise<unknown>
    }
  }
}
