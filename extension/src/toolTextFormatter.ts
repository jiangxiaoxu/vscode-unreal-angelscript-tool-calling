import * as path from 'path';

type UnknownRecord = Record<string, unknown>;
type WorkspaceFolderLike = {
    name: string;
    uri: {
        fsPath: string;
    };
};

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

function toDisplayPath(filePath: string): string
{
    return path.normalize(filePath).replace(/\\/g, '/');
}

function samePath(a: string, b: string): boolean
{
    if (process.platform === 'win32')
        return a.toLowerCase() === b.toLowerCase();
    return a === b;
}

function isPathInsideRoot(filePath: string, rootPath: string): boolean
{
    const normalizedFilePath = path.normalize(filePath);
    const normalizedRootPath = path.normalize(rootPath);
    if (samePath(normalizedFilePath, normalizedRootPath))
        return true;

    const relativePath = path.relative(normalizedRootPath, normalizedFilePath);
    if (!relativePath)
        return true;
    return !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

function formatPathForTextOutput(filePath: string): string
{
    const normalizedPath = path.normalize(filePath);
    if (!path.isAbsolute(normalizedPath))
        return toDisplayPath(normalizedPath);

    const workspaceFolders = getWorkspaceFolders();
    let bestFolder: WorkspaceFolderLike | null = null;
    let bestRootPath = '';

    for (const workspaceFolder of workspaceFolders)
    {
        const rootPath = path.normalize(workspaceFolder.uri.fsPath);
        if (!isPathInsideRoot(normalizedPath, rootPath))
            continue;
        if (!bestFolder || rootPath.length > bestRootPath.length)
        {
            bestFolder = workspaceFolder;
            bestRootPath = rootPath;
        }
    }

    if (!bestFolder)
        return toDisplayPath(normalizedPath);

    const relativePath = path.relative(bestRootPath, normalizedPath);
    if (!relativePath)
        return bestFolder.name;

    return `${bestFolder.name}/${toDisplayPath(relativePath)}`;
}

function getWorkspaceFolders(): readonly WorkspaceFolderLike[]
{
    try
    {
        const vscode = require('vscode') as typeof import('vscode');
        return vscode.workspace.workspaceFolders ?? [];
    }
    catch
    {
        return [];
    }
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

function formatSearchSourceLabel(source: string): string
{
    if (source === 'both')
        return 'native|script';
    return source;
}

function pushValue(lines: string[], key: string, value: unknown): void
{
    if (value === undefined || value === null)
        return;
    lines.push(`${key}: ${toDisplayValue(value)}`);
}

function pushTextBlock(lines: string[], heading: string, text: string): void
{
    if (!text.trim())
        return;
    lines.push(`${heading}:`);
    for (const line of truncateLines(text).split(/\r?\n/))
        lines.push(line);
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
    const query = asString(request?.query) ?? '<empty>';
    const mode = asString(request?.mode) ?? 'smart';
    const limit = asNumber(request?.limit);
    const source = asString(request?.source) ?? 'both';
    const kinds = asArray(request?.kinds)?.map((item) => asString(item) ?? toDisplayValue(item)).filter(Boolean) as string[] | undefined;
    const scopePrefix = asString(request?.scopePrefix);
    const includeInheritedFromScope = asBoolean(request?.includeInheritedFromScope);
    const matches = asArray(data.matches) ?? [];
    const notices = asArray(data.notices) ?? [];
    const scopeLookup = asRecord(data.scopeLookup);
    const inheritedScopeOutcome = asString(data.inheritedScopeOutcome);

    pushValue(lines, 'query', query);
    pushValue(lines, 'mode', mode);
    pushValue(lines, 'limit', limit);
    pushValue(lines, 'source', formatSearchSourceLabel(source));
    if (kinds && kinds.length > 0)
        pushValue(lines, 'kinds', kinds.join('|'));
    pushValue(lines, 'scopePrefix', scopePrefix);
    pushValue(lines, 'includeInheritedFromScope', includeInheritedFromScope);
    pushValue(lines, 'inheritedScopeOutcome', inheritedScopeOutcome);
    pushValue(lines, 'count', matches.length);

    if (scopeLookup)
    {
        const resolvedKind = asString(scopeLookup.resolvedKind);
        const resolvedQualifiedName = asString(scopeLookup.resolvedQualifiedName);
        if (resolvedKind && resolvedQualifiedName)
            pushValue(lines, 'scopeLookup', `${resolvedKind} ${resolvedQualifiedName}`);
        else
            pushValue(lines, 'scopeLookup', scopePrefix ? '<unresolved>' : undefined);
    }

    if (notices.length > 0)
    {
        lines.push('====');
        lines.push('notices');
        for (const item of notices)
        {
            const record = asRecord(item);
            lines.push('---');
            pushValue(lines, 'code', asString(record?.code) ?? 'UNKNOWN');
            pushValue(lines, 'message', asString(record?.message) ?? 'Unknown notice.');
        }
    }

    if (matches.length === 0)
    {
        lines.push('No matches found.');
        return finalize(lines);
    }

    const limited = limitArray(matches);
    lines.push('====');
    lines.push('matches');
    for (const item of limited.items)
    {
        const record = asRecord(item);
        lines.push('---');
        pushValue(lines, 'qualifiedName', asString(record?.qualifiedName) ?? '<unknown>');
        pushValue(lines, 'kind', asString(record?.kind) ?? 'unknown');
        pushValue(lines, 'source', asString(record?.source) ?? 'unknown');
        pushValue(lines, 'isMixin', asBoolean(record?.isMixin));
        pushValue(lines, 'container', asString(record?.containerQualifiedName));
        pushValue(lines, 'scopeRelationship', asString(record?.scopeRelationship));
        pushValue(lines, 'scopeDistance', asNumber(record?.scopeDistance));
        pushValue(lines, 'signature', asString(record?.signature) ?? '<unknown signature>');
        const summary = asString(record?.summary);
        if (summary && summary.trim())
            pushTextBlock(lines, 'summary', summary);
    }
    if (limited.omitted > 0)
    {
        lines.push('---');
        lines.push(`... and ${limited.omitted} more matches`);
    }
    return finalize(lines);
}

function formatResolveSymbolSuccess(data: UnknownRecord): string
{
    const lines: string[] = ['Angelscript resolve symbol'];
    const request = asRecord(data.request);
    const symbol = asRecord(data.symbol);

    pushValue(lines, 'file', asString(request?.filePath));
    const position = asRecord(request?.position);
    if (position)
    {
        const line = asNumber(position.line);
        const character = asNumber(position.character);
        if (line !== null && character !== null)
            pushValue(lines, 'position', `${line}:${character}`);
    }

    if (!symbol)
    {
        lines.push('error: Missing symbol payload.');
        lines.push('code: INTERNAL_ERROR');
        return finalize(lines);
    }

    pushValue(lines, 'symbol', asString(symbol.name) ?? '<unknown>');
    pushValue(lines, 'kind', asString(symbol.kind) ?? 'unknown');
    pushValue(lines, 'signature', asString(symbol.signature) ?? asString(symbol.name) ?? '<unknown>');

    const definition = asRecord(symbol.definition);
    if (!definition)
    {
        pushValue(lines, 'definition', '<none>');
    }
    else
    {
        const filePath = asString(definition.filePath) ?? '<unknown>';
        const startLine = asValidLineNumber(definition.startLine) ?? 1;
        const endLine = asValidLineNumber(definition.endLine) ?? startLine;
        pushValue(lines, 'definition', `${filePath}:${startLine}-${endLine}`);
        lines.push('====');
        lines.push(filePath);
        const previewLines = renderPreviewBlockLines({
            startLine,
            endLine,
            preview: asString(definition.preview),
            matchStartLine: asValidLineNumber(definition.matchStartLine),
            matchEndLine: asValidLineNumber(definition.matchEndLine)
        });
        lines.push(...previewLines);
    }

    const doc = asRecord(symbol.doc);
    const docText = asString(doc?.text);
    if (docText && docText.trim())
    {
        lines.push('---');
        lines.push('doc');
        lines.push(...truncateLines(docText).split(/\r?\n/));
    }

    return finalize(lines);
}

function formatTypeMembersSuccess(data: UnknownRecord): string
{
    const lines: string[] = ['Angelscript type members'];
    const request = asRecord(data.request);
    const type = asRecord(data.type);
    const typeName = asString(type?.qualifiedName) ?? asString(type?.name) ?? '<unknown>';

    pushValue(lines, 'type', typeName);
    pushValue(lines, 'namespace', asString(type?.namespace) ?? asString(request?.namespace));
    const members = asArray(data.members) ?? [];
    pushValue(lines, 'count', members.length);
    pushValue(lines, 'includeInherited', asBoolean(request?.includeInherited) ?? false);
    pushValue(lines, 'includeDocs', asBoolean(request?.includeDocs) ?? false);

    if (members.length === 0)
    {
        lines.push('No members found.');
        return finalize(lines);
    }

    const limited = limitArray(members);
    lines.push('====');
    lines.push('members');
    for (const member of limited.items)
    {
        const record = asRecord(member);
        lines.push('---');
        pushValue(lines, 'kind', asString(record?.kind) ?? 'unknown');
        pushValue(lines, 'visibility', asString(record?.visibility) ?? 'unknown');
        pushValue(lines, 'declaredIn', asString(record?.declaredIn) ?? '<unknown>');
        pushValue(lines, 'inherited', asBoolean(record?.isInherited) ?? false);
        pushValue(lines, 'signature', asString(record?.signature) ?? '<unknown signature>');
        const description = asString(record?.description);
        if (description && description.trim())
            pushTextBlock(lines, 'description', description);
    }
    if (limited.omitted > 0)
    {
        lines.push('---');
        lines.push(`... and ${limited.omitted} more members`);
    }

    return finalize(lines);
}

function formatClassHierarchySuccess(data: UnknownRecord): string
{
    const lines: string[] = ['Angelscript class hierarchy'];
    pushValue(lines, 'root', asString(data.root) ?? '<unknown>');

    const supers = asArray(data.supers)?.map((item) => asString(item) ?? toDisplayValue(item)) ?? [];
    pushValue(lines, 'supers', supers.length > 0 ? supers.join(' -> ') : '<none>');

    const limits = asRecord(data.limits);
    if (limits)
    {
        const maxSuperDepth = asNumber(limits.maxSuperDepth);
        const maxSubDepth = asNumber(limits.maxSubDepth);
        const maxSubBreadth = asNumber(limits.maxSubBreadth);
        pushValue(
            lines,
            'limits',
            `super=${maxSuperDepth ?? '?'}, subDepth=${maxSubDepth ?? '?'}, subBreadth=${maxSubBreadth ?? '?'}`
        );
    }

    const truncated = asRecord(data.truncated);
    if (truncated)
    {
        const truncatedParts = [
            `supers=${asBoolean(truncated.supers) ?? false}`,
            `derivedDepth=${asBoolean(truncated.derivedDepth) ?? false}`
        ];
        const breadthByClass = asRecord(truncated.derivedBreadthByClass);
        if (breadthByClass && Object.keys(breadthByClass).length > 0)
        {
            const breadthParts = Object.keys(breadthByClass)
                .sort()
                .map((className) => `${className}=${toDisplayValue(breadthByClass[className])}`);
            truncatedParts.push(`derivedBreadthByClass=${breadthParts.join('|')}`);
        }
        pushValue(lines, 'truncated', truncatedParts.join(', '));
    }

    const derivedByParent = asRecord(data.derivedByParent);
    if (derivedByParent && Object.keys(derivedByParent).length > 0)
    {
        lines.push('====');
        lines.push('derivedByParent');
        const parentNames = limitArray(Object.keys(derivedByParent).sort());
        for (const parentName of parentNames.items)
        {
            const children = asArray(derivedByParent[parentName]) ?? [];
            const childNames = children.map((item) => asString(item) ?? toDisplayValue(item));
            lines.push('---');
            lines.push(`${parentName}: ${childNames.length > 0 ? childNames.join(', ') : '<none>'}`);
        }
        if (parentNames.omitted > 0)
        {
            lines.push('---');
            lines.push(`... and ${parentNames.omitted} more parent entries`);
        }
    }

    const sourceByClass = asRecord(data.sourceByClass);
    if (sourceByClass)
    {
        const classNames = limitArray(Object.keys(sourceByClass).sort());
        for (const className of classNames.items)
        {
            const source = asRecord(sourceByClass[className]);
            if (!source)
                continue;

            const sourceKind = asString(source.source) ?? 'unknown';
            const filePath = asString(source.filePath) ?? className;
            lines.push('====');
            lines.push(sourceKind === 'as' ? filePath : className);
            pushValue(lines, 'class', className);
            pushValue(lines, 'source', sourceKind);
            if (sourceKind !== 'as')
                continue;

            const startLine = asValidLineNumber(source.startLine) ?? 1;
            const endLine = asValidLineNumber(source.endLine) ?? startLine;
            const previewLines = renderPreviewBlockLines({
                startLine,
                endLine,
                preview: asString(source.preview)
            });
            lines.push(...previewLines);
        }
        if (classNames.omitted > 0)
        {
            lines.push('====');
            lines.push(`... and ${classNames.omitted} more class entries`);
        }
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
    const request = asRecord(data.request);
    pushValue(lines, 'file', asString(request?.filePath));
    const position = asRecord(request?.position);
    if (position)
    {
        const line = asNumber(position.line);
        const character = asNumber(position.character);
        if (line !== null && character !== null)
            pushValue(lines, 'position', `${line}:${character}`);
    }

    const references = asArray(data.references) ?? [];
    pushValue(lines, 'count', asNumber(data.total) ?? references.length);
    if (references.length === 0)
    {
        lines.push('No references found.');
        return finalize(lines);
    }

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

    for (const filePath of orderedPaths)
    {
        lines.push('====');
        lines.push(filePath);
        const entries = grouped.get(filePath) ?? [];
        for (const entry of entries)
        {
            lines.push('---');
            pushValue(lines, 'range', toRangeLabel(asRecord(entry.range)));
            const startLine = asValidLineNumber(entry.startLine) ?? 1;
            const endLine = asValidLineNumber(entry.endLine) ?? startLine;
            const previewLines = renderPreviewBlockLines({
                startLine,
                endLine,
                preview: asString(entry.preview),
                matchStartLine: startLine,
                matchEndLine: endLine
            });
            lines.push(...previewLines);
        }
    }
    if (limited.omitted > 0)
    {
        lines.push('====');
        lines.push(`... and ${limited.omitted} more references`);
    }
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
