export function validateManagedHandoffs(agents) {
  const errors = [];
  const names = new Set(agents.map(({ name }) => name));
  for (const agent of agents) {
    const handoffs = agent.handoffs ?? [];
    const delegates = agent.agents ?? [];
    if (!Array.isArray(handoffs) || !Array.isArray(delegates)) {
      errors.push(`${agent.name}: handoffs and agents must be arrays`);
      continue;
    }
    for (const target of delegates) {
      if (typeof target !== "string" || !names.has(target)) errors.push(`${agent.name}: unknown delegate ${target}`);
    }
    const selfLoops = handoffs.filter((handoff) => handoff?.agent === agent.name);
    if (selfLoops.length > 6) errors.push(`${agent.name}: too many self-loop handoffs`);
    for (const handoff of handoffs) {
      if (!names.has(handoff?.agent)) errors.push(`${agent.name}: unknown handoff target ${handoff?.agent}`);
      if (handoff?.agent === agent.name) {
        const prompt = String(handoff.prompt ?? "");
        if (
          !(/\bInput\b/iu.test(prompt) || /agent-output\/.+\.md/iu.test(prompt)) ||
          !(/Output\s*:/iu.test(prompt) || /agent-output\/.+\.md/iu.test(prompt))
        ) {
          errors.push(`${agent.name}: self-loop requires input and output references`);
        }
      }
    }
  }
  return errors;
}
