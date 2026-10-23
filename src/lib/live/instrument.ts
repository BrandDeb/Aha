/**
 * Live values for TypeScript and JavaScript: rewrite a file so that running it
 * records, for each line, how many times it ran and the values it produced:
 * variables it declared or assigned, what it returned, the loop variable of
 * each iteration. The rewrite only adds calls (__h hit, __v value, __r return)
 * around the original statements, keyed by the original line numbers, so the
 * program behaves as before. Pure apart from the TypeScript compiler.
 */

import ts from 'typescript';

export interface Instrumented {
  /** JavaScript (CommonJS) ready to run with the live runtime loaded */
  code: string;
  /** Lines that hold a statement: a line among them that never ran is shown as not run */
  statementLines: number[];
}

const NO_TRACE = new Set([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.InterfaceDeclaration,
  ts.SyntaxKind.TypeAliasDeclaration,
  ts.SyntaxKind.EnumDeclaration,
  ts.SyntaxKind.ModuleDeclaration,
  ts.SyntaxKind.ImportDeclaration,
  ts.SyntaxKind.ImportEqualsDeclaration,
  ts.SyntaxKind.ExportDeclaration,
  ts.SyntaxKind.ExportAssignment,
  ts.SyntaxKind.EmptyStatement,
]);

const ASSIGN = new Set([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.PercentEqualsToken,
  ts.SyntaxKind.AsteriskAsteriskEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

const CONSOLE = new Set(['log', 'info', 'warn', 'error', 'debug']);

/** Names a declaration binds: x, and the names inside { a, b: [c] } */
function boundNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  const names: string[] = [];
  for (const element of name.elements) if (!ts.isOmittedExpression(element)) names.push(...boundNames(element.name));
  return names;
}

function hasTopLevelAwait(sf: ts.SourceFile): boolean {
  const walk = (node: ts.Node): boolean => {
    if (ts.isFunctionLike(node) || ts.isClassLike(node)) return false;
    if (ts.isAwaitExpression(node) || (ts.isForOfStatement(node) && node.awaitModifier)) return true;
    return ts.forEachChild(node, walk) ?? false;
  };
  return walk(sf);
}

export function instrument(fileId: number, fileName: string, source: string): Instrumented {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, /\.[cm]?tsx?$/.test(fileName) ? ts.ScriptKind.TS : ts.ScriptKind.JS);
  const f = ts.factory;
  const lines = new Set<number>();
  const lineOf = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const call = (fn: string, args: ts.Expression[]) => f.createExpressionStatement(f.createCallExpression(f.createIdentifier(fn), undefined, args));
  const num = (n: number) => f.createNumericLiteral(n);
  const hit = (line: number) => call('__h', [num(fileId), num(line)]);
  const value = (line: number, name: string, expr: ts.Expression) => call('__v', [num(fileId), num(line), f.createStringLiteral(name), expr]);

  // A few values a statement leaves behind: what it declared or assigned
  const valuesAfter = (s: ts.Statement, line: number): ts.Statement[] => {
    if (ts.isVariableStatement(s)) {
      // const f = () => …: the value is the function itself, which says nothing
      const plain = (d: ts.VariableDeclaration) => d.initializer && !ts.isArrowFunction(d.initializer) && !ts.isFunctionExpression(d.initializer) && !ts.isClassExpression(d.initializer);
      return s.declarationList.declarations.flatMap((d) => (plain(d) ? boundNames(d.name).map((n) => value(line, n, f.createIdentifier(n))) : []));
    }
    if (ts.isExpressionStatement(s)) {
      const e = s.expression;
      if (ts.isBinaryExpression(e) && ASSIGN.has(e.operatorToken.kind) && (ts.isIdentifier(e.left) || ts.isPropertyAccessExpression(e.left) || ts.isElementAccessExpression(e.left))) {
        return [value(line, e.left.getText(sf), e.left)];
      }
      if ((ts.isPostfixUnaryExpression(e) || ts.isPrefixUnaryExpression(e)) && (e.operator === ts.SyntaxKind.PlusPlusToken || e.operator === ts.SyntaxKind.MinusMinusToken) && (ts.isIdentifier(e.operand) || ts.isPropertyAccessExpression(e.operand))) {
        return [value(line, e.operand.getText(sf), e.operand)];
      }
    }
    return [];
  };

  /** Loop variables, recorded at the top of each iteration */
  const loopValues = (s: ts.Statement): ts.Statement[] => {
    const line = lineOf(s);
    if ((ts.isForOfStatement(s) || ts.isForInStatement(s)) && ts.isVariableDeclarationList(s.initializer)) {
      return s.initializer.declarations.flatMap((d) => boundNames(d.name).map((n) => value(line, n, f.createIdentifier(n))));
    }
    if (ts.isForStatement(s) && s.initializer && ts.isVariableDeclarationList(s.initializer)) {
      return s.initializer.declarations.flatMap((d) => boundNames(d.name).map((n) => value(line, n, f.createIdentifier(n))));
    }
    return [];
  };

  const asBlock = (s: ts.Statement, prefix: ts.Statement[] = []): ts.Block => {
    const inner = ts.isBlock(s) ? [...s.statements] : [s];
    return f.createBlock([...prefix, ...visitStatements(inner)], true);
  };

  const visitStatements = (statements: readonly ts.Statement[]): ts.Statement[] => {
    const out: ts.Statement[] = [];
    for (const original of statements) {
      const s = visitStatement(original);
      if (NO_TRACE.has(original.kind)) {
        out.push(s);
        continue;
      }
      const line = lineOf(original);
      lines.add(line);
      out.push(hit(line), s, ...valuesAfter(original, line));
    }
    return out;
  };

  const visitStatement = (s: ts.Statement): ts.Statement => {
    if (ts.isIfStatement(s)) {
      return f.updateIfStatement(s, visitExpr(s.expression), asBlock(s.thenStatement), s.elseStatement ? (ts.isIfStatement(s.elseStatement) ? traceElseIf(s.elseStatement) : asBlock(s.elseStatement)) : undefined);
    }
    if (ts.isForStatement(s)) return f.updateForStatement(s, s.initializer, s.condition, s.incrementor, asBlock(s.statement, loopValues(s)));
    if (ts.isForOfStatement(s)) return f.updateForOfStatement(s, s.awaitModifier, s.initializer, visitExpr(s.expression), asBlock(s.statement, loopValues(s)));
    if (ts.isForInStatement(s)) return f.updateForInStatement(s, s.initializer, visitExpr(s.expression), asBlock(s.statement, loopValues(s)));
    if (ts.isWhileStatement(s)) return f.updateWhileStatement(s, s.expression, asBlock(s.statement));
    if (ts.isDoStatement(s)) return f.updateDoStatement(s, asBlock(s.statement), s.expression);
    if (ts.isBlock(s)) return f.updateBlock(s, visitStatements(s.statements));
    if (ts.isTryStatement(s)) {
      return f.updateTryStatement(
        s,
        f.updateBlock(s.tryBlock, visitStatements(s.tryBlock.statements)),
        s.catchClause ? f.updateCatchClause(s.catchClause, s.catchClause.variableDeclaration, f.updateBlock(s.catchClause.block, visitStatements(s.catchClause.block.statements))) : undefined,
        s.finallyBlock ? f.updateBlock(s.finallyBlock, visitStatements(s.finallyBlock.statements)) : undefined
      );
    }
    if (ts.isSwitchStatement(s)) {
      return f.updateSwitchStatement(
        s,
        s.expression,
        f.updateCaseBlock(s.caseBlock, s.caseBlock.clauses.map((c) => (ts.isCaseClause(c) ? f.updateCaseClause(c, c.expression, visitStatements(c.statements)) : f.updateDefaultClause(c, visitStatements(c.statements)))))
      );
    }
    if (ts.isLabeledStatement(s)) return f.updateLabeledStatement(s, s.label, visitStatement(s.statement));
    if (ts.isReturnStatement(s) && s.expression) {
      return f.updateReturnStatement(s, f.createCallExpression(f.createIdentifier('__r'), undefined, [num(fileId), num(lineOf(s)), visitExpr(s.expression)]));
    }
    return visitNode(s) as ts.Statement;
  };

  // `else if` keeps its shape (an else block holding one traced if) so the line of the else-if counts as run
  const traceElseIf = (s: ts.IfStatement): ts.Statement => {
    const line = lineOf(s);
    lines.add(line);
    return f.createBlock([hit(line), visitStatement(s)], true);
  };

  const visitFunctionBody = (body: ts.ConciseBody): ts.ConciseBody => {
    if (ts.isBlock(body)) return f.updateBlock(body, visitStatements(body.statements));
    // x => x * 2: record what the arrow returns, on its line
    const line = lineOf(body);
    lines.add(line);
    return f.createCallExpression(f.createIdentifier('__r'), undefined, [num(fileId), num(line), visitExpr(body as ts.Expression)]);
  };

  const visitNode = (node: ts.Node): ts.Node => {
    // Every file runs as a .js file next to the others: import './util.mts' means './util.js'
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) && /^\.\.?\//.test(node.moduleSpecifier.text)) {
      const specifier = f.createStringLiteral(node.moduleSpecifier.text.replace(/\.(?:[cm]?[jt]s)$/, '.js'));
      return ts.isImportDeclaration(node)
        ? f.updateImportDeclaration(node, node.modifiers, node.importClause, specifier, node.attributes)
        : f.updateExportDeclaration(node, node.modifiers, node.isTypeOnly, node.exportClause, specifier, node.attributes);
    }
    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
      if (!node.body) return node;
      const body = f.updateBlock(node.body, visitStatements(node.body.statements));
      if (ts.isFunctionDeclaration(node)) return f.updateFunctionDeclaration(node, node.modifiers, node.asteriskToken, node.name, node.typeParameters, node.parameters, node.type, body);
      if (ts.isFunctionExpression(node)) return f.updateFunctionExpression(node, node.modifiers, node.asteriskToken, node.name, node.typeParameters, node.parameters, node.type, body);
      if (ts.isMethodDeclaration(node)) return f.updateMethodDeclaration(node, node.modifiers, node.asteriskToken, node.name, node.questionToken, node.typeParameters, node.parameters, node.type, body);
      if (ts.isConstructorDeclaration(node)) return f.updateConstructorDeclaration(node, node.modifiers, node.parameters, body);
      if (ts.isGetAccessorDeclaration(node)) return f.updateGetAccessorDeclaration(node, node.modifiers, node.name, node.parameters, node.type, body);
      return f.updateSetAccessorDeclaration(node as ts.SetAccessorDeclaration, node.modifiers, node.name, node.parameters, body);
    }
    // console.log(…) -> __c(file, line, 'log', …): what was printed, on the line that printed it
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'console' && CONSOLE.has(node.expression.name.text)) {
      const args = node.arguments.map((a) => visitExpr(a));
      return f.createCallExpression(f.createIdentifier('__c'), undefined, [num(fileId), num(lineOf(node)), f.createStringLiteral(node.expression.name.text), ...args]);
    }
    if (ts.isArrowFunction(node)) {
      return f.updateArrowFunction(node, node.modifiers, node.typeParameters, node.parameters, node.type, node.equalsGreaterThanToken, visitFunctionBody(node.body));
    }
    return ts.visitEachChild(node, visitNode, undefined);
  };
  const visitExpr = (e: ts.Expression) => visitNode(e) as ts.Expression;

  const rewritten = f.updateSourceFile(sf, visitStatements(sf.statements));
  const printed = ts.createPrinter({ removeComments: false }).printFile(rewritten);
  const { outputText } = ts.transpileModule(printed, {
    // .mts/.mjs would force ES module output; everything runs as CommonJS
    fileName: fileName.replace(/\.[cm]([jt]s)$/, '.$1'),
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, allowJs: true, sourceMap: false },
  });
  // CommonJS has no top-level await: run the module body as an async function instead
  const code = hasTopLevelAwait(sf) ? `(async () => {\n${outputText}\n})().catch((e) => { process.exitCode = 1; console.error(e); });\n` : outputText;
  return { code, statementLines: [...lines].sort((a, b) => a - b) };
}
