type UnknownRecord = Record<string, unknown>;

const MAX_LIST_ITEMS = 50;
const MAX_BLOCK_LINES = 40;
const MAX_TEXT_LENGTH = 30000;
const SOURCE_UNAVAILABLE_TEXT = '<source unavailable>';
const TRUNCATED_LINE_TEXT = '... (truncated)';

type PreviewRenderOptions = {
    startLine?: number | null;
    endLine?: number | null;
    preview?: string | null;
    matchStartLine?: number | null;
    matchEndLine?: number | null;
};

type SearchGroup = {
    key: string;
    header?: string;
    items: UnknownRecord[];
};

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
        return value.map((item) => toDisplayValue(item)).join('|');
    if (isRecord(value))
    {
        const entries = Object.keys(value).sort().map((key) => `${key}=${toDisplayValue(value[key])}`);
        return entries.join(', ');
    }
    return String(value);
}

function truncateLines(text: string, maxLines: number = MAX_BLOCK_LINES): string
{
    const lines = text.split(/\r?\n/);
    if (lines.length <= maxLines)
        return text;
    return `${lines.slice(0, maxLines).join('\n')}\n${TRUNCATED_LINE_TEXT}`;
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

function getToolTitle(toolName: string): string
{
    if (toolName === 'angelscript_searchApi')
        return 'Angelscript API search';
    if (toolName === 'angelscript_resolveSymbolAtPosition')
        return 'Angelscript resolve symbol';
    if (toolName === 'angelscript_getTypeMembers')
        return 'Angelscript type members';
    if (toolName === 'angelscript_getClassHierarchy')
        return 'Angelscript class hierarchy';
    if (toolName === 'angelscript_findReferences')
        return 'Angelscript references';
    return toolName;
}

function pushValue(lines: string[], key: string, value: unknown): void
{
    if (value === undefined || value === null)
        return;
    lines.push(`${key}: ${toDisplayValue(value)}`);
}

function normalizeDocCommentText(text: string): string
{
    let normalized = text.replace(/\r\n/g, '\n');
    normalized = normalized.replace(/^```[^\n]*$/gm, '');
    normalized = normalized.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
    normalized = normalized.replace(/`([^`]+)`/g, '$1');
    normalized = normalized.replace(/[ℹ️]/g, '');
    normalized = normalized.replace(/^[ \t]*>\s?/gm, '');
    normalized = normalized.replace(/^[ \t]*#{1,6}\s*/gm, '');
    normalized = normalized.replace(/^[ \t]*[-+*]\s+/gm, '- ');
    normalized = normalized.replace(/\*\*([^*\n]+)\*\*/g, '$1');
    normalized = normalized.replace(/__([^_\n]+)__/g, '$1');
    normalized = normalized.replace(/\*([^*\n]+)\*/g, '$1');
    normalized = normalized.replace(/_([^_\n]+)_/g, '$1');
    normalized = normalized.replace(/\n{3,}/g, '\n\n');
    return normalized.trim();
}

function pushDocCommentBlock(lines: string[], text: string): void
{
    const trimmed = truncateLines(normalizeDocCommentText(text)).trim();
    if (!trimmed)
        return;
    lines.push('/**');
    for (const line of trimmed.split(/\r?\n/))
        lines.push(line.length > 0 ? ` * ${line}` : ' *');
    lines.push(' */');
}

function appendSeparatedBlock(lines: string[], block: string[]): void
{
    if (block.length === 0)
        return;
    if (lines.length > 1)
        lines.push('');
    lines.push(...block);
}

function pushComment(lines: string[], text: string): void
{
    const trimmed = text.trim();
    if (!trimmed)
        return;
    lines.push(`// ${trimmed}`);
}

function getQualifiedLeafName(name: string): string
{
    const dotIndex = name.lastIndexOf('.');
    if (dotIndex >= 0)
        return name.slice(dotIndex + 1);
    const namespaceIndex = name.lastIndexOf('::');
    if (namespaceIndex >= 0)
        return name.slice(namespaceIndex + 2);
    return name;
}

function getQualifiedContainerName(name: string): string | null
{
    const dotIndex = name.lastIndexOf('.');
    if (dotIndex >= 0)
        return name.slice(0, dotIndex);
    const namespaceIndex = name.lastIndexOf('::');
    if (namespaceIndex >= 0)
        return name.slice(0, namespaceIndex);
    return null;
}

function getTypeMemberDisplayName(record: UnknownRecord): string | null
{
    const isAccessor = asBoolean(record.isAccessor) ?? false;
    if (isAccessor)
    {
        const propertyName = asString(record.propertyName);
        if (propertyName && propertyName.trim())
            return propertyName.trim();
    }
    const name = asString(record.name);
    if (name && name.trim())
        return name.trim();
    return null;
}

function escapeRegExp(text: string): string
{
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripOwnerPrefix(signature: string, owner: string | null, displayName: string | null): string
{
    if (!owner || !displayName)
        return signature;
    for (const separator of ['.', '::'])
    {
        const token = `${owner}${separator}${displayName}`;
        const matchIndex = signature.lastIndexOf(token);
        if (matchIndex < 0)
            continue;
        return `${signature.slice(0, matchIndex)}${displayName}${signature.slice(matchIndex + token.length)}`;
    }
    return signature;
}

function stripQualifiedDisplayNamePrefix(signature: string, displayName: string | null): string
{
    if (!displayName)
        return signature;

    const escapedName = escapeRegExp(displayName);
    const patterns = [
        new RegExp(`\\b[A-Za-z_][A-Za-z0-9_:<>]*\\.${escapedName}\\b`),
        new RegExp(`\\b[A-Za-z_][A-Za-z0-9_:<>]*::${escapedName}\\b`)
    ];

    for (const pattern of patterns)
    {
        const match = signature.match(pattern);
        if (!match)
            continue;

        const matchedText = match[0];
        const replacement = matchedText.endsWith(`::${displayName}`) ? displayName : displayName;
        return signature.replace(pattern, replacement);
    }

    return signature;
}

function normalizeDeclarationVisibility(declaration: string): string
{
    return declaration.replace(/^public\s+/, '').trim();
}

function ensureDeclarationTerminator(declaration: string, kind?: string | null): string
{
    if (kind === 'namespace')
        return declaration;
    if (/[;{}]$/.test(declaration))
        return declaration;
    return `${declaration};`;
}

function formatSignatureDeclaration(signature: string, kind?: string | null): string
{
    return ensureDeclarationTerminator(normalizeDeclarationVisibility(signature), kind);
}

function formatTypeMemberDeclaration(record: UnknownRecord): string
{
    const rawSignature = (asString(record.signature) ?? '<unknown signature>').trim();
    const displayName = getTypeMemberDisplayName(record);
    const declaration = displayName
        ? stripQualifiedDisplayNamePrefix(stripOwnerPrefix(rawSignature, asString(record.declaredIn), displayName), displayName)
        : rawSignature;
    return formatSignatureDeclaration(declaration, asString(record.kind));
}

function getTypeMemberOriginComment(record: UnknownRecord): string | null
{
    const declaredIn = asString(record.declaredIn);
    if (!declaredIn || !declaredIn.trim())
        return null;

    if ((asBoolean(record.isMixin) ?? false) === true)
        return `mixin from ${declaredIn}`;
    if ((asBoolean(record.isInherited) ?? false) === true)
        return `inherited from ${declaredIn}`;
    return null;
}

function getSearchGroupInfo(record: UnknownRecord): { key: string; header?: string }
{
    const kind = asString(record.kind) ?? 'unknown';
    const qualifiedName = asString(record.qualifiedName) ?? '';
    if (kind === 'class' || kind === 'struct' || kind === 'enum')
    {
        const namespace = getQualifiedContainerName(qualifiedName);
        return {
            key: `type:${namespace ?? '<root>'}`,
            header: namespace ? `namespace ${namespace}` : undefined
        };
    }

    const owner = asString(record.containerQualifiedName) ?? getQualifiedContainerName(qualifiedName) ?? '';
    return {
        key: `owner:${owner || '<root>'}`,
        header: owner || undefined
    };
}

function formatSearchDeclaration(record: UnknownRecord): string
{
    const kind = asString(record.kind);
    const qualifiedName = asString(record.qualifiedName) ?? '<unknown>';
    const shortName = getQualifiedLeafName(qualifiedName);
    if (kind === 'class' || kind === 'struct' || kind === 'enum')
        return `${kind} ${shortName};`;

    const rawSignature = (asString(record.signature) ?? shortName).trim();
    const owner = asString(record.containerQualifiedName) ?? getQualifiedContainerName(qualifiedName);
    return formatSignatureDeclaration(stripQualifiedDisplayNamePrefix(stripOwnerPrefix(rawSignature, owner, shortName), shortName), kind);
}

function buildSearchMatchMetaComments(record: UnknownRecord, request: UnknownRecord | null): string[]
{
    const comments: string[] = [];
    const matchReason = asString(record.matchReason);
    if (matchReason && matchReason.trim())
        comments.push(`match: ${matchReason}`);

    const source = asString(record.source);
    const requestSource = asString(request?.source) ?? 'both';
    if (requestSource === 'both' && source === 'native')
        comments.push('native');

    const scopeRelationship = asString(record.scopeRelationship);
    const owner = asString(record.containerQualifiedName);
    if (scopeRelationship === 'mixin')
        comments.push(owner ? `mixin from ${owner}` : 'mixin');
    else if (scopeRelationship === 'inherited')
        comments.push(owner ? `inherited from ${owner}` : 'inherited');
    else if (scopeRelationship && scopeRelationship !== 'declared')
        comments.push(scopeRelationship);

    const scopeDistance = asNumber(record.scopeDistance);
    if (scopeDistance !== null && scopeDistance > 0)
        comments.push(`scope distance: ${scopeDistance}`);
    return comments;
}

function buildSearchGroupBlock(group: SearchGroup, request: UnknownRecord | null): string[]
{
    const lines: string[] = [];
    if (group.header)
        pushComment(lines, group.header);

    group.items.forEach((item, index) =>
    {
        if (index > 0)
            lines.push('');

        for (const comment of buildSearchMatchMetaComments(item, request))
            pushComment(lines, comment);

        const documentation = asString(item.documentation);
        if (documentation && documentation.trim())
            pushDocCommentBlock(lines, documentation);
        else
        {
            const summary = asString(item.summary);
            if (summary && summary.trim())
                pushDocCommentBlock(lines, summary);
        }

        lines.push(formatSearchDeclaration(item));
    });

    return lines;
}

function buildGroupedSearchBlocks(
    matches: unknown[],
    request: UnknownRecord | null,
    limitOutput: boolean = true
): { blocks: string[][]; omitted: number }
{
    const limited = limitOutput ? limitArray(matches) : { items: matches, omitted: 0 };
    const grouped = new Map<string, SearchGroup>();
    for (const item of limited.items)
    {
        const record = asRecord(item);
        if (!record)
            continue;

        const groupInfo = getSearchGroupInfo(record);
        const existing = grouped.get(groupInfo.key);
        if (existing)
        {
            existing.items.push(record);
            continue;
        }

        grouped.set(groupInfo.key, {
            key: groupInfo.key,
            header: groupInfo.header,
            items: [record]
        });
    }

    const blocks: string[][] = [];
    for (const group of grouped.values())
    {
        const block = buildSearchGroupBlock(group, request);
        if (block.length > 0)
            blocks.push(block);
    }

    return {
        blocks,
        omitted: limited.omitted
    };
}

function buildSearchScopeGroupSection(scopeGroup: UnknownRecord, request: UnknownRecord | null): string[]
{
    const lines: string[] = [];
    const scope = asRecord(scopeGroup.scope);
    const resolvedKind = asString(scope?.resolvedKind);
    const resolvedQualifiedName = asString(scope?.resolvedQualifiedName);
    if (resolvedKind && resolvedQualifiedName)
        pushComment(lines, `scope: ${resolvedKind} ${resolvedQualifiedName}`);
    else
        pushComment(lines, 'scope: <unresolved>');

    const matches = asArray(scopeGroup.matches) ?? [];
    const returnedMatches = matches.length;
    const totalMatches = Math.max(
        returnedMatches,
        asNumber(scopeGroup.totalMatches) ?? returnedMatches
    );
    const omittedMatches = asNumber(scopeGroup.omittedMatches) ?? Math.max(0, totalMatches - returnedMatches);
    if (omittedMatches > 0)
        pushComment(lines, `returned: ${returnedMatches}/${totalMatches}`);

    const groupedBlocks = buildGroupedSearchBlocks(matches, request, false);
    if (groupedBlocks.blocks.length === 0)
    {
        appendSeparatedBlock(lines, ['// No matches found.']);
        return lines;
    }

    let hasRenderedGroup = false;
    for (const block of groupedBlocks.blocks)
    {
        if (!hasRenderedGroup)
        {
            appendSeparatedBlock(lines, block);
            hasRenderedGroup = true;
            continue;
        }

        lines.push('====');
        lines.push(...block);
        hasRenderedGroup = true;
    }

    return lines;
}

function buildResolveDeclaration(symbol: UnknownRecord): string
{
    const signature = (asString(symbol.signature) ?? asString(symbol.name) ?? '<unknown>').trim();
    return formatSignatureDeclaration(signature, asString(symbol.kind));
}

function buildResolvePreviewBlock(definition: UnknownRecord): string[]
{
    const filePath = asString(definition.filePath) ?? '<unknown>';
    const startLine = asValidLineNumber(definition.startLine) ?? 1;
    const endLine = asValidLineNumber(definition.endLine) ?? startLine;
    const previewLines = renderPreviewBlockLines({
        startLine,
        endLine,
        preview: asString(definition.preview),
        matchStartLine: asValidLineNumber(definition.matchStartLine),
        matchEndLine: asValidLineNumber(definition.matchEndLine)
    });

    const lines: string[] = [];
    pushComment(lines, `definition: ${filePath}:${startLine}-${endLine}`);
    if (previewLines.length === 1 && previewLines[0] === SOURCE_UNAVAILABLE_TEXT)
    {
        pushComment(lines, 'source unavailable');
        return lines;
    }
    lines.push(...previewLines);
    return lines;
}

function buildHierarchyLineage(root: string, supers: string[]): string
{
    if (supers.length === 0)
        return root;
    return [...supers].reverse().concat(root).join(' <- ');
}

function buildHierarchyDerivedComments(root: string, derivedByParent: UnknownRecord | null): string[]
{
    const lines: string[] = ['// derived:'];
    if (!root || !derivedByParent)
    {
        lines.push('//   <none>');
        return lines;
    }

    const visit = (className: string, depth: number): void =>
    {
        lines.push(`// ${'  '.repeat(depth)}${className}`);
        const children = asArray(derivedByParent[className]) ?? [];
        for (const child of children)
        {
            const childName = asString(child) ?? toDisplayValue(child);
            visit(childName, depth + 1);
        }
    };

    const directChildren = asArray(derivedByParent[root]) ?? [];
    if (directChildren.length === 0)
    {
        lines.push('//   <none>');
        return lines;
    }

    visit(root, 1);
    return lines;
}

function getHierarchyOrder(root: string, supers: string[], derivedByParent: UnknownRecord | null, sourceByClass: UnknownRecord | null): string[]
{
    const ordered: string[] = [];
    const seen = new Set<string>();

    const pushName = (className: string | null): void =>
    {
        if (!className || seen.has(className))
            return;
        seen.add(className);
        ordered.push(className);
    };

    pushName(root);
    for (const parent of supers)
        pushName(parent);

    const visitDerived = (className: string): void =>
    {
        const children = asArray(derivedByParent?.[className]) ?? [];
        for (const child of children)
        {
            const childName = asString(child) ?? toDisplayValue(child);
            pushName(childName);
            visitDerived(childName);
        }
    };
    if (root)
        visitDerived(root);

    for (const className of Object.keys(sourceByClass ?? {}).sort())
        pushName(className);

    return ordered;
}

function buildHierarchySourceBlock(className: string, source: UnknownRecord): string[]
{
    const sourceKind = asString(source.source) ?? 'unknown';
    const lines: string[] = [];
    if (sourceKind === 'cpp')
    {
        pushComment(lines, 'native');
        lines.push(`class ${className};`);
        return lines;
    }

    if (sourceKind === 'as')
    {
        const filePath = asString(source.filePath);
        if (filePath)
            pushComment(lines, filePath);
        const startLine = asValidLineNumber(source.startLine) ?? 1;
        const endLine = asValidLineNumber(source.endLine) ?? startLine;
        const previewLines = renderPreviewBlockLines({
            startLine,
            endLine,
            preview: asString(source.preview)
        });
        if (previewLines.length === 1 && previewLines[0] === SOURCE_UNAVAILABLE_TEXT)
        {
            pushComment(lines, 'source unavailable');
            lines.push(`class ${className};`);
            return lines;
        }
        lines.push(...previewLines);
        return lines;
    }

    pushComment(lines, `source: ${sourceKind}`);
    lines.push(`class ${className};`);
    return lines;
}

function buildHierarchyTruncationComment(truncated: UnknownRecord | null): string | null
{
    if (!truncated)
        return null;

    const parts: string[] = [];
    if ((asBoolean(truncated.supers) ?? false) === true)
        parts.push('supers=true');
    if ((asBoolean(truncated.derivedDepth) ?? false) === true)
        parts.push('derivedDepth=true');

    const breadthByClass = asRecord(truncated.derivedBreadthByClass);
    if (breadthByClass && Object.keys(breadthByClass).length > 0)
    {
        const breadthParts = Object.keys(breadthByClass)
            .sort()
            .map((className) => `${className}=${toDisplayValue(breadthByClass[className])}`);
        parts.push(`derivedBreadthByClass=${breadthParts.join('|')}`);
    }

    if (parts.length === 0)
        return null;
    return `truncated: ${parts.join(', ')}`;
}

export function formatPreviewLine(lineNumber: number, isMatch: boolean, text: string): string
{
    return `${String(lineNumber)}${isMatch ? ':' : '-'}    ${text}`;
}

export function renderPreviewBlockLines(options: PreviewRenderOptions): string[]
{
    const preview = typeof options.preview === 'string' ? options.preview : '';
    if (!preview || preview === SOURCE_UNAVAILABLE_TEXT)
        return [SOURCE_UNAVAILABLE_TEXT];

    const rawLines = truncateLines(preview).split(/\r?\n/);
    const startLine = asValidLineNumber(options.startLine) ?? 1;
    const endLine = Math.max(
        startLine,
        asValidLineNumber(options.endLine) ?? (startLine + rawLines.length - 1)
    );
    const explicitMatchStart = asValidLineNumber(options.matchStartLine);
    const explicitMatchEnd = asValidLineNumber(options.matchEndLine);
    const matchStartLine = explicitMatchStart ?? startLine;
    const matchEndLine = Math.max(matchStartLine, explicitMatchEnd ?? endLine);

    const lines: string[] = [];
    let lineNumber = startLine;
    for (let index = 0; index < rawLines.length; index += 1)
    {
        const text = rawLines[index];
        if (text === TRUNCATED_LINE_TEXT && lineNumber > endLine)
        {
            lines.push(text);
            continue;
        }

        const isMatch = lineNumber >= matchStartLine && lineNumber <= matchEndLine;
        lines.push(formatPreviewLine(lineNumber, isMatch, text));
        lineNumber += 1;
    }
    return lines;
}

function asValidLineNumber(value: unknown): number | null
{
    const lineNumber = asNumber(value);
    if (lineNumber === null || !Number.isInteger(lineNumber) || lineNumber < 1)
        return null;
    return lineNumber;
}

function formatError(toolName: string, payload: UnknownRecord): string
{
    const lines: string[] = [getToolTitle(toolName)];
    const error = asRecord(payload.error);
    if (!error)
    {
        lines.push('error: Unknown error payload.');
        lines.push('code: INTERNAL_ERROR');
        return finalize(lines);
    }

    pushValue(lines, 'error', asString(error.message) ?? 'Unknown error.');
    pushValue(lines, 'code', asString(error.code) ?? 'INTERNAL_ERROR');
    pushValue(lines, 'retryable', asBoolean(error.retryable));
    pushValue(lines, 'hint', asString(error.hint));

    const details = asRecord(error.details);
    if (details)
    {
        lines.push('details:');
        const keys = Object.keys(details).sort();
        for (const key of keys)
            lines.push(`${key}: ${toDisplayValue(details[key])}`);
    }

    return finalize(lines);
}

function formatSearchApiSuccess(data: UnknownRecord): string
{
    const lines: string[] = ['Angelscript API search'];
    const request = asRecord(data.request);
    const scope = asString(request?.scope);
    const matches = asArray(data.matches) ?? [];
    const matchCounts = asRecord(data.matchCounts);
    const scopeGroups = asArray(data.scopeGroups) ?? [];
    const notices = asArray(data.notices) ?? [];
    const scopeLookup = asRecord(data.scopeLookup);
    const inheritedScopeOutcome = asString(data.inheritedScopeOutcome);
    const totalMatches = Math.max(matches.length, asNumber(matchCounts?.total) ?? matches.length);
    const returnedMatches = Math.max(0, asNumber(matchCounts?.returned) ?? matches.length);
    const omittedMatches = asNumber(matchCounts?.omitted) ?? Math.max(0, totalMatches - returnedMatches);

    if (scopeGroups.length === 0 && scopeLookup)
    {
        const resolvedKind = asString(scopeLookup.resolvedKind);
        const resolvedQualifiedName = asString(scopeLookup.resolvedQualifiedName);
        if (resolvedKind && resolvedQualifiedName)
            pushComment(lines, `scope: ${resolvedKind} ${resolvedQualifiedName}`);
        else
            pushComment(lines, scope ? 'scope: <unresolved>' : '');

        const ambiguousCandidates = asArray(scopeLookup.ambiguousCandidates);
        if (ambiguousCandidates && ambiguousCandidates.length > 0)
        {
            const candidates = ambiguousCandidates.map((item) => asString(item) ?? toDisplayValue(item));
            pushComment(lines, `scope candidates: ${candidates.join(' | ')}`);
        }
    }

    if (inheritedScopeOutcome && inheritedScopeOutcome !== 'applied')
        pushComment(lines, `inherited scope: ${inheritedScopeOutcome}`);

    if (notices.length > 0)
    {
        for (const item of notices)
        {
            const record = asRecord(item);
            pushComment(
                lines,
                `notice [${asString(record?.code) ?? 'UNKNOWN'}]: ${asString(record?.message) ?? 'Unknown notice.'}`
            );
        }
    }

    if (omittedMatches > 0)
        pushComment(lines, `returned: ${returnedMatches}/${totalMatches}`);

    if (scopeGroups.length > 0)
    {
        let hasRenderedScopeGroup = false;
        for (const item of scopeGroups)
        {
            const record = asRecord(item);
            if (!record)
                continue;

            const block = buildSearchScopeGroupSection(record, request);
            if (block.length === 0)
                continue;

            if (!hasRenderedScopeGroup)
            {
                appendSeparatedBlock(lines, block);
                hasRenderedScopeGroup = true;
                continue;
            }

            lines.push('====');
            lines.push(...block);
            hasRenderedScopeGroup = true;
        }

        if (!hasRenderedScopeGroup)
            appendSeparatedBlock(lines, ['// No matches found.']);

        return finalize(lines);
    }

    if (matches.length === 0)
    {
        appendSeparatedBlock(lines, ['// No matches found.']);
        return finalize(lines);
    }

    const grouped = buildGroupedSearchBlocks(matches, request);
    let hasRenderedGroup = false;
    for (const block of grouped.blocks)
    {
        if (!hasRenderedGroup)
        {
            appendSeparatedBlock(lines, block);
            hasRenderedGroup = true;
            continue;
        }

        lines.push('====');
        lines.push(...block);
        hasRenderedGroup = true;
    }

    if (grouped.omitted > 0)
        appendSeparatedBlock(lines, [`// ... and ${grouped.omitted} more matches`]);

    return finalize(lines);
}

function formatResolveSymbolSuccess(data: UnknownRecord): string
{
    const lines: string[] = ['Angelscript resolve symbol'];
    const symbol = asRecord(data.symbol);

    if (!symbol)
    {
        lines.push('error: Missing symbol payload.');
        lines.push('code: INTERNAL_ERROR');
        return finalize(lines);
    }

    const doc = asRecord(symbol.doc);
    const docText = asString(doc?.text);
    if (docText && docText.trim())
    {
        const docLines: string[] = [];
        pushDocCommentBlock(docLines, docText);
        appendSeparatedBlock(lines, docLines);
    }

    const definition = asRecord(symbol.definition);
    if (definition)
    {
        const previewBlock = buildResolvePreviewBlock(definition);
        const hasSourceUnavailable = previewBlock.some((line) => line === '// source unavailable');
        if (hasSourceUnavailable)
        {
            previewBlock.push(buildResolveDeclaration(symbol));
            appendSeparatedBlock(lines, previewBlock);
            return finalize(lines);
        }
        appendSeparatedBlock(lines, previewBlock);
        return finalize(lines);
    }

    appendSeparatedBlock(lines, [buildResolveDeclaration(symbol)]);

    return finalize(lines);
}

function formatTypeMembersSuccess(data: UnknownRecord): string
{
    const lines: string[] = ['Angelscript type members'];
    const request = asRecord(data.request);
    const type = asRecord(data.type);
    const typeName = asString(type?.qualifiedName) ?? asString(type?.name) ?? '<unknown>';

    pushValue(lines, 'type', typeName);
    const members = asArray(data.members) ?? [];
    const typeDescription = asString(type?.description);
    lines.push('====');

    if (typeDescription && typeDescription.trim())
    {
        pushDocCommentBlock(lines, typeDescription);
        if (members.length > 0)
            lines.push('');
    }

    if (members.length === 0)
    {
        lines.push('// No members found.');
        return finalize(lines);
    }

    const limited = limitArray(members);
    let hasRenderedMember = false;
    for (const member of limited.items)
    {
        const record = asRecord(member);
        if (!record)
            continue;

        if (hasRenderedMember)
            lines.push('');

        const originComment = getTypeMemberOriginComment(record);
        if (originComment)
            lines.push(`// ${originComment}`);

        const description = asString(record.description);
        if (description && description.trim())
            pushDocCommentBlock(lines, description);

        lines.push(formatTypeMemberDeclaration(record));
        hasRenderedMember = true;
    }
    if (limited.omitted > 0)
    {
        if (hasRenderedMember)
            lines.push('');
        lines.push(`// ... and ${limited.omitted} more members`);
    }

    return finalize(lines);
}

function formatClassHierarchySuccess(data: UnknownRecord): string
{
    const lines: string[] = ['Angelscript class hierarchy'];
    const root = asString(data.root) ?? '<unknown>';
    const supers = asArray(data.supers)?.map((item) => asString(item) ?? toDisplayValue(item)) ?? [];
    const truncated = asRecord(data.truncated);
    const derivedByParent = asRecord(data.derivedByParent);
    pushComment(lines, `lineage: ${buildHierarchyLineage(root, supers)}`);
    appendSeparatedBlock(lines, buildHierarchyDerivedComments(root, derivedByParent));

    const truncationComment = buildHierarchyTruncationComment(truncated);
    if (truncationComment)
        appendSeparatedBlock(lines, [`// ${truncationComment}`]);

    const sourceByClass = asRecord(data.sourceByClass);
    if (sourceByClass)
    {
        const orderedClassNames = getHierarchyOrder(root, supers, derivedByParent, sourceByClass);
        const classNames = limitArray(orderedClassNames.filter((className) => isRecord(sourceByClass[className])));
        for (const className of classNames.items)
        {
            const source = asRecord(sourceByClass[className]);
            if (!source)
                continue;
            appendSeparatedBlock(lines, buildHierarchySourceBlock(className, source));
        }
        if (classNames.omitted > 0)
            appendSeparatedBlock(lines, [`// ... and ${classNames.omitted} more class entries`]);
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

function formatFindReferencesSuccess(data: UnknownRecord): string
{
    const lines: string[] = ['Angelscript references'];
    const references = asArray(data.references) ?? [];
    const total = Math.max(references.length, asNumber(data.total) ?? references.length);
    const returned = asNumber(data.returned) ?? references.length;
    const truncated = asBoolean(data.truncated) ?? false;
    if (references.length === 0)
    {
        appendSeparatedBlock(lines, ['// No references found.']);
        return finalize(lines);
    }

    if (truncated || returned < total)
        pushComment(lines, `returned: ${returned}/${total}`);

    const limited = limitArray(references);
    const grouped = new Map<string, UnknownRecord[]>();
    const orderedPaths: string[] = [];
    for (const item of limited.items)
    {
        const record = asRecord(item);
        if (!record)
            continue;
        const filePath = asString(record.filePath) ?? '<unknown>';
        const existing = grouped.get(filePath);
        if (existing)
        {
            existing.push(record);
            continue;
        }
        grouped.set(filePath, [record]);
        orderedPaths.push(filePath);
    }

    let hasRenderedFileGroup = false;
    for (const filePath of orderedPaths)
    {
        const block: string[] = [];
        pushComment(block, filePath);
        const entries = grouped.get(filePath) ?? [];
        entries.forEach((entry, index) =>
        {
            if (index > 0)
                block.push('');
            pushComment(block, `range: ${toRangeLabel(asRecord(entry.range))}`);
            const startLine = asValidLineNumber(entry.startLine) ?? 1;
            const endLine = asValidLineNumber(entry.endLine) ?? startLine;
            const previewLines = renderPreviewBlockLines({
                startLine,
                endLine,
                preview: asString(entry.preview),
                matchStartLine: startLine,
                matchEndLine: endLine
            });
            block.push(...previewLines);
        });

        if (!hasRenderedFileGroup)
        {
            appendSeparatedBlock(lines, block);
            hasRenderedFileGroup = true;
            continue;
        }

        lines.push('====');
        lines.push(...block);
        hasRenderedFileGroup = true;
    }
    if (limited.omitted > 0)
        appendSeparatedBlock(lines, [`// ... and ${limited.omitted} more returned references omitted from text output`]);
    return finalize(lines);
}

function formatFallbackSuccess(toolName: string, payload: UnknownRecord): string
{
    const lines: string[] = [getToolTitle(toolName)];
    const data = asRecord(payload.data);
    if (!data)
    {
        lines.push('No readable output.');
        return finalize(lines);
    }

    lines.push('====');
    lines.push('data');
    const keys = Object.keys(data).sort();
    for (const key of keys)
    {
        lines.push('---');
        pushValue(lines, key, data[key]);
    }
    return finalize(lines);
}

function formatSuccess(toolName: string, payload: UnknownRecord): string
{
    const data = asRecord(payload.data);
    if (!data)
        return finalize([getToolTitle(toolName), 'No readable output.']);

    if (toolName === 'angelscript_searchApi')
        return formatSearchApiSuccess(data);
    if (toolName === 'angelscript_resolveSymbolAtPosition')
        return formatResolveSymbolSuccess(data);
    if (toolName === 'angelscript_getTypeMembers')
        return formatTypeMembersSuccess(data);
    if (toolName === 'angelscript_getClassHierarchy')
        return formatClassHierarchySuccess(data);
    if (toolName === 'angelscript_findReferences')
        return formatFindReferencesSuccess(data);

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
            getToolTitle(toolName),
            'error: Payload status is unknown.',
            'code: INTERNAL_ERROR'
        ]);
    }
    catch
    {
        return finalize([
            getToolTitle(toolName),
            'error: Failed to format readable text output.',
            'code: INTERNAL_ERROR'
        ]);
    }
}
