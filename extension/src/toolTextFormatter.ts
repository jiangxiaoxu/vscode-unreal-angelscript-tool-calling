type UnknownRecord = Record<string, unknown>;

const MAX_LIST_ITEMS = 50;
const MAX_BLOCK_LINES = 40;
const MAX_TEXT_LENGTH = 30000;

function isRecord(value: unknown): value is UnknownRecord
{
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asRecord(value: unknown): UnknownRecord | null
{
    return isRecord(value) ? value : null;
}

function asString(value: unknown): string | null
{
    return typeof value === 'string' ? value : null;
}

function asNumber(value: unknown): number | null
{
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean | null
{
    return typeof value === 'boolean' ? value : null;
}

function asArray(value: unknown): unknown[] | null
{
    return Array.isArray(value) ? value : null;
}

function toDisplayValue(value: unknown): string
{
    if (value === null)
        return 'null';
    if (value === undefined)
        return 'undefined';
    if (typeof value === 'string')
        return value;
    if (typeof value === 'number' || typeof value === 'boolean')
        return String(value);
    if (Array.isArray(value))
        return `[${value.length} items]`;
    if (isRecord(value))
    {
        const keys = Object.keys(value);
        if (keys.length === 0)
            return '{}';
        const shown = keys.slice(0, 5).join(', ');
        const suffix = keys.length > 5 ? ', ...' : '';
        return `{${shown}${suffix}}`;
    }
    return String(value);
}

function truncateLines(text: string, maxLines: number = MAX_BLOCK_LINES): string
{
    const lines = text.split(/\r?\n/);
    if (lines.length <= maxLines)
        return text;
    return `${lines.slice(0, maxLines).join('\n')}\n... (truncated)`;
}

function indentBlock(text: string, prefix: string = '  '): string
{
    return text
        .split(/\r?\n/)
        .map((line) => `${prefix}${line}`)
        .join('\n');
}

function limitArray<T>(items: T[], maxItems: number = MAX_LIST_ITEMS): { items: T[]; omitted: number }
{
    if (items.length <= maxItems)
    {
        return {
            items,
            omitted: 0
        };
    }
    return {
        items: items.slice(0, maxItems),
        omitted: items.length - maxItems
    };
}

function finalize(lines: string[]): string
{
    const text = lines.join('\n').trim();
    if (!text)
        return 'No readable output.';
    if (text.length <= MAX_TEXT_LENGTH)
        return text;

    const omitted = text.length - MAX_TEXT_LENGTH;
    const suffix = `\n... (truncated, ${omitted} chars omitted)`;
    const maxPrefixLength = Math.max(0, MAX_TEXT_LENGTH - suffix.length);
    return `${text.slice(0, maxPrefixLength).trimEnd()}${suffix}`;
}

function formatError(toolName: string, payload: UnknownRecord): string
{
    const lines: string[] = [];
    lines.push(`${toolName} - error`);

    const error = asRecord(payload.error);
    if (!error)
    {
        lines.push('message=Unknown error payload.');
        return finalize(lines);
    }

    const code = asString(error.code);
    const message = asString(error.message);
    const retryable = asBoolean(error.retryable);
    const hint = asString(error.hint);
    const details = asRecord(error.details);

    if (code)
        lines.push(`code=${code}`);
    if (message)
        lines.push(`message=${message}`);
    if (retryable !== null)
        lines.push(`retryable=${retryable}`);
    if (hint)
        lines.push(`hint=${hint}`);

    if (details)
    {
        lines.push('details:');
        const keys = Object.keys(details).sort();
        for (const key of keys)
        {
            lines.push(`  ${key}: ${toDisplayValue(details[key])}`);
        }
    }

    return finalize(lines);
}

function formatSearchApiSuccess(toolName: string, data: UnknownRecord): string
{
    const lines: string[] = [];
    lines.push(`${toolName} - success`);

    const labelQuery = asString(data.labelQuery) ?? '<empty>';
    const total = asNumber(data.total);
    const returned = asNumber(data.returned);
    const remaining = asNumber(data.remainingCount);
    const nextSearchIndex = data.nextSearchIndex;
    const truncated = asBoolean(data.truncated);

    lines.push(`query="${labelQuery}"`);
    lines.push(`paging: total=${total ?? '?'} returned=${returned ?? '?'} remaining=${remaining ?? '?'} nextSearchIndex=${nextSearchIndex === null ? 'null' : toDisplayValue(nextSearchIndex)}`);
    if (truncated !== null)
        lines.push(`truncated=${truncated}`);

    const text = asString(data.text);
    if (text)
        lines.push(`message=${text}`);

    const items = asArray(data.items) ?? [];
    if (items.length === 0)
    {
        lines.push('items: none');
        return finalize(lines);
    }

    const limited = limitArray(items);
    lines.push(`items (${limited.items.length}/${items.length} shown):`);
    limited.items.forEach((item, index) =>
    {
        const record = asRecord(item);
        const signature = asString(record?.signature) ?? '<unknown signature>';
        const type = asString(record?.type);
        lines.push(`- [${index + 1}] ${signature}${type ? ` [${type}]` : ''}`);
        const docs = asString(record?.docs);
        if (docs && docs.trim().length > 0)
        {
            lines.push('  docs:');
            lines.push(indentBlock(truncateLines(docs), '    '));
        }
    });

    if (limited.omitted > 0)
        lines.push(`... and ${limited.omitted} more`);

    return finalize(lines);
}

function formatResolveSymbolSuccess(toolName: string, data: UnknownRecord): string
{
    const lines: string[] = [];
    lines.push(`${toolName} - success`);

    const symbol = asRecord(data.symbol);
    if (!symbol)
    {
        lines.push('symbol: <missing>');
        return finalize(lines);
    }

    const kind = asString(symbol.kind) ?? 'unknown';
    const name = asString(symbol.name) ?? '';
    const signature = asString(symbol.signature) ?? name;
    lines.push(`symbol: kind=${kind} name=${name} signature=${signature}`);

    const definition = asRecord(symbol.definition);
    if (definition)
    {
        const filePath = asString(definition.filePath) ?? '<unknown>';
        const startLine = asNumber(definition.startLine);
        const endLine = asNumber(definition.endLine);
        const locationLabel = startLine !== null && endLine !== null ? `${startLine}-${endLine}` : '?';
        lines.push(`definition: ${filePath}:${locationLabel}`);
        const preview = asString(definition.preview);
        if (preview && preview.length > 0)
        {
            lines.push('preview:');
            lines.push(truncateLines(preview));
        }
    }
    else
    {
        lines.push('definition: <none>');
    }

    const doc = asRecord(symbol.doc);
    if (doc)
    {
        const format = asString(doc.format) ?? 'plaintext';
        const text = asString(doc.text);
        if (text && text.trim().length > 0)
        {
            lines.push(`doc (${format}):`);
            lines.push(truncateLines(text));
        }
    }

    return finalize(lines);
}

function formatTypeMembersSuccess(toolName: string, data: UnknownRecord): string
{
    const lines: string[] = [];
    lines.push(`${toolName} - success`);

    const type = asRecord(data.type);
    const qualifiedName = asString(type?.qualifiedName) ?? asString(type?.name) ?? '<unknown>';
    const namespaceName = asString(type?.namespace);
    lines.push(`type=${qualifiedName}${namespaceName ? ` namespace=${namespaceName}` : ''}`);

    const members = asArray(data.members) ?? [];
    lines.push(`membersTotal=${members.length}`);
    if (members.length === 0)
        return finalize(lines);

    const limited = limitArray(members);
    lines.push(`members (${limited.items.length}/${members.length} shown):`);
    limited.items.forEach((member, index) =>
    {
        const record = asRecord(member);
        const kind = asString(record?.kind) ?? 'unknown';
        const visibility = asString(record?.visibility) ?? 'unknown';
        const declaredIn = asString(record?.declaredIn) ?? '<unknown>';
        const signature = asString(record?.signature) ?? '<unknown signature>';
        const inherited = asBoolean(record?.isInherited);
        const inheritedLabel = inherited === true ? ' inherited' : '';
        lines.push(`- [${index + 1}] ${kind}/${visibility}${inheritedLabel} declaredIn=${declaredIn} :: ${signature}`);

        const description = asString(record?.description);
        if (description && description.trim().length > 0)
        {
            lines.push('  description:');
            lines.push(indentBlock(truncateLines(description), '    '));
        }
    });
    if (limited.omitted > 0)
        lines.push(`... and ${limited.omitted} more`);

    return finalize(lines);
}

function formatClassHierarchySuccess(toolName: string, data: UnknownRecord): string
{
    const lines: string[] = [];
    lines.push(`${toolName} - success`);

    const root = asString(data.root) ?? '<unknown>';
    lines.push(`root=${root}`);

    const supers = asArray(data.supers) ?? [];
    if (supers.length > 0)
    {
        lines.push(`supers=${supers.map((item) => asString(item) ?? toDisplayValue(item)).join(' -> ')}`);
    }
    else
    {
        lines.push('supers=<none>');
    }

    const limits = asRecord(data.limits);
    if (limits)
    {
        const maxSuperDepth = asNumber(limits.maxSuperDepth);
        const maxSubDepth = asNumber(limits.maxSubDepth);
        const maxSubBreadth = asNumber(limits.maxSubBreadth);
        lines.push(`limits: maxSuperDepth=${maxSuperDepth ?? '?'} maxSubDepth=${maxSubDepth ?? '?'} maxSubBreadth=${maxSubBreadth ?? '?'}`);
    }

    const truncated = asRecord(data.truncated);
    if (truncated)
    {
        const supersTruncated = asBoolean(truncated.supers);
        const derivedDepthTruncated = asBoolean(truncated.derivedDepth);
        lines.push(`truncated: supers=${supersTruncated ?? false} derivedDepth=${derivedDepthTruncated ?? false}`);
    }

    const derivedByParent = asRecord(data.derivedByParent);
    if (derivedByParent)
    {
        const parentNames = Object.keys(derivedByParent).sort();
        const limitedParents = limitArray(parentNames);
        lines.push(`derivedByParent (${limitedParents.items.length}/${parentNames.length} shown):`);
        for (const parent of limitedParents.items)
        {
            const children = asArray(derivedByParent[parent]) ?? [];
            const childNames = children.map((item) => asString(item) ?? toDisplayValue(item));
            lines.push(`- ${parent}: ${childNames.length > 0 ? childNames.join(', ') : '<none>'}`);
        }
        if (limitedParents.omitted > 0)
            lines.push(`... and ${limitedParents.omitted} more parent entries`);
    }

    const sourceByClass = asRecord(data.sourceByClass);
    if (sourceByClass)
    {
        const classNames = Object.keys(sourceByClass).sort();
        const limitedClasses = limitArray(classNames);
        lines.push(`sourceByClass (${limitedClasses.items.length}/${classNames.length} shown):`);
        for (const className of limitedClasses.items)
        {
            const source = asRecord(sourceByClass[className]);
            if (!source)
            {
                lines.push(`- ${className}: <invalid source>`);
                continue;
            }
            const sourceKind = asString(source.source) ?? 'unknown';
            if (sourceKind === 'cpp')
            {
                lines.push(`- ${className}: cpp`);
                continue;
            }

            const filePath = asString(source.filePath) ?? '<unknown>';
            const startLine = asNumber(source.startLine);
            const endLine = asNumber(source.endLine);
            lines.push(`- ${className}: as ${filePath}:${startLine ?? '?'}-${endLine ?? '?'}`);
            const preview = asString(source.preview);
            if (preview && preview.trim().length > 0)
            {
                const firstLine = preview.split(/\r?\n/)[0] ?? '';
                lines.push(`  preview: ${firstLine}`);
            }
        }
        if (limitedClasses.omitted > 0)
            lines.push(`... and ${limitedClasses.omitted} more class entries`);
    }

    return finalize(lines);
}

function toRangeLabel(range: UnknownRecord | null): string
{
    if (!range)
        return '?';

    const start = asRecord(range.start);
    const end = asRecord(range.end);
    if (!start || !end)
        return '?';

    const startLine = asNumber(start.line);
    const startCharacter = asNumber(start.character);
    const endLine = asNumber(end.line);
    const endCharacter = asNumber(end.character);
    if (startLine === null || startCharacter === null || endLine === null || endCharacter === null)
        return '?';

    return `${startLine}:${startCharacter}-${endLine}:${endCharacter}`;
}

function formatFindReferencesSuccess(toolName: string, data: UnknownRecord): string
{
    const lines: string[] = [];
    lines.push(`${toolName} - success`);

    const total = asNumber(data.total);
    const references = asArray(data.references) ?? [];
    lines.push(`total=${total ?? references.length}`);

    if (references.length === 0)
    {
        lines.push('No references found.');
        return finalize(lines);
    }

    const limited = limitArray(references);
    for (let index = 0; index < limited.items.length; index += 1)
    {
        const reference = asRecord(limited.items[index]);
        const filePath = asString(reference?.filePath) ?? '<unknown>';
        const startLine = asNumber(reference?.startLine);
        const endLine = asNumber(reference?.endLine);
        const rangeLabel = toRangeLabel(asRecord(reference?.range));
        lines.push(`// ${filePath}:${startLine ?? '?'}-${endLine ?? '?'} (range ${rangeLabel})`);
        const preview = asString(reference?.preview);
        if (preview && preview.length > 0)
            lines.push(truncateLines(preview));
        else
            lines.push('<source unavailable>');

        if (index < limited.items.length - 1)
            lines.push('---');
    }

    if (limited.omitted > 0)
    {
        lines.push('---');
        lines.push(`... and ${limited.omitted} more references`);
    }

    return finalize(lines);
}

function formatFallbackSuccess(toolName: string, payload: UnknownRecord): string
{
    const lines: string[] = [];
    lines.push(`${toolName} - success`);
    const data = asRecord(payload.data);
    if (!data)
    {
        lines.push('No structured data.');
        return finalize(lines);
    }
    const keys = Object.keys(data).sort();
    if (keys.length === 0)
    {
        lines.push('data: <empty object>');
        return finalize(lines);
    }
    lines.push('data keys:');
    for (const key of keys)
    {
        lines.push(`- ${key}: ${toDisplayValue(data[key])}`);
    }
    return finalize(lines);
}

function formatSuccess(toolName: string, payload: UnknownRecord): string
{
    const data = asRecord(payload.data);
    if (!data)
        return finalize([`${toolName} - success`, 'No structured data.']);

    if (toolName === 'angelscript_searchApi')
        return formatSearchApiSuccess(toolName, data);
    if (toolName === 'angelscript_resolveSymbolAtPosition')
        return formatResolveSymbolSuccess(toolName, data);
    if (toolName === 'angelscript_getTypeMembers')
        return formatTypeMembersSuccess(toolName, data);
    if (toolName === 'angelscript_getClassHierarchy')
        return formatClassHierarchySuccess(toolName, data);
    if (toolName === 'angelscript_findReferences')
        return formatFindReferencesSuccess(toolName, data);

    return formatFallbackSuccess(toolName, payload);
}

export function formatToolText(toolName: string, payload: UnknownRecord): string
{
    try
    {
        if (payload.ok === false)
            return formatError(toolName, payload);
        if (payload.ok === true)
            return formatSuccess(toolName, payload);
        return finalize([
            `${toolName} - result`,
            'Payload status is unknown.'
        ]);
    }
    catch
    {
        return finalize([
            `${toolName} - error`,
            'code=INTERNAL_ERROR',
            'message=Failed to format readable text output.'
        ]);
    }
}
