// GraphQL Monaco Editor — Autocomplete & Diagnostics provider
// Registers a completion provider that uses cached introspection schema

import type { IntrospectionResult, GqlType, GqlField, GqlInputValue } from '@/types/graphql';
import { formatTypeRef, unwrapType } from '@/types/graphql';
import { buildTypeMap } from '@/stores/graphqlSchemaStore';

type Monaco = typeof import('monaco-editor');
type CompletionItem = import('monaco-editor').languages.CompletionItem;
type IDisposable = import('monaco-editor').IDisposable;

// Module-level state for the current schema
let _currentSchema: IntrospectionResult | null = null;
let _disposable: IDisposable | null = null;

/** Update the schema used by the completion provider */
export function setGraphQLSchema(schema: IntrospectionResult | null) {
  _currentSchema = schema;
}

/** Register the GraphQL completion provider (call once) */
export function registerGraphQLProviders(monaco: Monaco): IDisposable {
  if (_disposable) return _disposable;

  const completionDisposable = monaco.languages.registerCompletionItemProvider('graphql', {
    triggerCharacters: ['{', '(', ':', ' ', '\n', '.', '@'],
    provideCompletionItems(model, position) {
      if (!_currentSchema) return { suggestions: [] };

      const textUntilPosition = model.getValueInRange({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });

      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endLineNumber: position.lineNumber,
        endColumn: word.endColumn,
      };

      const typeMap = buildTypeMap(_currentSchema);
      const suggestions: CompletionItem[] = [];

      // Detect context
      const context = detectContext(textUntilPosition);

      if (context.type === 'root') {
        // Top level — suggest query/mutation/subscription keywords
        suggestions.push(
          ...buildKeywordSuggestions(monaco, range, _currentSchema),
        );
      } else if (context.type === 'field') {
        // Inside a selection set — suggest fields for the current type
        const parentType = resolveParentType(typeMap, _currentSchema, context.path);
        if (parentType?.fields) {
          suggestions.push(
            ...buildFieldSuggestions(monaco, range, parentType.fields, typeMap),
          );
        }
        // Also suggest __typename
        suggestions.push({
          label: '__typename',
          kind: monaco.languages.CompletionItemKind.Property,
          insertText: '__typename',
          detail: 'String!',
          documentation: 'The name of the current Object type',
          range,
        } as CompletionItem);
      } else if (context.type === 'argument') {
        // Inside arguments — suggest argument names
        const parentType = resolveParentType(typeMap, _currentSchema, context.parentPath);
        if (parentType?.fields) {
          const field = parentType.fields.find((f) => f.name === context.fieldName);
          if (field) {
            suggestions.push(
              ...buildArgumentSuggestions(monaco, range, field.args),
            );
          }
        }
      } else if (context.type === 'argumentValue') {
        // After a colon in arguments — suggest enum values if applicable
        const parentType = resolveParentType(typeMap, _currentSchema, context.parentPath);
        if (parentType?.fields) {
          const field = parentType.fields.find((f) => f.name === context.fieldName);
          const arg = field?.args.find((a) => a.name === context.argName);
          if (arg) {
            const innerTypeName = unwrapType(arg.type);
            const enumType = typeMap.get(innerTypeName);
            if (enumType?.enumValues) {
              suggestions.push(
                ...buildEnumSuggestions(monaco, range, enumType),
              );
            }
            // Suggest boolean literals for Boolean type
            if (innerTypeName === 'Boolean') {
              suggestions.push(
                { label: 'true', kind: monaco.languages.CompletionItemKind.Value, insertText: 'true', range } as CompletionItem,
                { label: 'false', kind: monaco.languages.CompletionItemKind.Value, insertText: 'false', range } as CompletionItem,
              );
            }
          }
        }
      } else if (context.type === 'directive') {
        // After @ — suggest directives
        for (const d of _currentSchema.schema.directives) {
          suggestions.push({
            label: d.name,
            kind: monaco.languages.CompletionItemKind.Function,
            insertText: d.args.length > 0 ? `${d.name}($1)` : d.name,
            insertTextRules: d.args.length > 0 ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
            detail: `directive @${d.name}`,
            documentation: d.description ?? undefined,
            range,
          } as CompletionItem);
        }
      }

      return { suggestions };
    },
  });

  const hoverDisposable = monaco.languages.registerHoverProvider('graphql', {
    provideHover(model, position) {
      if (!_currentSchema) return null;

      const word = model.getWordAtPosition(position);
      if (!word) return null;

      const typeMap = buildTypeMap(_currentSchema);
      const typeDef = typeMap.get(word.word);

      if (typeDef) {
        const contents = [
          { value: `**${typeDef.kind}** \`${typeDef.name}\`` },
        ];
        if (typeDef.description) {
          contents.push({ value: typeDef.description });
        }
        return {
          range: {
            startLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endLineNumber: position.lineNumber,
            endColumn: word.endColumn,
          },
          contents,
        };
      }

      return null;
    },
  });

  _disposable = {
    dispose() {
      completionDisposable.dispose();
      hoverDisposable.dispose();
      _disposable = null;
    },
  };

  return _disposable;
}

