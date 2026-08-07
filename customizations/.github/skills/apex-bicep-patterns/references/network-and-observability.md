# Network And Observability

Use hub-spoke topology only when shared connectivity, inspection, DNS, or platform services are accepted architectural
requirements. Bind peering, routing, subnet, and network-security intent explicitly; do not imply those choices from a
resource name or a module default.

Private endpoint intent includes the target subresource, approved subnet, private DNS zone, and DNS zone group. A
private endpoint without its DNS and network dependencies is incomplete. Public access exceptions require an accepted
risk and policy-compatible boundary.

Every governed resource should have diagnostics and metrics mapped to the accepted monitoring destination. Category
selection, retention, cost, and ownership remain typed planning decisions; generated settings and deployment success
require validator and operation receipts.
