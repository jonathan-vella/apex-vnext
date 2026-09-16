targetScope = 'subscription'

@description('Resource group approved for development telemetry.')
param resourceGroupName string = 'rg-apex-insights-swc01'

@description('Approved Azure region.')
param location string = 'swedencentral'

@description('Log Analytics workspace name for this deployment.')
param workspaceName string = 'law-apex-insights-swc01'

@description('Application Insights resource name for this deployment.')
param insightsName string = 'appi-apex-insights-swc01'

@description('Optional tag overrides; this template always enforces environment=dev.')
param resourceTags object = {}

@description('Object ID of the user managing the collector credential.')
param credentialOwnerObjectId string

@description('Service principal object ID permitted to ingest telemetry; empty during initial provisioning.')
param publisherObjectId string = ''

var tags = union({
  environment: 'dev'
  owner: 'jonathan'
  costcenter: 'development'
  application: 'apex-insights'
  workload: 'agent-debugging'
  sla: 'development'
  'backup-policy': 'none'
  'maint-window': 'ad-hoc'
  'technical-contact': 'jonathan'
}, resourceTags, { environment: 'dev' })

module group 'br/public:avm/res/resources/resource-group:0.4.4' = {
  name: 'apex-insights-group'
  params: {
    name: resourceGroupName
    location: location
    tags: tags
    enableTelemetry: false
  }
}

module resources './resources.bicep' = {
  name: 'apex-insights-resources'
  scope: resourceGroup(resourceGroupName)
  params: {
    location: location
    tags: tags
    credentialOwnerObjectId: credentialOwnerObjectId
    publisherObjectId: publisherObjectId
    workspaceName: workspaceName
    insightsName: insightsName
  }
  dependsOn: [group]
}

output resourceGroupId string = group.outputs.resourceId
output workspaceResourceId string = resources.outputs.workspaceResourceId
output applicationInsightsResourceId string = resources.outputs.applicationInsightsResourceId
output vaultName string = resources.outputs.vaultName
