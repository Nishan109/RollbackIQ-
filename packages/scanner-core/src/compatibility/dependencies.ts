import { createHash } from "node:crypto";
import ts from "typescript";
import type { SourceLocation } from "../contracts";
import { objectName } from "../identifiers";
import type { Catalog } from "./catalog";
import type {
  CoverageGap,
  DependencyEvidence,
  DependencyGraph,
  GapKind,
  ReleaseSide,
  Snapshot,
} from "./contracts";
import { inspectPrisma, literalObject, prismaModels } from "./prisma";
import { sourceFile, typescriptProgram } from "./source-program";
import { inspectSql, type queryParser } from "./sql";
import { inspectSupabase, supabaseQuery } from "./supabase";

const MAX_QUERIES = 500;
const MAX_REFERENCES = 12000;
const QUERY_RECEIVERS = new Set(["db", "pool", "client", "pg", "connection"]);

export function stableId(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
}

export async function analyzeDependencies(
  snapshot: Snapshot,
  side: ReleaseSide,
  defaultSchema: string,
  catalog: Catalog | undefined,
  parseSql: ReturnType<typeof queryParser>,
): Promise<DependencyGraph> {
  const graph: DependencyGraph = {
    files: snapshot.sources.length,
    queries: 0,
    references: [],
    gaps: [],
    nodes: [],
    edges: [],
  };
  const seenGaps = new Set<string>();
  const seenReferences = new Set<string>();
  const nodes = new Set<string>();
  const addNode = (type: DependencyGraph["nodes"][number]["type"], label: string) => {
    const id = stableId([side, type, label]);
    if (!nodes.has(id)) {
      graph.nodes.push({ id, type, label });
      nodes.add(id);
    }
    return id;
  };
  const releaseNode = addNode("release", snapshot.release.commit ?? snapshot.release.ref);
  const addGap = (kind: GapKind, message: string, location?: SourceLocation) => {
    const gap: CoverageGap = { kind, scope: side, message, location };
    const key = JSON.stringify(gap);
    if (!seenGaps.has(key)) {
      graph.gaps.push(gap);
      seenGaps.add(key);
    }
  };
  const models = prismaModels(snapshot.prisma, defaultSchema, (kind, message) =>
    addGap(kind, message, snapshot.prisma && { path: snapshot.prisma.path, line: 1, column: 1 }),
  );
  const sourceFiles = new Map(
    snapshot.sources
      .filter(({ path }) => !path.endsWith(".sql"))
      .map(({ path, text }) => [path, sourceFile(path, text)]),
  );
  const program = typescriptProgram(sourceFiles, snapshot.typescriptConfigs ?? [], (path) =>
    addGap(
      "source",
      "TypeScript module configuration could not be fully resolved. Verify shared client imports.",
      { path, line: 1, column: 1 },
    ),
  );
  const checker = program.getTypeChecker();
  if (!snapshot.sources.length)
    addGap(
      "source",
      "No supported application source files were available in the configured release directories.",
    );

  for (const file of snapshot.sources) {
    const fileNode = addNode("file", file.path);
    graph.edges.push({ from: releaseNode, to: fileNode, kind: "RELEASE_CONTAINS_FILE" });
    const source = sourceFiles.get(file.path);
    const brokenSyntax = source ? program.getSyntacticDiagnostics(source).length > 0 : false;
    if (brokenSyntax)
      addGap(
        "source",
        "This source file has syntax errors. References are retained with reduced confidence.",
        { path: file.path, line: 1, column: 1 },
      );

    function queryContext(location: SourceLocation, kind: DependencyEvidence["kind"]) {
      graph.queries += 1;
      if (graph.queries > MAX_QUERIES) {
        addGap("limit", "The snapshot exceeds the query analysis limit.", location);
        return undefined;
      }
      const queryId = stableId([side, location, kind]);
      if (!nodes.has(queryId)) {
        nodes.add(queryId);
        graph.nodes.push({
          id: queryId,
          type: "query",
          label: `${location.path}:${location.line}:${location.column}`,
        });
        graph.edges.push({ from: fileNode, to: queryId, kind: "FILE_CONTAINS_QUERY", location });
      }
      const emit = (
        statement: DependencyEvidence["statement"],
        access: DependencyEvidence["access"],
        target: DependencyEvidence["target"],
        confidence: DependencyEvidence["confidence"],
        writeTarget = false,
      ) => {
        if (graph.references.length >= MAX_REFERENCES)
          return addGap("limit", "The snapshot exceeds the dependency reference limit.", location);
        const evidence: DependencyEvidence = {
          queryId,
          kind,
          statement,
          access,
          target,
          confidence: brokenSyntax ? "low" : confidence,
          location,
          writeTarget,
        };
        const key = JSON.stringify(evidence);
        if (seenReferences.has(key)) return;
        seenReferences.add(key);
        graph.references.push(evidence);
        const targetNode = addNode(access === "column" ? "column" : "table", objectName(target));
        graph.edges.push({
          from: queryId,
          to: targetNode,
          kind: access === "column" ? "QUERY_REFERENCES_COLUMN" : "QUERY_REFERENCES_TABLE",
          location,
        });
      };
      return { emit, gap: (kind: GapKind, message: string) => addGap(kind, message, location) };
    }

    async function sqlQuery(text: string | undefined, location: SourceLocation) {
      const context = queryContext(location, "static-sql-reference");
      if (!context) return;
      if (text === undefined)
        return context.gap(
          "dynamic-sql",
          "SQL is assembled dynamically or passed through an unresolved value.",
        );
      if (Buffer.byteLength(text) > 32768)
        return context.gap("limit", "The SQL query exceeds 32 KiB.");
      const ast = await parseSql(text);
      if (!ast?.length)
        return context.gap(
          "unsupported-sql",
          "The application query could not be parsed as PostgreSQL SQL.",
        );
      inspectSql(ast, defaultSchema, catalog, context.emit, context.gap);
    }

    if (!source) {
      await sqlQuery(file.text, { path: file.path, line: 1, column: 1 });
      continue;
    }
    const calls: (ts.CallExpression | ts.TaggedTemplateExpression)[] = [];
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) || ts.isTaggedTemplateExpression(node)) calls.push(node);
      ts.forEachChild(node, visit);
    }
    visit(source);
    for (const call of calls) {
      const position = source.getLineAndCharacterOfPosition(call.getStart(source));
      const location = { path: file.path, line: position.line + 1, column: position.character + 1 };
      if (ts.isTaggedTemplateExpression(call)) {
        if (
          ts.isPropertyAccessExpression(call.tag) &&
          ["$queryRaw", "$executeRaw"].includes(call.tag.name.text)
        ) {
          await sqlQuery(
            ts.isNoSubstitutionTemplateLiteral(call.template) ? call.template.text : undefined,
            location,
          );
        }
        continue;
      }
      const method = call.expression;
      if (!ts.isPropertyAccessExpression(method)) continue;
      const supabase = supabaseQuery(call, checker, program);
      if (supabase) {
        const context = queryContext(location, "static-sql-reference");
        if (context)
          inspectSupabase(
            call,
            supabase.schema,
            supabase.rpc,
            checker,
            context.emit,
            context.gap,
            program,
          );
        continue;
      }
      if (
        ts.isPropertyAccessExpression(method.expression) &&
        ts.isIdentifier(method.expression.expression) &&
        method.expression.expression.text === "prisma"
      ) {
        const context = queryContext(location, "prisma-reference");
        if (context) inspectPrisma(call, models, context.emit, context.gap);
        continue;
      }
      const name = method.name.text;
      if (
        !["query", "$queryRaw", "$queryRawUnsafe", "$executeRaw", "$executeRawUnsafe"].includes(
          name,
        )
      )
        continue;
      if (
        name === "query" &&
        !(ts.isIdentifier(method.expression) && QUERY_RECEIVERS.has(method.expression.text))
      ) {
        addGap(
          "source",
          "A query receiver is outside the supported db/pool/client/pg/connection conventions.",
          location,
        );
        continue;
      }
      let argument = call.arguments[0];
      if (argument && ts.isObjectLiteralExpression(argument))
        argument = literalObject(argument)?.get("text");
      const text =
        argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))
          ? argument.text
          : undefined;
      await sqlQuery(text, location);
    }
  }
  if (!graph.queries)
    addGap(
      "source",
      "No supported database query call was identified. Other wrappers and generated code require separate verification.",
    );
  return graph;
}
