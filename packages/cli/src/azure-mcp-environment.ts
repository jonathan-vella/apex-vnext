export function azureMcpEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...environment,
    DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: environment.DOTNET_SYSTEM_GLOBALIZATION_INVARIANT ?? "1",
  };
}
