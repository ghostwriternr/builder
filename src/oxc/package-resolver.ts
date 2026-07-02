import { diagnostic, diagnosticAtSourceOffset } from "../diagnostics";
import type { DynamicWorkerModuleContent, ToolchainDiagnostic } from "../types";
import type { ModuleSpecifier, ModuleSpecifierScanner } from "./module-graph";

export interface PackageModuleGraphResult {
  ok: boolean;
  modules: Record<string, DynamicWorkerModuleContent>;
  diagnostics: ToolchainDiagnostic[];
}

interface PackageResolution {
  packageName: string;
  packageRoot: string;
  modulePath: string;
}

interface CjsRequireSpecifier {
  specifier: string;
  start: number;
  end: number;
  callStart: number;
  callEnd: number;
}

interface CjsRequireCall {
  callStart: number;
  callEnd: number;
}

const PACKAGE_CONDITIONS = ["workerd", "worker", "browser", "import", "require", "default"];
const JS_EXTENSIONS = [".js", ".mjs", ".cjs"];

export function resolvePackageSpecifier(specifier: string, packageFiles: Record<string, string>): PackageResolution | undefined {
  const parsed = parsePackageSpecifier(specifier);
  if (parsed === undefined) return undefined;

  const packageRoot = `node_modules/${parsed.packageName}`;
  const packageJsonSource = packageFiles[`${packageRoot}/package.json`];
  if (packageJsonSource === undefined) return undefined;

  let packageJson: unknown;
  try {
    packageJson = JSON.parse(packageJsonSource);
  } catch {
    return undefined;
  }

  const target = resolvePackageTarget(packageJson, parsed.subpath);
  if (target === undefined) return undefined;

  const modulePath = normalizePackagePath(`${packageRoot}/${target.replace(/^\.\//, "")}`);
  if (!isInsidePackageRoot(modulePath, packageRoot)) return undefined;
  return { packageName: parsed.packageName, packageRoot, modulePath };
}

export function packageSpecifierDiagnostic(specifier: string, packageFiles: Record<string, string>): ToolchainDiagnostic | undefined {
  const parsed = parsePackageSpecifier(specifier);
  if (parsed === undefined) return undefined;

  const packageRoot = `node_modules/${parsed.packageName}`;
  const packageJsonSource = packageFiles[`${packageRoot}/package.json`];
  if (packageJsonSource === undefined) return undefined;

  let packageJson: unknown;
  try {
    packageJson = JSON.parse(packageJsonSource);
  } catch {
    return undefined;
  }

  const target = resolvePackageTarget(packageJson, parsed.subpath);
  if (target === undefined) return undefined;

  const modulePath = normalizePackagePath(`${packageRoot}/${target.replace(/^\.\//, "")}`);
  if (!isInsidePackageRoot(modulePath, packageRoot)) {
    return diagnostic(
      "internal",
      "transform-failed",
      `Package import ${specifier} resolves outside package root ${packageRoot}: ${modulePath}`
    );
  }
  return undefined;
}