// ── Context detection ──

interface RootContext {
  type: 'root';
}

interface FieldContext {
  type: 'field';
  path: string[];
}

interface ArgumentContext {
  type: 'argument';
  parentPath: string[];
  fieldName: string;
}

interface ArgumentValueContext {
  type: 'argumentValue';
  parentPath: string[];
  fieldName: string;
  argName: string;
}

interface DirectiveContext {
  type: 'directive';
}

type EditorContext = RootContext | FieldContext | ArgumentContext | ArgumentValueContext | DirectiveContext;

function detectContext(text: string): EditorContext {
  // Check for directive context
  const lastAt = text.lastIndexOf('@');
  if (lastAt >= 0) {
    const afterAt = text.slice(lastAt + 1);
    if (/^[a-zA-Z_]*$/.test(afterAt)) {
      return { type: 'directive' };
    }
  }

  // Check if we're inside argument parentheses
  const argContext = detectArgumentContext(text);
  if (argContext) return argContext;

  // Determine field path via brace nesting
  const path = detectFieldPath(text);
  if (path.length === 0) {
    return { type: 'root' };
  }

  return { type: 'field', path };
}

function detectArgumentContext(text: string): ArgumentContext | ArgumentValueContext | null {
  // Walk backwards to find unclosed '(' within the nearest '{' scope
  let parenDepth = 0;
  let braceDepth = 0;

  for (let i = text.length - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === ')') parenDepth++;
    else if (ch === '(') {
      if (parenDepth > 0) {
        parenDepth--;
      } else {
        // Found unclosed '(' — we're inside arguments
        // Find the field name before '('
        const beforeParen = text.slice(0, i).trimEnd();
        const fieldMatch = beforeParen.match(/(\w+)\s*$/);
        if (!fieldMatch) return null;

        const fieldName = fieldMatch[1];
        const parentPath = detectFieldPath(text.slice(0, beforeParen.length - fieldMatch[0].length));

        // Check if we're after a colon (argument value context)
        const insideParens = text.slice(i + 1);
        const colonMatch = insideParens.match(/(\w+)\s*:\s*[^,)]*$/);
        if (colonMatch) {
          return {
            type: 'argumentValue',
            parentPath,
            fieldName,
            argName: colonMatch[1],
          };
        }

        return { type: 'argument', parentPath, fieldName };
      }
    } else if (ch === '}') braceDepth++;
    else if (ch === '{') {
      if (braceDepth > 0) braceDepth--;
      else break; // Outside our scope
    }
  }

  return null;
}

function detectFieldPath(text: string): string[] {
  // Parse the operation context by tracking brace nesting
  const path: string[] = [];
  let depth = 0;

  // Tokenize: find operation keywords + field names at each brace level
  // We simplify: extract the name before each '{' to build the path
  const stripped = text
    .replace(/\#[^\n]*/g, '') // strip comments
    .replace(/"(?:[^"\\]|\\.)*"/g, '""') // strip strings
    .replace(/\([^)]*\)/g, ''); // strip argument lists for path detection

  const tokens = stripped.split(/([{}])/);
  const nameStack: string[] = [];

  for (const token of tokens) {
    if (token === '{') {
      // Extract the last word before '{'
      const trimmed = nameStack.length > 0 ? nameStack[nameStack.length - 1] : '';
      const match = trimmed.trimEnd().match(/(\w+)\s*$/);
      const name = match ? match[1] : '';
      path.push(name);
      nameStack.push('');
      depth++;
    } else if (token === '}') {
      path.pop();
      nameStack.pop();
      depth--;
    } else {
      if (nameStack.length > 0) {
        nameStack[nameStack.length - 1] = token;
      } else {
        nameStack.push(token);
      }
    }
  }

  return path;
}

// ── Resolve types ──

function resolveParentType(
  typeMap: Map<string, GqlType>,
  schema: IntrospectionResult,
  path: string[],
): GqlType | null {
  if (path.length === 0) return null;

  // The first element in path is the operation keyword (query/mutation/subscription) or a named operation
  const operationKeyword = path[0].toLowerCase();
  let rootTypeName: string | null = null;

  if (operationKeyword === 'query' || operationKeyword === '') {
    rootTypeName = schema.schema.queryType?.name ?? null;
  } else if (operationKeyword === 'mutation') {
    rootTypeName = schema.schema.mutationType?.name ?? null;
  } else if (operationKeyword === 'subscription') {
    rootTypeName = schema.schema.subscriptionType?.name ?? null;
  } else {
    // Default to Query for shorthand notation
    rootTypeName = schema.schema.queryType?.name ?? null;
  }

  if (!rootTypeName) return null;

  let currentType = typeMap.get(rootTypeName);
  if (!currentType) return null;

  // Walk the remaining path to resolve nested types
  for (let i = 1; i < path.length; i++) {
    const fieldName = path[i];
    if (!fieldName || !currentType?.fields) break;

    const field = currentType.fields.find((f) => f.name === fieldName);
    if (!field) break;

    const innerName = unwrapType(field.type);
    currentType = typeMap.get(innerName);
    if (!currentType) return null;
  }

  return currentType ?? null;
}

