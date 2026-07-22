import { Reporter } from "./reporter.mjs";

export function registryDiagnostic(source, diagnostic) {
  const match = diagnostic.match(/^((?:\.?\.?\/)?(?:[\w@.-]+\/)+[\w@.-]+): (.+)$/u);
  return match === null ? { file: source, message: diagnostic } : { file: match[1], message: match[2] };
}

export function reportRegistryValidation({ title, source, errors, passMessage, format = "text" }) {
  const reporter = new Reporter(title);
  reporter.tick();

  const diagnostics = errors.map((message) => registryDiagnostic(source, message));
  for (const diagnostic of diagnostics) {
    reporter.record({ severity: "error", ...diagnostic });
  }

  if (format === "json") {
    const summary = { errors: errors.length, warns: 0, infos: 0 };
    console.log(JSON.stringify({ summary, findings: reporter.findings }, null, 2));
    return errors.length === 0 ? 0 : 1;
  }

  reporter.header();
  for (const { file, message } of diagnostics) reporter.error(file, message);
  if (errors.length === 0) reporter.ok(source, passMessage);
  reporter.summary();
  console.log(errors.length === 0 ? `\n✅ ${passMessage}` : `\n❌ ${errors.length} error(s) found`);
  return errors.length === 0 ? 0 : 1;
}

export function requestedReportFormat(args) {
  return args.includes("--format=json") ? "json" : "text";
}