export async function buildPackageModuleGraph(
  entrySpecifiers: Iterable<string>,
  packageFiles: Record<string, string>,
  scanModuleSpecifiers: ModuleSpecifierScanner
): Promise<PackageModuleGraphResult> {
  const diagnostics: ToolchainDiagnostic[] = [];
  const modules: Record<string, DynamicWorkerModuleContent> = {};
  const queue: string[] = [];
  const seen = new Set<string>();

  for (const specifier of entrySpecifiers) {
    const resolved = resolvePackageSpecifier(specifier, packageFiles);
    if (resolved === undefined) {
      diagnostics.push(packageSpecifierDiagnostic(specifier, packageFiles) ?? diagnostic("internal", "transform-failed", `Could not resolve package import ${specifier}.`));
      continue;
    }
    queue.push(resolved.modulePath);
  }

  while (queue.length > 0) {
    const modulePath = queue.shift()!;
    if (seen.has(modulePath)) continue;
    seen.add(modulePath);

    const source = packageFiles[modulePath];
    if (source === undefined) {
      diagnostics.push(diagnostic("internal", "transform-failed", `Package module not found: ${modulePath}`));
      continue;
    }

    const maskedSource = maskNonCodeForRequireScanner(source);
    const isCjs = modulePath.endsWith(".cjs") || /\bmodule\.exports\b|\bexports\./.test(maskedSource) || hasCodeRequireCall(source);
    if (isCjs) {
      const literalRequires = scanLiteralRequires(source);
      const dynamicRequire = firstDynamicRequire(source, literalRequires);
      if (dynamicRequire !== undefined) {
        diagnostics.push(
          diagnosticAtSourceOffset(
            "internal",
            "transform-failed",
            `Dynamic require is not supported in package module ${modulePath}.`,
            { source, offset: dynamicRequire.callStart, end: dynamicRequire.callEnd, file: modulePath }
          )
        );
        continue;
      }

      const cjsRewrites = literalRequires
        .map((required) => {
          const resolved = resolvePackageModuleImport(modulePath, required.specifier, packageFiles);
          if (resolved === undefined) {
            diagnostics.push(
              diagnosticAtSourceOffset(
                "internal",
                "transform-failed",
                `Could not resolve ${required.specifier} required by package module ${modulePath}.`,
                { source, offset: required.start, end: required.end, file: modulePath }
              )
            );
            return undefined;
          }
          queue.push(resolved.modulePath);
          return {
            start: required.start,
            end: required.end,
            value: quoteLike(source.slice(required.start, required.end), `/${resolved.modulePath}`)
          };
        })
        .filter((rewrite): rewrite is { start: number; end: number; value: string } => rewrite !== undefined);

      modules[modulePath] = { cjs: applyRewrites(source, cjsRewrites) };
      continue;
    }

    const rewrites: Array<{ start: number; end: number; value: string }> = [];
    let specifiers: ModuleSpecifier[];
    try {
      specifiers = scanModuleSpecifiers(modulePath, source);
    } catch (error) {
      diagnostics.push(diagnostic("internal", "transform-failed", `Could not scan package imports in ${modulePath}.`, error));
      continue;
    }

    for (const specifier of specifiers) {
      if (specifier.isTypeOnly) continue;
      if (specifier.kind === "dynamic") {
        diagnostics.push(
          diagnosticAtSourceOffset(
            "internal",
            "transform-failed",
            `Dynamic imports are not supported in package modules: ${modulePath}`,
            { source, offset: specifier.start, end: specifier.end, file: modulePath }
          )
        );
        continue;
      }
      if (specifier.specifier === undefined) continue;

      const resolved = resolvePackageModuleImport(modulePath, specifier.specifier, packageFiles);
      if (resolved === undefined) {
        diagnostics.push(
          diagnosticAtSourceOffset(
            "internal",
            "transform-failed",
            `Could not resolve ${specifier.specifier} imported by package module ${modulePath}.`,
            { source, offset: specifier.start, end: specifier.end, file: modulePath }
          )
        );
        continue;
      }

      queue.push(resolved.modulePath);
      rewrites.push({
        start: specifier.start,
        end: specifier.end,
        value: quoteLike(source.slice(specifier.start, specifier.end), packageImportSpecifier(modulePath, resolved.modulePath))
      });
    }

    modules[modulePath] = { js: applyRewrites(source, rewrites) };
  }

  return { ok: diagnostics.length === 0, modules, diagnostics };
}

function parsePackageSpecifier(specifier: string): { packageName: string; subpath: string } | undefined {
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("cloudflare:")) return undefined;
  const parts = specifier.split("/");
  const packageName = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
  if (!packageName) return undefined;
  const rest = specifier.slice(packageName.length);
  return { packageName, subpath: rest === "" ? "." : `.${rest}` };
}

function resolvePackageTarget(packageJson: unknown, subpath: string): string | undefined {
  const packageRecord = packageJson as { exports?: unknown; main?: unknown } | undefined;
  const exportsField = packageRecord?.exports;
  if (exportsField !== undefined) {
    if (typeof exportsField === "string" && subpath === ".") return exportsField;
    if (typeof exportsField === "object" && exportsField !== null) {
      const exportsRecord = exportsField as Record<string, unknown>;
      if (subpath === "." && exportsRecord[subpath] === undefined && !Object.keys(exportsRecord).some((key) => key.startsWith("."))) {
        return pickConditionalTarget(exportsRecord);
      }
      const target = exportsRecord[subpath];
      return pickConditionalTarget(target);
    }
  }
  if (subpath === "." && typeof packageRecord?.main === "string") return packageRecord.main;
  return subpath === "." ? "./index.js" : subpath.slice(2);
}

function pickConditionalTarget(target: unknown): string | undefined {
  if (typeof target === "string") return target;
  if (typeof target !== "object" || target === null) return undefined;
  const record = target as Record<string, unknown>;
  for (const condition of PACKAGE_CONDITIONS) {
    const picked = pickConditionalTarget(record[condition]);
    if (picked !== undefined) return picked;
  }
  return undefined;
}

