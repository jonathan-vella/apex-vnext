@description('Approved Azure region.')
param location string

@description('Approved development resource tags.')
param tags object

@description('User object ID for credential storage and rotation.')
param credentialOwnerObjectId string

@description('Ingestion service principal object ID, or empty for initial provisioning.')
param publisherObjectId string

@description('Log Analytics workspace name.')
param workspaceName string

@description('Application Insights resource name.')
param insightsName string

var uniqueSuffix = uniqueString(resourceGroup().id)
var devTags = union(tags, { environment: 'dev' })

module workspace 'br/public:avm/res/operational-insights/workspace:0.16.1' = {
  name: 'workspace'
  params: {
    name: workspaceName
    location: location
    tags: devTags
    enableTelemetry: false
    skuName: 'PerGB2018'
    dataRetention: 30
    forceCmkForQuery: false
    features: {
      disableLocalAuth: true
      immediatePurgeDataOn30Days: true
    }
    diagnosticSettings: [
      {
        name: 'workspace-diagnostics'
        useThisWorkspace: true
        logCategoriesAndGroups: [{ categoryGroup: 'allLogs' }]
        metricCategories: [{ category: 'AllMetrics' }]
      }
    ]
  }
}

module insights 'br/public:avm/res/insights/component:0.8.0' = {
  name: 'application-insights'
  params: {
    name: insightsName
    kind: 'other'
    applicationType: 'other'
    location: location
    tags: devTags
    enableTelemetry: false
    workspaceResourceId: workspace.outputs.resourceId
    disableLocalAuth: true
    disableIpMasking: false
    retentionInDays: 30
    immediatePurgeDataOn30Days: true
    samplingPercentage: 100
    roleAssignments: empty(publisherObjectId)
      ? []
      : [
          {
            principalId: publisherObjectId
            principalType: 'ServicePrincipal'
            roleDefinitionIdOrName: 'Monitoring Metrics Publisher'
          }
        ]
    diagnosticSettings: [
      {
        name: 'insights-metrics'
        workspaceResourceId: workspace.outputs.resourceId
        logCategoriesAndGroups: []
        metricCategories: [{ category: 'AllMetrics' }]
      }
    ]
  }
}

module vault 'br/public:avm/res/key-vault/vault:0.14.2' = {
  name: 'credential-vault'
  params: {
    name: 'kv-apex-${uniqueSuffix}'
    location: location
    tags: devTags
    enableTelemetry: false
    sku: 'standard'
    enableRbacAuthorization: true
    enablePurgeProtection: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 30
    enableVaultForDeployment: false
    enableVaultForTemplateDeployment: false
    enableVaultForDiskEncryption: false
    publicNetworkAccess: 'Disabled'
    networkAcls: {
      defaultAction: 'Deny'
      bypass: 'None'
      ipRules: []
    }
    roleAssignments: [
      {
        principalId: credentialOwnerObjectId
        principalType: 'User'
        roleDefinitionIdOrName: 'Key Vault Secrets Officer'
      }
    ]
    diagnosticSettings: [
      {
        name: 'vault-audit'
        workspaceResourceId: workspace.outputs.resourceId
        logAnalyticsDestinationType: 'Dedicated'
        logCategoriesAndGroups: [{ categoryGroup: 'allLogs' }]
        metricCategories: [{ category: 'AllMetrics' }]
      }
    ]
  }
}

resource workspaceReference 'Microsoft.OperationalInsights/workspaces@2025-07-01' existing = {
  name: workspaceName
}

resource appTables 'Microsoft.OperationalInsights/workspaces/tables@2025-07-01' = [
  for tableName in [
    'AppDependencies'
    'AppRequests'
    'AppTraces'
    'AppExceptions'
    'AppEvents'
    'AppMetrics'
  ]: {
    parent: workspaceReference
    name: tableName
    properties: {
      retentionInDays: 30
      totalRetentionInDays: 30
    }
    dependsOn: [insights]
  }
]

output workspaceResourceId string = workspace.outputs.resourceId
output applicationInsightsResourceId string = insights.outputs.resourceId
output vaultName string = vault.outputs.name
