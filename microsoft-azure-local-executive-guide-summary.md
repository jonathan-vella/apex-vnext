# Microsoft Azure Local: An Executive Guide to Sovereign Private Cloud Architecture

**Author:** Julien Lemarchal, Content Manager  
**Source:** [Devoteam](https://www.devoteam.com/expert-view/microsoft-azure-local-guide-to-sovereign-private-cloud-architecture/)

Defence contractors, public agencies, banks, and hospitals all face the same challenge. Data must
stay within legal boundaries. The cloud must come to them. Public cloud infrastructure, however
mature, cannot satisfy jurisdictional mandates that require data to remain within a specific legal
boundary or physical facility.

Azure Local addresses this directly. It brings the Azure management model — the same portal,
policies, and tooling that operations teams already use — and runs it on hardware that the
organisation owns, controls, and can physically isolate if required. As of
[February 2026](https://blogs.microsoft.com/blog/2026/02/24/microsoft-sovereign-cloud-adds-governance-productivity-and-support-for-large-ai-models-securely-running-even-when-completely-disconnected/),
this extends to full disconnected operation: no Microsoft data center required, not even for
control plane management.

This guide is for CTOs and CIOs evaluating Azure Local as the foundation for a sovereign private
cloud strategy. It covers architecture, workload fit, the VMware migration case, and the governance
model introduced in the February 2026 release.

## In This Article, You’ll Read

- [Azure Local: Key Takeaways](#azure-local-key-takeaways)
- [Azure Local: Architecture and How It Works](#azure-local-architecture-and-how-it-works)
- [Azure Local vs. Azure Public Cloud: Choosing the Right Boundary](#azure-local-vs-azure-public-cloud-choosing-the-right-boundary)
- [Workload Scenarios: What Azure Local Is Built For](#workload-scenarios-what-azure-local-is-built-for)
  - [Virtualised and Containerised Applications](#virtualised-and-containerised-applications)
  - [Remote and Branch Office Deployments](#remote-and-branch-office-deployments)
  - [High-Performance Data and Desktop Services](#high-performance-data-and-desktop-services)
- [Azure Local as a VMware Alternative](#azure-local-as-a-vmware-alternative)
  - [The Financial Case](#the-financial-case)
  - [VMWare to Azure Local: The Migration Path](#vmware-to-azure-local-the-migration-path)
- [Microsoft Sovereign Private Cloud: A Full-Stack Architecture](#microsoft-sovereign-private-cloud-a-full-stack-architecture)
  - [Azure Local Disconnected Operations (ALDO)](#azure-local-disconnected-operations-aldo)
  - [Microsoft 365 Local: Productivity Without SaaS](#microsoft-365-local-productivity-without-saas)
  - [Foundry Local: On-Premises AI Inference](#foundry-local-on-premises-ai-inference)
- [Deployment and Operational Governance](#deployment-and-operational-governance)
  - [Networking](#networking)
  - [Identity and Secret Management](#identity-and-secret-management)
  - [Lifecycle Management and Updates](#lifecycle-management-and-updates)

## Azure Local: Key Takeaways

1. Azure Local delivers a complete sovereign private cloud — infrastructure, productivity, and AI —
   running entirely within your own facilities.
2. As of February 2026, Azure Local Disconnected Operations (ALDO) eliminates all dependencies on
   Microsoft’s regional data centres for day-to-day management.
3. Organisations with existing Windows Server Datacenter licences under Software Assurance can run
   Azure Local at zero core licensing cost.
4. Migration from VMware is portal-driven, with data never leaving the customer network.
5. Microsoft has committed platform support through at least 2035, covering full public sector and
   defence mission lifecycles.

## Azure Local: Architecture and How It Works

Azure Local is a hyperconverged infrastructure (HCI) software stack that runs on validated
bare-metal hardware, pooling compute, storage, and networking into a single, highly available
cluster. It scales from one node to sixteen and is managed through Azure Arc, giving operations
teams a single control plane across on-premises and cloud environments.

What distinguishes Azure Local from conventional virtualisation platforms is that security is built
into the baseline, not added later. Secure Boot, TPM attestation, and Virtualisation-Based Security
(VBS) are active by default on every deployment. This matters for procurement and compliance teams:
the platform ships secure, rather than requiring post-deployment hardening.

The February 2026 release refreshes core platform components, extends the disconnected operations
capability, and aligns the local management plane with the latest Azure security and performance
standards.

## Azure Local vs. Azure Public Cloud: Choosing the Right Boundary

Azure and Azure Local share a common management interface and operational model, but they represent
fundamentally different answers to the question of who controls the physical layer.

Public Azure is a multi-tenant, hyperscale environment. Microsoft owns and operates the
infrastructure globally. Customers focus on applications. Microsoft manages everything beneath.

That model works well for workloads without jurisdictional constraints, where scale and global
reach matter more than data location.

Azure Local reverses the ownership model. Physical infrastructure, data location, and
jurisdictional control sit with the customer. The operational benefits of Azure — consistent
tooling, policy enforcement, update management — are preserved, but nothing leaves the customer’s
facility unless the customer decides it should.

**The critical distinction on connectivity**

Public Azure requires constant, high-bandwidth internet connectivity. Azure Local is designed for
the full spectrum: cloud-connected mode for organisations that want hybrid management, and — as of
February 2026 — fully disconnected mode for environments where external connectivity is impossible
or unacceptable.

## Workload Scenarios: What Azure Local Is Built For

Azure Local runs both traditional and modern workloads on the same hardware, avoiding the common
trade-off between legacy compatibility and cloud-native capability.

### Virtualised and Containerised Applications

Legacy enterprise applications — Windows Server or Linux — run as Azure Arc-enabled virtual
machines with built-in high availability: automated failover, live migration, and cluster
resiliency. For teams moving toward containerised architectures, AKS on Azure Local brings the same
Kubernetes management experience from the public cloud to on-premises infrastructure, using the
same tooling and deployment pipelines.

### Remote and Branch Office Deployments

Two-node clusters with switchless networking keep hardware costs low at small or remote sites while
retaining centralised management through the Azure portal. In these environments, Azure Local
typically hosts the services that must remain local — file servers, print servers, domain
controllers — keeping them available even when connectivity to the main data centre drops.

### High-Performance Data and Desktop Services

For data-intensive workloads — SQL Server, Azure Arc-enabled data services — all-NVMe configurations
with Storage Spaces Direct deliver the throughput and low latency that real-time analytics and
transaction processing require. Azure Virtual Desktop can also be deployed on Azure Local, giving
users high-performance virtual desktops while keeping all session data within the local security
boundary. This is a common requirement in finance and healthcare, where both user experience and
data residency are non-negotiable.

## Azure Local as a VMware Alternative

Azure Local has become a credible replacement for legacy virtualisation platforms, VMware in
particular. Two forces are driving this: a changed licensing and cost environment following
Broadcom’s acquisition of VMware, and a genuine architectural case for the integrated hybrid model
Azure Local provides.

### The Financial Case

Azure Local costs
[$10 per physical core per month](https://azure.microsoft.com/en-us/pricing/details/azure-local/)
(public price, it may change depending on the Enterprise Agreement).

Organisations with existing Windows Server Datacenter licences under active Software Assurance can
apply those licences through the Azure Hybrid Benefit to reduce that fee to zero. In many
enterprises, the effective core platform fee can be effectively reduced.

Analysis from enterprise deployments in late 2025 and early 2026 indicates that migrating from a
traditional VMware three-tier architecture to Azure Local HCI can reduce server footprint by 50%
and cut total cost of ownership by approximately 30% over five years
([source](https://gcsit.com/azure-local-the-smart-path-beyond-vmware/)). Those savings compound:
reduced hardware means lower power consumption, and a unified management plane through Azure Arc
removes the need for separate vCenter or Aria licensing.

The table below compares the two platforms across the key financial dimensions:

| Financial Metric        | VMware (Broadcom Era)         | Microsoft Azure Local                         |
| ----------------------- | ----------------------------- | --------------------------------------------- |
| Licensing Basis         | Per-core subscription bundles | Per-core monthly subscription                 |
| Hybrid Savings          | License portability (vCF)     | Azure Hybrid Benefit (reducible to $0 core fee) |
| Management Cost         | Requires vCenter/Aria licensing | Included via Azure Arc and Portal             |
| Hardware Density        | Standard virtualisation overhead | HCI-optimised high density                   |
| Estimated TCO Reduction | Varies by bundle              | ~30% over 5 years vs. legacy                  |

**What this means in practice**

For an organisation running 200 physical cores on VMware today, switching to Azure Local with
active Software Assurance coverage could reduce annual platform licensing costs to zero while
delivering an estimated 30% reduction in five-year TCO through hardware consolidation and
simplified operations.

### VMWare to Azure Local: The Migration Path

The February 2026 updates to Azure Migrate have reduced the technical complexity of moving
workloads from VMware to Azure Local. Purpose-built scripts handle static IP preservation for both
Windows and Linux VMs, so complex network dependencies survive the transition. The entire process —
discovery, replication, and final cutover from
[VMware ESX to Azure Local](https://learn.microsoft.com/en-us/azure/azure-local/migrate/migrate-vmware-migrate?view=azloc-2602)
— runs through the Azure portal.

A critical operational detail: data never leaves the customer's network during migration. Unlike a
public cloud migration — where data travels over the internet or ExpressRoute — Azure Migrate for
Azure Local replicates directly between the source VMware environment and the target cluster,
entirely on-premises. The result is
[faster transfers, stronger data privacy, and minimal downtime](https://learn.microsoft.com/en-us/azure/azure-local/migrate/migration-azure-migrate-vmware-overview?view=azloc-2602).

## Microsoft Sovereign Private Cloud: A Full-Stack Architecture

The February 2026 announcements formalised the Sovereign Private Cloud as a distinct category in
Microsoft's portfolio. This is an architecture built for organisations with the most demanding
digital sovereignty requirements, resting on three components that together form a complete
on-premises stack:

- Azure Local — infrastructure autonomy and management
- Microsoft 365 Local — productivity continuity without SaaS dependencies
- Foundry Local — secure AI inference on-premises

The significance of this combination is practical: organisations have been able to achieve
infrastructure sovereignty through local virtualisation for years. What they could not do was run
modern productivity tools and AI models within the same local boundary. By bringing all three
layers under one management model, Microsoft now offers a configuration that closes the gap for
organisations requiring hard air-gap environments.

In Europe and the global defence sector, this matters commercially. Digital sovereignty has moved
from a niche compliance requirement to a core procurement criterion. Having a data centre on local
soil is no longer sufficient. Organisations now require operational and legal control over who can
access and administer their environments. A requirement that eliminates connectivity dependencies
entirely.

### Azure Local Disconnected Operations (ALDO)

In a standard Azure Local deployment, resource management flows through Azure's regional control
plane. In the disconnected mode introduced in February 2026, that control plane runs entirely
within a virtual appliance on the customer's own hardware, with no external connectivity required.

The local control plane delivers a locally hosted Azure-consistent management experience — portal,
ARM, Azure Policy, Key Vault — without any dependency on Microsoft's regional data centres.
Identity is handled locally through AD DS (Active Directory Domain Services) and AD FS (Active
Directory Federation Service), certificates are issued by an internal certificate authority, and a
minimum of three physical machines provides the redundancy needed to keep the local management
layer highly available.

**Designed for genuinely isolated environments**

ALDO is built for environments where internet access is impossible or operationally unacceptable:
naval vessels, underground facilities, tactical military deployments, and classified government
enclaves. The architecture removes phone-home dependencies entirely.

### Microsoft 365 Local: Productivity Without SaaS

Microsoft 365 Local brings core productivity services inside the sovereign boundary for
organisations that cannot rely on cloud-hosted SaaS. Running on Azure Local infrastructure, it
delivers Exchange Server for email, and SharePoint Server for document collaboration.

Microsoft has committed to supporting these workloads on Azure Local through at least 2035. A
commitment that matters for public sector and defence entities where programme lifecycles span
decades and software transitions carry real operational risk.

### Foundry Local: On-Premises AI Inference

Foundry Local enables organisations to run large multimodal AI models on their own hardware, with
data never leaving the local environment. It uses an OpenAI-compatible REST API and the ONNX Runtime
engine, so developers can use the same tools and APIs they use in the cloud — without changing their
development workflow.

Hardware support is broad: NVIDIA, AMD, Intel, Qualcomm, and Apple Silicon are all supported. For
organisations deploying custom or sensitive models,
[Microsoft Olive](https://microsoft.github.io/Olive/) compiles and optimises models from sources
such as Hugging Face into an efficient ONNX format tailored to local hardware. In disconnected
environments, models run from a local cache, keeping AI capabilities fully operational without any
external connectivity.

## Deployment and Operational Governance

Deploying Azure Local in sovereign or disconnected configurations is operationally complex. The
February 2026 release introduces tools to make governance more manageable at scale.

### Networking

For smaller deployments, Azure Local supports switchless networking — nodes connect directly via
dual network adapter ports in a full mesh, providing low-latency storage traffic without requiring
dedicated high-speed switches. For data-centre-scale deployments, dual Top-of-Rack switches provide
the redundancy and north-south connectivity required.

In both cases, RDMA-capable ports are mandatory for storage traffic.

### Identity and Secret Management

In disconnected environments, governance anchors in local identity. Initial operators are assigned
using Active Directory UPNs, and role-based access control is applied at the subscription scope
within the local management appliance. Secrets, certificates, and encryption keys — including
BitLocker recovery keys and API credentials — are managed through a locally deployed Azure Key
Vault instance. Backing up BitLocker keys immediately after deployment is essential: the management
appliance is encrypted by default.

### Lifecycle Management and Updates

Disconnected environments replace automated cloud updates with a deliberate, sequenced process.
Rather than pulling patches from the internet, administrators import signed, validated update
packages — covering operating system updates, OEM firmware, and AI model weights — through secure
transfer channels. The local management portal sequences these updates across cluster nodes one at
a time, migrating workloads and rebooting machines in turn to keep the environment continuously
available. This controlled cadence is the operational backbone of ongoing security and compliance
in air-gapped settings.

## Is Your Organisation Ready for Digital Sovereignty?

Azure Local is a significant undertaking. Before committing, three questions are worth resolving
internally.

### Do you have data or workloads that must remain on-premises due to legal or operational requirements?

- Yes
- No

<!-- markdownlint-disable-next-line MD013 -->
### Do you hold active Windows Server Datacenter licences with Software Assurance that could eliminate your Azure Local core fees?

- Yes
- No

### Are your VMware renewal costs prompting a broader infrastructure review?

- Yes
- No