// ── Build suggestions ──

function buildKeywordSuggestions(
  monaco: Monaco,
  range: any,
  schema: IntrospectionResult,
): CompletionItem[] {
  const suggestions: CompletionItem[] = [];

  if (schema.schema.queryType) {
    suggestions.push({
      label: 'query',
      kind: monaco.languages.CompletionItemKind.Keyword,
      insertText: 'query ${1:OperationName} {\n  $0\n}',
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      detail: `Root: ${schema.schema.queryType.name}`,
      documentation: 'Define a GraphQL query operation',
      range,
    } as CompletionItem);
  }

  if (schema.schema.mutationType) {
    suggestions.push({
      label: 'mutation',
      kind: monaco.languages.CompletionItemKind.Keyword,
      insertText: 'mutation ${1:OperationName} {\n  $0\n}',
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      detail: `Root: ${schema.schema.mutationType.name}`,
      documentation: 'Define a GraphQL mutation operation',
      range,
    } as CompletionItem);
  }

  if (schema.schema.subscriptionType) {
    suggestions.push({
      label: 'subscription',
      kind: monaco.languages.CompletionItemKind.Keyword,
      insertText: 'subscription ${1:OperationName} {\n  $0\n}',
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      detail: `Root: ${schema.schema.subscriptionType.name}`,
      documentation: 'Define a GraphQL subscription operation',
      range,
    } as CompletionItem);
  }

  suggestions.push({
    label: 'fragment',
    kind: monaco.languages.CompletionItemKind.Keyword,
    insertText: 'fragment ${1:FragmentName} on ${2:TypeName} {\n  $0\n}',
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    documentation: 'Define a reusable fragment',
    range,
  } as CompletionItem);

  return suggestions;
}

function buildFieldSuggestions(
  monaco: Monaco,
  range: any,
  fields: GqlField[],
  typeMap: Map<string, GqlType>,
): CompletionItem[] {
  return fields.map((field, i) => {
    const typeName = unwrapType(field.type);
    const targetType = typeMap.get(typeName);
    const isObjectLike = targetType && ['OBJECT', 'INTERFACE', 'UNION'].includes(targetType.kind);
    const hasArgs = field.args.length > 0;

    let insertText = field.name;
    let insertTextRules: number | undefined;

    if (hasArgs && isObjectLike) {
      const requiredArgs = field.args.filter((a) => a.type.kind === 'NON_NULL');
      const argsSnippet = requiredArgs.length > 0
        ? `(${requiredArgs.map((a, j) => `${a.name}: \${${j + 1}}`).join(', ')})`
        : '';
      insertText = `${field.name}${argsSnippet} {\n  \${${requiredArgs.length + 1}}\n}`;
      insertTextRules = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
    } else if (isObjectLike) {
      insertText = `${field.name} {\n  $0\n}`;
      insertTextRules = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
    } else if (hasArgs) {
      const requiredArgs = field.args.filter((a) => a.type.kind === 'NON_NULL');
      if (requiredArgs.length > 0) {
        insertText = `${field.name}(${requiredArgs.map((a, j) => `${a.name}: \${${j + 1}}`).join(', ')})`;
        insertTextRules = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
      }
    }

    const doc = [
      field.description,
      field.args.length > 0 ? `\nArguments:\n${field.args.map((a) => `  ${a.name}: ${formatTypeRef(a.type)}`).join('\n')}` : '',
      field.isDeprecated ? `\n⚠️ Deprecated: ${field.deprecationReason ?? ''}` : '',
    ].filter(Boolean).join('\n');

    return {
      label: field.name,
      kind: isObjectLike
        ? monaco.languages.CompletionItemKind.Module
        : monaco.languages.CompletionItemKind.Field,
      insertText,
      insertTextRules,
      detail: formatTypeRef(field.type),
      documentation: doc || undefined,
      sortText: String(i).padStart(4, '0'),
      range,
    } as CompletionItem;
  });
}

function buildArgumentSuggestions(
  monaco: Monaco,
  range: any,
  args: GqlInputValue[],
): CompletionItem[] {
  return args.map((arg, i) => ({
    label: arg.name,
    kind: monaco.languages.CompletionItemKind.Variable,
    insertText: `${arg.name}: `,
    detail: formatTypeRef(arg.type),
    documentation: arg.description ?? undefined,
    sortText: String(i).padStart(4, '0'),
    range,
  } as CompletionItem));
}

function buildEnumSuggestions(
  monaco: Monaco,
  range: any,
  enumType: GqlType,
): CompletionItem[] {
  if (!enumType.enumValues) return [];
  return enumType.enumValues.map((ev, i) => ({
    label: ev.name,
    kind: monaco.languages.CompletionItemKind.EnumMember,
    insertText: ev.name,
    detail: `${enumType.name}`,
    documentation: [
      ev.description,
      ev.isDeprecated ? `⚠️ Deprecated: ${ev.deprecationReason ?? ''}` : '',
    ].filter(Boolean).join('\n') || undefined,
    sortText: String(i).padStart(4, '0'),
    range,
  } as CompletionItem));
}
