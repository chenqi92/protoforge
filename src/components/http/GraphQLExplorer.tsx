import { useState, useMemo, useCallback } from 'react';
import {
  Search,
  ChevronRight,
  ChevronDown,
  Box,
  Hash,
  List,
  Zap,
  Type,
  ArrowRight,
  Shield,
  AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import type { GqlType, GqlField, GqlInputValue, GqlEnumValue, GqlTypeRef } from '@/types/graphql';
import { formatTypeRef, unwrapType, isBuiltinType } from '@/types/graphql';
import type { IntrospectionResult } from '@/types/graphql';

// ── Kind icons ──

function TypeKindIcon({ kind, className }: { kind: string; className?: string }) {
  const cls = cn('h-3.5 w-3.5 shrink-0', className);
  switch (kind) {
    case 'OBJECT':
      return <Box className={cn(cls, 'text-blue-400')} />;
    case 'INPUT_OBJECT':
      return <Box className={cn(cls, 'text-amber-400')} />;
    case 'INTERFACE':
      return <Shield className={cn(cls, 'text-purple-400')} />;
    case 'UNION':
      return <Zap className={cn(cls, 'text-teal-400')} />;
    case 'ENUM':
      return <List className={cn(cls, 'text-green-400')} />;
    case 'SCALAR':
      return <Hash className={cn(cls, 'text-text-tertiary')} />;
    default:
      return <Type className={cn(cls, 'text-text-tertiary')} />;
  }
}

// ── Type reference link ──

function TypeRefLabel({
  typeRef,
  onNavigate,
}: {
  typeRef: GqlTypeRef;
  onNavigate: (name: string) => void;
}) {
  const display = formatTypeRef(typeRef);
  const innerName = unwrapType(typeRef);

  return (
    <button
      className="pf-text-xs text-accent hover:underline font-mono cursor-pointer bg-transparent border-none p-0"
      onClick={(e) => {
        e.stopPropagation();
        onNavigate(innerName);
      }}
    >
      {display}
    </button>
  );
}

// ── Field row ──

function FieldRow({
  field,
  onNavigate,
}: {
  field: GqlField;
  onNavigate: (name: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = field.args.length > 0 || !!field.description;

  return (
    <div className="border-b border-border-default/30 last:border-b-0">
      <button
        className={cn(
          'flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-bg-hover/50 transition-colors',
          hasDetails && 'cursor-pointer',
        )}
        onClick={() => hasDetails && setExpanded((v) => !v)}
      >
        {hasDetails ? (
          expanded ? <ChevronDown className="h-3 w-3 text-text-tertiary shrink-0" /> : <ChevronRight className="h-3 w-3 text-text-tertiary shrink-0" />
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <span className={cn('pf-text-xs font-semibold font-mono', field.isDeprecated && 'line-through text-text-disabled')}>
          {field.name}
        </span>
        {field.args.length > 0 && (
          <span className="pf-text-xxs text-text-disabled">
            ({field.args.length} arg{field.args.length > 1 ? 's' : ''})
          </span>
        )}
        <ArrowRight className="h-2.5 w-2.5 text-text-disabled shrink-0 ml-auto" />
        <TypeRefLabel typeRef={field.type} onNavigate={onNavigate} />
      </button>
      {expanded && (
        <div className="px-3 pb-2 pl-8 space-y-1">
          {field.description && (
            <p className="pf-text-xs text-text-secondary italic">{field.description}</p>
          )}
          {field.isDeprecated && (
            <p className="pf-text-xs text-amber-500 dark:text-amber-300 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              {field.deprecationReason || 'Deprecated'}
            </p>
          )}
          {field.args.length > 0 && (
            <div className="mt-1">
              <div className="pf-text-xxs text-text-disabled uppercase tracking-wider mb-1">Arguments</div>
              {field.args.map((arg) => (
                <InputValueRow key={arg.name} input={arg} onNavigate={onNavigate} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Input value row (for args and input fields) ──

function InputValueRow({
  input,
  onNavigate,
}: {
  input: GqlInputValue;
  onNavigate: (name: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 py-0.5 pl-2">
      <span className="pf-text-xs font-mono text-text-secondary">{input.name}</span>
      <ArrowRight className="h-2.5 w-2.5 text-text-disabled shrink-0" />
      <TypeRefLabel typeRef={input.type} onNavigate={onNavigate} />
      {input.defaultValue && (
        <span className="pf-text-xxs text-text-disabled">= {input.defaultValue}</span>
      )}
      {input.description && (
        <span className="pf-text-xxs text-text-disabled truncate max-w-[180px]" title={input.description}>
          — {input.description}
        </span>
      )}
    </div>
  );
}

// ── Enum value row ──

function EnumValueRow({ value }: { value: GqlEnumValue }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1 pl-8">
      <span className={cn('pf-text-xs font-mono font-semibold text-green-400', value.isDeprecated && 'line-through text-text-disabled')}>
        {value.name}
      </span>
      {value.description && (
        <span className="pf-text-xxs text-text-disabled truncate max-w-[200px]" title={value.description}>
          — {value.description}
        </span>
      )}
    </div>
  );
}

// ── Type detail view ──

function TypeDetail({
  type,
  onNavigate,
}: {
  type: GqlType;
  onNavigate: (name: string) => void;
}) {
  return (
    <div className="flex flex-col min-h-0">
      {/* Type header */}
      <div className="px-3 py-2 border-b border-border-default/60">
        <div className="flex items-center gap-2">
          <TypeKindIcon kind={type.kind} />
          <span className="pf-text-sm font-semibold text-text-primary">{type.name}</span>
          <span className="wb-tool-chip">{type.kind}</span>
        </div>
        {type.description && (
          <p className="mt-1 pf-text-xs text-text-secondary">{type.description}</p>
        )}
        {type.interfaces && type.interfaces.length > 0 && (
          <div className="mt-1 flex items-center gap-1 flex-wrap">
            <span className="pf-text-xxs text-text-disabled">implements</span>
            {type.interfaces.map((iface) => (
              <TypeRefLabel key={iface.name} typeRef={iface} onNavigate={onNavigate} />
            ))}
          </div>
        )}
        {type.possibleTypes && type.possibleTypes.length > 0 && (
          <div className="mt-1 flex items-center gap-1 flex-wrap">
            <span className="pf-text-xxs text-text-disabled">possible types:</span>
            {type.possibleTypes.map((pt) => (
              <TypeRefLabel key={pt.name} typeRef={pt} onNavigate={onNavigate} />
            ))}
          </div>
        )}
      </div>

      {/* Fields */}
      {type.fields && type.fields.length > 0 && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="px-3 py-1.5 pf-text-xxs text-text-disabled uppercase tracking-wider sticky top-0 bg-bg-surface z-10">
            Fields ({type.fields.length})
          </div>
          {type.fields.map((f) => (
            <FieldRow key={f.name} field={f} onNavigate={onNavigate} />
          ))}
        </div>
      )}

      {/* Input fields */}
      {type.inputFields && type.inputFields.length > 0 && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="px-3 py-1.5 pf-text-xxs text-text-disabled uppercase tracking-wider sticky top-0 bg-bg-surface z-10">
            Input Fields ({type.inputFields.length})
          </div>
          {type.inputFields.map((f) => (
            <InputValueRow key={f.name} input={f} onNavigate={onNavigate} />
          ))}
        </div>
      )}

      {/* Enum values */}
      {type.enumValues && type.enumValues.length > 0 && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="px-3 py-1.5 pf-text-xxs text-text-disabled uppercase tracking-wider sticky top-0 bg-bg-surface z-10">
            Values ({type.enumValues.length})
          </div>
          {type.enumValues.map((v) => (
            <EnumValueRow key={v.name} value={v} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Explorer component ──

export function GraphQLExplorer({
  schema,
}: {
  schema: IntrospectionResult;
  onClose?: () => void;
  onInsertField?: (text: string) => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [selectedTypeName, setSelectedTypeName] = useState<string | null>(null);
  const [, setNavigationStack] = useState<string[]>([]);

  const typeMap = useMemo(() => {
    const map = new Map<string, GqlType>();
    for (const ty of schema.schema.types) {
      if (ty.name) map.set(ty.name, ty);
    }
    return map;
  }, [schema]);

  // Group types by category, excluding builtins
  const categorized = useMemo(() => {
    const queryName = schema.schema.queryType?.name;
    const mutationName = schema.schema.mutationType?.name;
    const subscriptionName = schema.schema.subscriptionType?.name;

    const roots: GqlType[] = [];
    const objects: GqlType[] = [];
    const inputs: GqlType[] = [];
    const enums: GqlType[] = [];
    const interfaces: GqlType[] = [];
    const unions: GqlType[] = [];
    const scalars: GqlType[] = [];

    const lowerSearch = search.toLowerCase();

    for (const type of schema.schema.types) {
      if (!type.name || type.name.startsWith('__')) continue;
      if (lowerSearch && !type.name.toLowerCase().includes(lowerSearch)) continue;

      if (type.name === queryName || type.name === mutationName || type.name === subscriptionName) {
        roots.push(type);
      } else if (type.kind === 'OBJECT') {
        objects.push(type);
      } else if (type.kind === 'INPUT_OBJECT') {
        inputs.push(type);
      } else if (type.kind === 'ENUM') {
        enums.push(type);
      } else if (type.kind === 'INTERFACE') {
        interfaces.push(type);
      } else if (type.kind === 'UNION') {
        unions.push(type);
      } else if (type.kind === 'SCALAR') {
        if (!isBuiltinType(type.name)) scalars.push(type);
      }
    }

    return { roots, objects, inputs, enums, interfaces, unions, scalars };
  }, [schema, search]);

  const selectedType = selectedTypeName ? typeMap.get(selectedTypeName) ?? null : null;

  const handleNavigate = useCallback((name: string) => {
    setNavigationStack((prev) => selectedTypeName ? [...prev, selectedTypeName] : prev);
    setSelectedTypeName(name);
  }, [selectedTypeName]);

  const handleBack = useCallback(() => {
    setNavigationStack((prev) => {
      const next = [...prev];
      const last = next.pop();
      setSelectedTypeName(last ?? null);
      return next;
    });
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="wb-panel-header shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {selectedType && (
            <button onClick={handleBack} className="wb-ghost-btn pf-text-xs">
              ← {t('http.graphql.explorer.back')}
            </button>
          )}
          <span className="pf-text-sm font-semibold text-text-primary">
            {selectedType ? selectedType.name : t('http.graphql.explorer.title')}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="wb-tool-chip">
            {schema.schema.types.filter((t) => t.name && !t.name.startsWith('__')).length} {t('http.graphql.explorer.types')}
          </span>
        </div>
      </div>

      {/* Search */}
      {!selectedType && (
        <div className="px-3 py-2 border-b border-border-default/60">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-tertiary" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('http.graphql.explorer.searchPlaceholder')}
              className="wb-field-sm w-full pl-8 pf-text-xs"
            />
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {selectedType ? (
          <TypeDetail type={selectedType} onNavigate={handleNavigate} />
        ) : (
          <TypeList categories={categorized} onSelect={setSelectedTypeName} />
        )}
      </div>
    </div>
  );
}

// ── Type list (categorized) ──

function TypeList({
  categories,
  onSelect,
}: {
  categories: ReturnType<typeof Object>; // same shape as categorized
  onSelect: (name: string) => void;
}) {
  const { t } = useTranslation();
  const cats = categories as {
    roots: GqlType[];
    objects: GqlType[];
    inputs: GqlType[];
    enums: GqlType[];
    interfaces: GqlType[];
    unions: GqlType[];
    scalars: GqlType[];
  };

  const sections: { label: string; types: GqlType[] }[] = [
    { label: t('http.graphql.explorer.rootTypes'), types: cats.roots },
    { label: t('http.graphql.explorer.objectTypes'), types: cats.objects },
    { label: t('http.graphql.explorer.inputTypes'), types: cats.inputs },
    { label: t('http.graphql.explorer.enumTypes'), types: cats.enums },
    { label: t('http.graphql.explorer.interfaceTypes'), types: cats.interfaces },
    { label: t('http.graphql.explorer.unionTypes'), types: cats.unions },
    { label: t('http.graphql.explorer.scalarTypes'), types: cats.scalars },
  ];

  return (
    <div>
      {sections.map((section) =>
        section.types.length > 0 ? (
          <TypeSection key={section.label} label={section.label} types={section.types} onSelect={onSelect} />
        ) : null
      )}
    </div>
  );
}

function TypeSection({
  label,
  types,
  onSelect,
}: {
  label: string;
  types: GqlType[];
  onSelect: (name: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div>
      <button
        className="flex w-full items-center gap-1.5 px-3 py-1.5 hover:bg-bg-hover/50 transition-colors"
        onClick={() => setCollapsed((v) => !v)}
      >
        {collapsed ? <ChevronRight className="h-3 w-3 text-text-tertiary" /> : <ChevronDown className="h-3 w-3 text-text-tertiary" />}
        <span className="pf-text-xxs text-text-disabled uppercase tracking-wider font-semibold">{label}</span>
        <span className="pf-text-xxs text-text-disabled ml-auto">{types.length}</span>
      </button>
      {!collapsed && types.map((type) => (
        <button
          key={type.name}
          className="flex w-full items-center gap-2 px-3 py-1 pl-7 hover:bg-bg-hover/50 transition-colors text-left"
          onClick={() => type.name && onSelect(type.name)}
        >
          <TypeKindIcon kind={type.kind} />
          <span className="pf-text-xs font-mono text-text-primary truncate">{type.name}</span>
          {type.fields && (
            <span className="pf-text-xxs text-text-disabled ml-auto shrink-0">
              {type.fields.length} fields
            </span>
          )}
          {type.enumValues && (
            <span className="pf-text-xxs text-text-disabled ml-auto shrink-0">
              {type.enumValues.length} values
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
