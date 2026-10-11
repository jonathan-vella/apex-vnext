export interface CommandPlan {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  /** Extra environment variables merged over the process environment. */
  readonly env?: Readonly<Record<string, string>>;
}

/** Bicep source validation with the Bicep CLI; it only compiles and never talks to Azure. */
export class BicepCommandAdapter {
  validate(templateFile: string, cwd?: string): CommandPlan {
    return { executable: "bicep", args: ["build", templateFile], ...(cwd === undefined ? {} : { cwd }) };
  }
}

export class TerraformCommandAdapter {
  providerSchemas(cwd: string): CommandPlan {
    return { executable: "terraform", args: ["providers", "schema", "-json"], cwd };
  }

  versionJson(cwd: string): CommandPlan {
    return { executable: "terraform", args: ["version", "-json"], cwd };
  }

  init(cwd: string, backend: boolean): CommandPlan {
    return {
      executable: "terraform",
      args: ["init", `-backend=${String(backend)}`, "-input=false"],
      cwd,
    };
  }

  validate(cwd: string): readonly CommandPlan[] {
    return [
      { executable: "terraform", args: ["fmt", "-check"], cwd },
      { executable: "terraform", args: ["validate"], cwd },
    ];
  }

  preview(cwd: string, savedPlanPath: string, destroy = false): CommandPlan {
    this.#requirePlanPath(savedPlanPath);
    return {
      executable: "terraform",
      args: ["plan", ...(destroy ? ["-destroy"] : []), `-out=${savedPlanPath}`, "-input=false"],
      cwd,
    };
  }

  applyExact(cwd: string, savedPlanPath: string): CommandPlan {
    this.#requirePlanPath(savedPlanPath);
    return { executable: "terraform", args: ["apply", "-input=false", savedPlanPath], cwd };
  }

  showJson(cwd: string, savedPlanPath: string): CommandPlan {
    this.#requirePlanPath(savedPlanPath);
    return { executable: "terraform", args: ["show", "-json", savedPlanPath], cwd };
  }

  statePull(cwd: string): CommandPlan {
    return { executable: "terraform", args: ["state", "pull"], cwd };
  }

  #requirePlanPath(savedPlanPath: string): void {
    if (savedPlanPath.trim().length === 0 || savedPlanPath.startsWith("-")) {
      throw new TypeError("A concrete saved Terraform plan path is required");
    }
  }
}

export class AzureCliReadAdapter {
  resourceGraph(query: string, subscriptions: readonly string[] = []): CommandPlan {
    return {
      executable: "az",
      args: [
        "graph",
        "query",
        "--graph-query",
        query,
        ...(subscriptions.length === 0 ? [] : ["--subscriptions", ...subscriptions]),
        "--output",
        "json",
      ],
    };
  }

  /** Resource groups of the subscription tagged `azd-env-name`, which is how azd finds an environment's groups. */
  taggedResourceGroups(subscriptionId: string, environmentName: string): CommandPlan {
    return {
      executable: "az",
      args: [
        "group",
        "list",
        "--subscription",
        subscriptionId,
        "--tag",
        `azd-env-name=${environmentName}`,
        "--output",
        "json",
      ],
    };
  }

  resourceGroupResources(subscriptionId: string, resourceGroup: string): CommandPlan {
    return {
      executable: "az",
      args: [
        "resource",
        "list",
        "--subscription",
        subscriptionId,
        "--resource-group",
        resourceGroup,
        "--output",
        "json",
      ],
    };
  }

  /** One resource by its exact ID, including child and extension resources that a group listing omits. */
  resourceById(resourceId: string): CommandPlan {
    return { executable: "az", args: ["resource", "show", "--ids", resourceId, "--output", "json"] };
  }

  /** The signed-in Azure CLI account: cloud name, tenant and default subscription. */
  account(): CommandPlan {
    return { executable: "az", args: ["account", "show", "--output", "json"] };
  }

  armGet(resourceId: string, apiVersion: string): CommandPlan {
    return {
      executable: "az",
      args: ["rest", "--method", "get", "--url", `${resourceId}?api-version=${encodeURIComponent(apiVersion)}`],
    };
  }
}
