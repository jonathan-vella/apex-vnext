export const terraformRegistryFixtures = {
  search: {
    modules: [
      {
        id: "Azure/avm-res-keyvault-vault/azurerm/0.10.0",
        namespace: "Azure",
        name: "avm-res-keyvault-vault",
        provider: "azurerm",
        version: "0.10.0",
        description: "Azure Key Vault AVM module",
        source: "https://github.com/Azure/terraform-azurerm-avm-res-keyvault-vault",
        downloads: 1200,
        verified: true,
      },
    ],
    meta: { limit: 1, current_offset: 0, next_offset: 1 },
  },
  details: {
    id: "Azure/avm-res-keyvault-vault/azurerm/0.10.0",
    namespace: "Azure",
    name: "avm-res-keyvault-vault",
    provider: "azurerm",
    version: "0.10.0",
    description: "Azure Key Vault AVM module",
    source: "https://github.com/Azure/terraform-azurerm-avm-res-keyvault-vault",
    downloads: 1200,
    verified: true,
  },
  moduleVersions: {
    modules: [
      {
        source: "azure/avm-res-keyvault-vault/azurerm",
        versions: [{ version: "0.9.0" }, { version: "0.10.0" }, { version: "0.11.0-beta.1" }],
      },
    ],
  },
  providerVersions: {
    id: "hashicorp/azurerm",
    versions: [{ version: "4.2.0" }, { version: "4.10.0" }, { version: "4.11.0-beta.1" }],
  },
} as const;
