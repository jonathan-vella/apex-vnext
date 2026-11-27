targetScope = 'resourceGroup'

@description('Exact storage account name; the APEX plan binds the same name as the managed physical resource.')
@minLength(3)
@maxLength(24)
param storageAccountName string

@description('Azure region for the qualification workload.')
param location string = resourceGroup().location

@description('Live-policy tag contract applied to the workload.')
param tags object

@description('Resource ID of the shared Log Analytics workspace.')
param logAnalyticsWorkspaceResourceId string

module storageAccount 'br/public:avm/res/storage/storage-account:0.32.1' = {
  name: 'qualification-storage'
  params: {
    name: storageAccountName
    location: location
    tags: tags
    kind: 'StorageV2'
    skuName: 'Standard_LRS'
    allowBlobPublicAccess: false
    allowCrossTenantReplication: false
    allowSharedKeyAccess: false
    defaultToOAuthAuthentication: true
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    requireInfrastructureEncryption: true
    publicNetworkAccess: 'Disabled'
    networkAcls: {
      bypass: 'AzureServices, Logging, Metrics'
      defaultAction: 'Deny'
    }
    diagnosticSettings: [
      {
        name: 'diag-account'
        workspaceResourceId: logAnalyticsWorkspaceResourceId
        logAnalyticsDestinationType: 'Dedicated'
        metricCategories: [
          {
            category: 'AllMetrics'
          }
        ]
      }
    ]
    blobServices: {
      isVersioningEnabled: true
      deleteRetentionPolicyEnabled: true
      deleteRetentionPolicyDays: 7
      containerDeleteRetentionPolicyEnabled: true
      containerDeleteRetentionPolicyDays: 7
      diagnosticSettings: [
        {
          name: 'diag-blob'
          workspaceResourceId: logAnalyticsWorkspaceResourceId
          logAnalyticsDestinationType: 'Dedicated'
          logCategoriesAndGroups: [
            {
              categoryGroup: 'allLogs'
            }
          ]
          metricCategories: [
            {
              category: 'AllMetrics'
            }
          ]
        }
      ]
      containers: [
        {
          name: 'qualification'
          publicAccess: 'None'
        }
      ]
    }
    enableTelemetry: false
  }
}

output resourceId string = storageAccount.outputs.resourceId
output resourceName string = storageAccount.outputs.name
output principalId string = storageAccount.outputs.?systemAssignedMIPrincipalId ?? ''
