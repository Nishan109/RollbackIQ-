import { MAX_FILE_BYTES, type SchemaChange, type Severity, severities } from "../contracts";
import { isMigrationPath, scanMigrations } from "../index";
import { objectName } from "../identifiers";
import { isBuiltinType } from "../postgres";
import { obscuresNames, proposedCatalog, readCatalog, tableKey } from "./catalog";
import type {
  CompatibilityFinding,
  CompatibilityInput,
  CompatibilityReport,
  CoverageGap,
  DependencyEvidence,
} from "./contracts";
import { analyzeDependencies, stableId } from "./dependencies";
import { changeRule, compatibilityRules, dependenciesFor } from "./rules";
import { queryParser } from "./sql";

export * from "./contracts";
export { compatibilityRules } from "./rules";
export { compatibilitySarif } from "./report";

function validateInput(input: CompatibilityInput) {
  if (input.postgresMajor !== undefined && input.postgresMajor !== 18)
    throw new Error(
      "This analyzer supports PostgreSQL 18 syntax. Use --postgres 18 and verify behavior on the target server version.",
    );
  const schema = input.defaultSchema ?? "public";
  if (!schema || Buffer.byteLength(schema) > 63 || /[\p{Cc}\p{Cf}]/u.test(schema))
    throw new Error("Provide a nonempty PostgreSQL default schema of at most 63 UTF-8 bytes.");
  if (
    input.baseline &&
    (!isMigrationPath(input.baseline.path) ||
      Buffer.byteLength(input.baseline.sql) > MAX_FILE_BYTES ||
      input.baseline.sql.includes("\0"))
  )
    throw new Error("Provide a bounded UTF-8 .sql baseline.");
  for (const snapshot of [input.previous, input.proposed]) {
    if (
      !snapshot.release.ref ||
      snapshot.release.ref.length > 256 ||
      /[\p{Cc}\p{Cf}]/u.test(snapshot.release.ref)
    )
      throw new Error("Each snapshot requires its own valid release reference.");
    if (
      snapshot.sources.length > 400 ||
      snapshot.sources.reduce((size, file) => size + Buffer.byteLength(file.text), 0) >
        6 * 1024 * 1024
    )
      throw new Error("Source snapshot exceeds 400 files or 6 MiB.");
    const paths = new Set<string>();
    for (const file of [...snapshot.sources, ...(snapshot.prisma ? [snapshot.prisma] : [])]) {
      if (
        !isMigrationPath(`${file.path}.sql`) ||
        paths.has(file.path) ||
        Buffer.byteLength(file.text) > MAX_FILE_BYTES ||
        file.text.includes("\0")
      )
        throw new Error("Source snapshots require unique, bounded relative UTF-8 file paths.");
      paths.add(file.path);
    }
  }
  return schema;
}

function finalColumns(changes: SchemaChange[], schema: string) {
  const columns = new Map<string, Map<string, number>>();
  for (const [index, change] of changes.entries()) {
    if (!change.target) continue;
    const key = tableKey(change.target, schema);
    if (change.operation === "drop-table") columns.delete(key);
    const column = change.target.column;
    if (!column) continue;
    if (change.operation === "drop-column" || change.operation === "rename-column")
      columns.get(key)?.delete(column);
    const replacement =
      change.operation === "add-column"
        ? column
        : change.operation === "rename-column"
          ? change.newColumn
          : undefined;
    if (!replacement) continue;
    const table = columns.get(key) ?? new Map<string, number>();
    table.set(replacement, index);
    columns.set(key, table);
  }
  return columns;
}

function indexDependencies(references: DependencyEvidence[], schema: string) {
  const index = new Map<string, DependencyEvidence[]>();
  for (const reference of references) {
    const key = tableKey(reference.target, schema);
    const evidence = index.get(key) ?? [];
    evidence.push(reference);
    index.set(key, evidence);
  }
  return index;
}

