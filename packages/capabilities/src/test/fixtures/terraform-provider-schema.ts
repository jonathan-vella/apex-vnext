export const terraformProviderSchemaFixture = {
  schema: {
    format_version: "1.0",
    provider_schemas: {
      "registry.terraform.io/hashicorp/azurerm": {
        provider: { version: 0, block: { attributes: { client_secret: { type: "string", optional: true } } } },
        resource_schemas: {
          azurerm_storage_account: { version: 4, block: { attributes: { name: { type: "string", required: true } } } },
        },
        data_source_schemas: {
          azurerm_client_config: {
            version: 0,
            block: { attributes: { client_id: { type: "string", computed: true } } },
          },
        },
        list_resource_schemas: {
          azurerm_storage_account: { version: 0, block: { attributes: {} } },
        },
        future_field: { preserved: true },
      },
    },
  },
  version: {
    terraform_version: "1.14.7",
    platform: "linux_amd64",
    provider_selections: { "registry.terraform.io/hashicorp/azurerm": "4.81.0" },
  },
} as const;
