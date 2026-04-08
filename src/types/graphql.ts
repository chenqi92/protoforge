// ProtoForge GraphQL Schema Types (from Introspection)

export interface GqlTypeRef {
  kind: string;
  name: string | null;
  ofType: GqlTypeRef | null;
}

export interface GqlInputValue {
  name: string;
  description: string | null;
  type: GqlTypeRef;
  defaultValue: string | null;
}

export interface GqlField {
  name: string;
  description: string | null;
  args: GqlInputValue[];
  type: GqlTypeRef;
  isDeprecated: boolean;
  deprecationReason: string | null;
}

export interface GqlEnumValue {
  name: string;
  description: string | null;
  isDeprecated: boolean;
  deprecationReason: string | null;
}

export interface GqlType {
  kind: 'SCALAR' | 'OBJECT' | 'INTERFACE' | 'UNION' | 'ENUM' | 'INPUT_OBJECT' | 'LIST' | 'NON_NULL';
  name: string | null;
  description: string | null;
  fields: GqlField[] | null;
  inputFields: GqlInputValue[] | null;
  interfaces: GqlTypeRef[] | null;
  enumValues: GqlEnumValue[] | null;
  possibleTypes: GqlTypeRef[] | null;
}

export interface GqlDirective {
  name: string;
  description: string | null;
  locations: string[];
  args: GqlInputValue[];
}

export interface GqlSchema {
  queryType: { name: string } | null;
  mutationType: { name: string } | null;
  subscriptionType: { name: string } | null;
  types: GqlType[];
  directives: GqlDirective[];
}

export interface IntrospectionResult {
  schema: GqlSchema;
  fetchedAt: number;
  url: string;
}

/** Resolve NON_NULL / LIST wrappers to a display string like `String!`, `[User!]!` */
export function formatTypeRef(ref: GqlTypeRef): string {
  if (ref.kind === 'NON_NULL' && ref.ofType) {
    return `${formatTypeRef(ref.ofType)}!`;
  }
  if (ref.kind === 'LIST' && ref.ofType) {
    return `[${formatTypeRef(ref.ofType)}]`;
  }
  return ref.name ?? 'Unknown';
}

/** Unwrap NON_NULL / LIST to get the underlying named type */
export function unwrapType(ref: GqlTypeRef): string {
  if (ref.ofType) return unwrapType(ref.ofType);
  return ref.name ?? '';
}

/** Check if a type is a built-in scalar/introspection type */
export function isBuiltinType(name: string): boolean {
  return name.startsWith('__') || ['String', 'Int', 'Float', 'Boolean', 'ID'].includes(name);
}