export async function analyzeCompatibility(
  input: CompatibilityInput,
): Promise<CompatibilityReport> {
  const defaultSchema = validateInput(input);
  const gaps: CoverageGap[] = [...(input.gaps ?? [])];
  const migrationReport = input.migrations.length ? await scanMigrations(input.migrations) : null;
  const changes = migrationReport?.files.flatMap(({ changes }) => changes) ?? [];
  const maxOperations = 2500;
  if (changes.length > maxOperations)
    gaps.push({
      kind: "limit",
      scope: "migrations",
      message: `Compatibility matching covers the first ${maxOperations} normalized operations. Review remaining operations in the migration report.`,
    });
  const finalAdditions = finalColumns(changes, defaultSchema);
  const previousCatalog = await readCatalog(input.baseline, defaultSchema, gaps);
  const parser = queryParser();
  const previous = await analyzeDependencies(
    input.previous,
    "previous",
    defaultSchema,
    previousCatalog,
    parser,
  );
  const proposed = await analyzeDependencies(
    input.proposed,
    "proposed",
    defaultSchema,
    proposedCatalog(previousCatalog, changes, defaultSchema),
    parser,
  );
  gaps.push(...previous.gaps, ...proposed.gaps);
  const previousByTable = indexDependencies(previous.references, defaultSchema);
  const proposedByTable = indexDependencies(proposed.references, defaultSchema);
  for (const change of changes) {
    if (change.operation === "add-column" && !isBuiltinType(change.dataType ?? "")) {
      gaps.push({
        kind: "schema",
        scope: "migrations",
        message:
          "The added column uses a type whose defaults or constraints require catalog verification.",
        location: change.location,
      });
    }
  }
  const findings: CompatibilityFinding[] = [];
  const limitations = [
    `Unqualified database names are resolved against the configured default schema ${defaultSchema}. Runtime search_path changes require verification.`,
    "Source evidence identifies supported static queries, including simple SQL-equivalent Supabase calls. It does not establish which code paths execute, inspect external services, or cover generated code and database-side dependencies.",
    "Migrations are considered in the supplied order, with Git inputs ordered by repository path. Verify this against the project's migration runner and deployment history.",
  ];
  const unknownHistory = gaps.some(
    ({ scope, kind }) => scope === "migrations" || kind === "history",
  );
  const migrationNamesUnknown = changes.some(obscuresNames);
  const sourceParseErrors = previous.gaps.some(
    ({ kind, message }) => kind === "source" && message.includes("syntax errors"),
  );
  const runtimeSchemaUnknown = previous.gaps.some(({ kind }) => kind === "runtime-schema");

  const newTables = new Set<string>();
  for (const [index, change] of changes.slice(0, maxOperations).entries()) {
    if (obscuresNames(change)) newTables.clear();
    if (!change.target) continue;
    const key = tableKey(change.target, defaultSchema);
    if (change.operation === "drop-table") newTables.delete(key);
    if (
      change.operation === "create-table" &&
      (!change.conditional ||
        (previousCatalog && !previousCatalog.has(key) && !migrationNamesUnknown))
    )
      newTables.add(key);
    if (change.operation === "enable-row-security") {
      const previousEvidence = previousByTable.get(key) ?? [];
      if (newTables.has(key) && !previousEvidence.length) continue;
      findings.push({
        id: `COMPAT010-${change.id}`,
        ruleId: "COMPAT010",
        title: "Row-level security may change access",
        severity: "high",
        status: "potentially_incompatible",
        confidence: previousEvidence.length ? "medium" : "low",
        object: objectName({ ...change.target, schema: change.target.schema ?? defaultSchema }),
        message: previousEvidence.length
          ? "The previous release accesses this table. Enabling row-level security can filter reads or reject writes."
          : "The scan could not establish that this table is newly created. Enabling row-level security can change access if it already exists.",
        recommendation:
          "Verify whether the table already exists and test previous-release reads and writes with the affected roles.",
        limitations: [
          "Runtime roles, row-level security policies, and the deployed catalog were not evaluated.",
        ],
        location: change.location,
        previousEvidence: previousEvidence.slice(0, 50),
        proposedEvidence: (proposedByTable.get(key) ?? []).slice(0, 50),
      });
      continue;
    }
    const rule = changeRule(change);
    if (!rule) continue;
    const previousEvidence = dependenciesFor(change, previousByTable.get(key) ?? [], defaultSchema);
    if (!previousEvidence.length) continue;
    const proposedEvidence = dependenciesFor(change, proposedByTable.get(key) ?? [], defaultSchema);
    const nameRemoval = ["drop-table", "drop-column", "rename-column"].includes(change.operation);
    const preciseEvidence = previousEvidence.some(
      (evidence) =>
        evidence.confidence === "high" &&
        (change.operation === "drop-table" || evidence.access === "column"),
    );
    const restored =
      !!change.target.column && (finalAdditions.get(key)?.get(change.target.column) ?? -1) > index;
    const baselineConflict =
      !!previousCatalog &&
      change.operation !== "add-column" &&
      (!previousCatalog.has(key) ||
        (!!change.target.column && !previousCatalog.get(key)?.has(change.target.column)));
    if (baselineConflict)
      gaps.push({
        kind: "schema",
        scope: "schema",
        message: "The supplied baseline does not contain this referenced migration target.",
        location: change.location,
      });
    const certain =
      nameRemoval &&
      preciseEvidence &&
      !unknownHistory &&
      !migrationNamesUnknown &&
      !sourceParseErrors &&
      !runtimeSchemaUnknown &&
      !restored &&
      !change.conditional &&
      !baselineConflict;
    const extraLimitations = [
      ...(change.conditional
        ? [
            "The migration uses a conditional operation and its catalog precondition was not verified.",
          ]
        : []),
      ...(restored
        ? [
            "A later operation recreates or renames the affected column. Validate the final type, defaults, data, and query behavior.",
          ]
        : []),
      ...(baselineConflict
        ? ["The supplied baseline conflicts with this dependency or migration target."]
        : []),
      ...(migrationNamesUnknown
        ? ["Another migration operation leaves the final object names unresolved."]
        : []),
      ...(unknownHistory
        ? [
            "The application of these migrations in the proposed release requires history verification.",
          ]
        : []),
      ...(previousEvidence.length > 50 || proposedEvidence.length > 50
        ? [
            "Each finding displays up to 50 references per release. See the dependency graph for additional references.",
          ]
        : []),
    ];
    const definition = compatibilityRules.find(({ id }) => id === rule.ruleId);
    const target = change.target && {
      ...change.target,
      schema: change.target.schema ?? defaultSchema,
    };
    findings.push({
      id: `${rule.ruleId}-${change.id}`,
      ruleId: rule.ruleId,
      title: definition?.title ?? rule.ruleId,
      severity: rule.severity,
      status: certain ? "incompatible" : "potentially_incompatible",
      confidence: certain ? "high" : preciseEvidence ? "medium" : "low",
      object: target ? objectName(target) : change.object,
      message: certain
        ? "A supported previous-release query names an object removed by this migration plan. It would fail to resolve that object against the resulting schema."
        : "Previous-release dependency evidence intersects this schema change. Verify the resulting query and write behavior.",
      recommendation: rule.recommendation,
      limitations: extraLimitations,
      location: change.location,
      previousEvidence: previousEvidence.slice(0, 50),
      proposedEvidence: proposedEvidence.slice(0, 50),
    });
  }

  for (const change of changes) {
    if (change.operation === "unsupported" || change.operation === "parse-error") {
      gaps.push({
        kind: change.operation === "unsupported" ? "unsupported-sql" : "migration",
        scope: "migrations",
        message: change.detail,
        location: change.location,
      });
    }
  }
  const distinctGaps = [...new Map(gaps.map((gap) => [JSON.stringify(gap), gap])).entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, gap]) => gap);
  const reportedGaps = distinctGaps.slice(0, 1500);
  if (distinctGaps.length > reportedGaps.length)
    reportedGaps.push({
      kind: "limit",
      scope: "migrations",
      message: `${distinctGaps.length - reportedGaps.length} additional coverage gaps were omitted from the report.`,
    });
  for (const gap of reportedGaps) {
    const ruleId =
      gap.kind === "dynamic-sql"
        ? "COMPAT007"
        : gap.scope === "migrations" && gap.kind === "unsupported-sql"
          ? "COMPAT008"
          : "COMPAT010";
    const definition = compatibilityRules.find(({ id }) => id === ruleId);
    findings.push({
      id: `${ruleId}-${stableId(gap)}`,
      ruleId,
      title: definition?.title ?? ruleId,
      severity: "info",
      status: "unknown",
      confidence: "low",
      object: null,
      message: gap.message,
      recommendation:
        "Inspect the uncovered construct and verify previous-release behavior against a migrated test database.",
      limitations: [
        "This coverage gap prevents a complete conclusion within the configured scope.",
      ],
      location: gap.location,
      previousEvidence: [],
      proposedEvidence: [],
    });
  }
  const incompatible = findings.some(({ status }) => status === "incompatible");
  const potential = findings.some(({ status }) => status === "potentially_incompatible");
  const unmatchedRisk = changes.some(({ operation }) =>
    [
      "drop-table",
      "drop-column",
      "rename-column",
      "alter-type",
      "set-not-null",
      "add-constraint",
      "drop-constraint",
    ].includes(operation),
  );
  const status = incompatible
    ? "incompatible"
    : gaps.length
      ? "unknown"
      : potential || unmatchedRisk
        ? "potentially_incompatible"
        : "compatible_within_analyzed_scope";
  return {
    schemaVersion: 1,
    kind: "release-compatibility",
    previous: input.previous.release,
    proposed: input.proposed.release,
    defaultSchema,
    postgresMajor: 18,
    status,
    migrationReport,
    migrationChanges: input.migrationChanges ?? [],
    sourceChanges: input.sourceChanges ?? [],
    dependencies: { previous, proposed },
    findings,
    coverage: { gaps: reportedGaps, limitations, baseline: input.baseline ? "supplied" : "absent" },
  };
}

export function compatibilityPolicy(
  report: CompatibilityReport,
  policy: { failOn: Severity | "none"; failOnIncomplete: boolean },
) {
  const threshold = policy.failOn === "none" ? -1 : severities.indexOf(policy.failOn);
  const findingIds = [
    ...report.findings
      .filter(({ severity }) => severities.indexOf(severity) <= threshold)
      .map(({ id }) => id),
    ...(report.migrationReport?.findings
      .filter(({ severity }) => severities.indexOf(severity) <= threshold)
      .map(({ id }) => id) ?? []),
  ];
  const incomplete =
    policy.failOnIncomplete && (report.coverage.gaps.length > 0 || report.status === "unknown");
  return { blocked: findingIds.length > 0 || incomplete, findingIds, incomplete };
}