function scanLiteralRequires(source: string): CjsRequireSpecifier[] {
  const requires: CjsRequireSpecifier[] = [];
  const codeMask = createRequireScannerCodeMask(source);
  const pattern = /\brequire\s*\(\s*(["'])([^"']+)\1\s*\)/g;
  for (const match of source.matchAll(pattern)) {
    if (match.index === undefined || match[1] === undefined || match[2] === undefined) continue;
    if (!codeMask[match.index]) continue;
    const quoted = `${match[1]}${match[2]}${match[1]}`;
    const start = match.index + match[0].lastIndexOf(quoted);
    requires.push({ specifier: match[2], start, end: start + quoted.length, callStart: match.index, callEnd: match.index + match[0].length });
  }
  return requires;
}

function hasCodeRequireCall(source: string): boolean {
  return /\brequire\s*\(/g.test(maskNonCodeForRequireScanner(source));
}

function firstDynamicRequire(source: string, literalRequires = scanLiteralRequires(source)): CjsRequireCall | undefined {
  const codeMask = createRequireScannerCodeMask(source);
  const pattern = /\brequire\s*\(/g;
  for (const match of source.matchAll(pattern)) {
    if (match.index === undefined) continue;
    if (!codeMask[match.index]) continue;
    if (!literalRequires.some((literal) => literal.callStart === match.index)) {
      return { callStart: match.index, callEnd: match.index + match[0].length };
    }
  }
  return undefined;
}

function createRequireScannerCodeMask(source: string): boolean[] {
  const mask = Array<boolean>(source.length).fill(true);
  markRequireScannerNonCode(mask, source, 0, source.length);
  return mask;
}

function markRequireScannerNonCode(mask: boolean[], source: string, start: number, end: number): void {
  for (let index = start; index < end;) {
    const char = source[index];
    const next = source[index + 1];

    if (char === "/" && next === "/") {
      const commentEnd = source.indexOf("\n", index + 2);
      index = markNonCode(mask, index, commentEnd === -1 || commentEnd > end ? end : commentEnd);
      continue;
    }

    if (char === "/" && next === "*") {
      const commentEnd = source.indexOf("*/", index + 2);
      index = markNonCode(mask, index, commentEnd === -1 || commentEnd + 2 > end ? end : commentEnd + 2);
      continue;
    }

    if (char === "\"" || char === "'") {
      const stringEnd = findDelimitedEnd(source, index, char);
      index = markNonCode(mask, index, stringEnd === -1 || stringEnd + 1 > end ? end : stringEnd + 1);
      continue;
    }

    if (char === "`") {
      index = markTemplateLiteralNonCode(mask, source, index);
      continue;
    }

    if (char === "/" && isLikelyRegexStart(source, index)) {
      const regexEnd = findRegexEnd(source, index);
      index = markNonCode(mask, index, regexEnd === -1 || regexEnd + 1 > end ? end : regexEnd + 1);
      continue;
    }

    index++;
  }
}

function maskNonCodeForRequireScanner(source: string): string {
  const mask = createRequireScannerCodeMask(source);
  let output = "";
  for (let index = 0; index < source.length; index++) output += mask[index] ? source[index] : " ";
  return output;
}

function markNonCode(mask: boolean[], start: number, end: number): number {
  for (let index = start; index < end; index++) mask[index] = false;
  return end;
}

function markTemplateLiteralNonCode(mask: boolean[], source: string, start: number): number {
  mask[start] = false;
  for (let index = start + 1; index < source.length; index++) {
    const char = source[index];
    const next = source[index + 1];
    if (char === "\\") {
      index++;
      continue;
    }
    if (char === "`") {
      mask[index] = false;
      return index + 1;
    }
    if (char === "$" && next === "{") {
      mask[index] = false;
      mask[index + 1] = false;
      index += 2;
      const expressionEnd = findTemplateExpressionEnd(source, index);
      if (expressionEnd === -1) return source.length;
      markRequireScannerNonCode(mask, source, index, expressionEnd);
      mask[expressionEnd] = false;
      index = expressionEnd;
      continue;
    }
    mask[index] = false;
  }
  return source.length;
}

function findTemplateExpressionEnd(source: string, start: number): number {
  let depth = 1;
  for (let index = start; index < source.length; index++) {
    const char = source[index];
    const next = source[index + 1];
    if (char === "\\") {
      index++;
      continue;
    }
    if (char === "\"" || char === "'") {
      const end = findDelimitedEnd(source, index, char);
      if (end === -1) return -1;
      index = end;
      continue;
    }
    if (char === "`") {
      index = markTemplateLiteralNonCode(Array<boolean>(source.length).fill(true), source, index) - 1;
      continue;
    }
    if (char === "/" && next === "/") {
      const end = source.indexOf("\n", index + 2);
      if (end === -1) return -1;
      index = end;
      continue;
    }
    if (char === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      if (end === -1) return -1;
      index = end + 1;
      continue;
    }
    if (char === "{") depth++;
    if (char === "}") {
      depth--;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function findDelimitedEnd(source: string, start: number, delimiter: string): number {
  for (let index = start + 1; index < source.length; index++) {
    if (source[index] === "\\") {
      index++;
      continue;
    }
    if (source[index] === delimiter) return index;
  }
  return -1;
}

function findRegexEnd(source: string, start: number): number {
  let inCharacterClass = false;
  for (let index = start + 1; index < source.length; index++) {
    const char = source[index];
    if (char === "\\") {
      index++;
      continue;
    }
    if (char === "[") {
      inCharacterClass = true;
      continue;
    }
    if (char === "]") {
      inCharacterClass = false;
      continue;
    }
    if (char === "/" && !inCharacterClass) return index;
    if (char === "\n" || char === "\r") return -1;
  }
  return -1;
}

function isLikelyRegexStart(source: string, slashIndex: number): boolean {
  for (let index = slashIndex - 1; index >= 0; index--) {
    const char = source[index];
    if (/\s/.test(char)) continue;
    if ("([{=,:;!&|?+-*~^<>".includes(char)) return true;

    const word = source.slice(0, index + 1).match(/[A-Za-z_$][\w$]*$/)?.[0];
    return word !== undefined && REGEX_PREFIX_KEYWORDS.has(word);
  }
  return true;
}

const REGEX_PREFIX_KEYWORDS = new Set([
  "case",
  "delete",
  "do",
  "else",
  "in",
  "instanceof",
  "return",
  "throw",
  "typeof",
  "void",
  "yield",
]);

function resolvePackageModuleImport(importerPath: string, specifier: string, packageFiles: Record<string, string>): PackageResolution | undefined {
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const candidateBase = normalizePackagePath(`${dirname(importerPath)}/${specifier}`);
    const candidate = resolveFileCandidate(candidateBase, packageFiles);
    if (candidate === undefined) return undefined;
    const packageName = packageNameFromPath(importerPath);
    if (packageName === undefined) return undefined;
    const packageRoot = `node_modules/${packageName}`;
    if (!isInsidePackageRoot(candidate, packageRoot)) return undefined;
    return { packageName, packageRoot, modulePath: candidate };
  }
  return resolvePackageSpecifier(specifier, packageFiles);
}

function resolveFileCandidate(base: string, packageFiles: Record<string, string>): string | undefined {
  const candidates = hasJsExtension(base) ? [base] : [base, ...JS_EXTENSIONS.map((extension) => `${base}${extension}`), `${base}/index.js`];
  return candidates.find((candidate) => packageFiles[candidate] !== undefined);
}

function packageImportSpecifier(fromPath: string, toPath: string): string {
  if (packageNameFromPath(fromPath) !== packageNameFromPath(toPath)) return `/${toPath}`;
  return relativeSpecifier(fromPath, toPath);
}

function quoteLike(original: string, rewritten: string): string {
  const quote = original[0];
  return (quote === "\"" || quote === "'") && original.at(-1) === quote ? `${quote}${rewritten}${quote}` : rewritten;
}

function applyRewrites(source: string, rewrites: Array<{ start: number; end: number; value: string }>): string {
  let output = source;
  for (const rewrite of rewrites.sort((a, b) => b.start - a.start)) {
    output = `${output.slice(0, rewrite.start)}${rewrite.value}${output.slice(rewrite.end)}`;
  }
  return output;
}

function relativeSpecifier(fromPath: string, toPath: string): string {
  const fromParts = dirname(fromPath).split("/").filter(Boolean);
  const toParts = toPath.split("/").filter(Boolean);
  while (fromParts.length > 0 && toParts.length > 0 && fromParts[0] === toParts[0]) {
    fromParts.shift();
    toParts.shift();
  }
  const parts = [...fromParts.map(() => ".."), ...toParts];
  const relative = parts.join("/") || basename(toPath);
  return relative.startsWith(".") ? relative : `./${relative}`;
}

function packageNameFromPath(path: string): string | undefined {
  const parts = path.split("/");
  if (parts[0] !== "node_modules") return undefined;
  return parts[1]?.startsWith("@") ? `${parts[1]}/${parts[2]}` : parts[1];
}

function hasJsExtension(path: string): boolean {
  return JS_EXTENSIONS.some((extension) => path.endsWith(extension));
}

function isInsidePackageRoot(path: string, packageRoot: string): boolean {
  return path === packageRoot || path.startsWith(`${packageRoot}/`);
}

function normalizePackagePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

function basename(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? path : path.slice(index + 1);
}
