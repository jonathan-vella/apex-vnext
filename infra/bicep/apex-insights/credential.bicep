@description('Existing private vault receiving the collector credential through ARM.')
param vaultName string

@description('Name of the credential secret.')
param secretName string

@description('Entra credential value; never returned in outputs or recorded in deployment history.')
@secure()
param secretValue string

@description('Credential expiration in Unix epoch seconds.')
param expiresAt int

module credential 'br/public:avm/res/key-vault/vault/secret:0.1.1' = {
  name: 'collector-credential'
  params: {
    keyVaultName: vaultName
    name: secretName
    value: secretValue
    attributesEnabled: true
    attributesExp: expiresAt
    contentType: 'Entra client secret'
    enableTelemetry: false
  }
}
