export const README_EN_MARKER = 'LM_TOOLS_EN';
export const README_ZH_MARKER = 'LM_TOOLS_ZH';
export const FACE_AI_REPORT_MARKER = 'LM_TOOL_CONTRACTS';

function createPositionSchema() {
    return {
        type: 'object',
        properties: {
            line: {
                type: 'number',
                minimum: 1,
                description: '1-based line number in tool contract.'
            },
            character: {
                type: 'number',
                minimum: 1,
                description: '1-based character offset in tool contract.'
            }
        },
        required: [
            'line',
            'character'
        ]
    };
}

function createAbsoluteFilePathSchema() {
    return {
        type: 'string',
        description: 'Absolute file path containing the symbol.'
    };
}

export const lmToolManifest = [
    {
        name: 'angelscript_searchApi',
        tags: ['angelscript', 'api', 'search'],
        toolReferenceName: 'angelscript_searchApi',
        displayName: 'Angelscript API Search',
        modelDescription: 'Use when you need to discover Angelscript API symbols before you know the exact symbol name. Do not use when you already have a concrete file position and need symbol resolution. Requires `query`; leave `mode` at the default `smart` unless you are intentionally sending `/pattern/flags`.',
        userDescription: 'Search Angelscript API symbols.',
        canBeReferencedInPrompt: true,
        icon: '$(search)',
        inputSchema: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Search query. In `smart` mode, supports `Type.Member`, `Namespace::Func`, `GameplayCue;` with ASCII `;` leaf termination, trailing `(` or `()`, and `|` branches. In `regex` mode, use `/pattern/flags`.'
                },
                mode: {
                    type: 'string',
                    description: 'Search mode. Defaults to `smart`. Use `regex` only with `/pattern/flags`.',
                    enum: ['smart', 'regex'],
                    default: 'smart'
                },
                limit: {
                    type: 'number',
                    description: 'Maximum matches to return. Integer 1-200. Defaults to 20.',
                    minimum: 1,
                    maximum: 200,
                    default: 20
                },
                source: {
                    type: 'string',
                    description: 'Limit results to `native`, `script`, or `both`. Defaults to `both`.',
                    enum: ['native', 'script', 'both']
                },
                scope: {
                    type: 'string',
                    description: 'Known namespace or containing type to narrow before ranking. Type scopes can surface declared members, inherited methods and properties, and applicable mixin functions. Same-name namespace and type scopes merge automatically.'
                },
                includeInheritedFromScope: {
                    type: 'boolean',
                    description: 'Only applies to class/type scopes. When omitted, class scopes auto-expand inherited methods and properties, while namespace/struct/enum scopes keep inheritance expansion off. Explicit `true` preserves ignored-scope reporting for invalid or non-class scopes.'
                },
                includeDocs: {
                    type: 'boolean',
                    description: 'Attach full documentation text to returned matches. This enriches results only and does not affect ranking. Defaults to false.',
                    default: false
                }
            },
            required: ['query']
        },
        readmeSummary: {
            en: 'Requires `query`. Default `mode` is `smart`; use `regex` only with `/pattern/flags`. `scope` narrows a known namespace or type before ranking, `includeInheritedFromScope` only changes class scopes, and `includeDocs=true` adds docs without changing ranking.',
            zh: '需要 `query`. `mode` 默认是 `smart`, 只有明确提供 `/pattern/flags` 时才使用 `regex`. `scope` 会在排序前收窄已知 namespace 或 type, `includeInheritedFromScope` 只改变 class scope, `includeDocs=true` 只补全文档而不改变排序.'
        },
        report: {
            boundaryZh: '在不知道精确符号名时用于发现 API symbol. 不用于已有文件位置的 symbol resolve.',
            inputsZh: '`query` 必填; `mode` 取 `smart|regex`; `scope` 预先收窄 namespace/type; `includeInheritedFromScope` 只影响 class scope; `includeDocs` 只补全文档.',
            textBodyZh: '按 scope, owner 或 namespace 分组后的类型桩或成员声明',
            textMetaZh: '`// scope: ...`, `// notice [...]`, `// native`, `// mixin from ...`, `// inherited from ...`',
            previewRuleZh: '无源码预览'
        }
    },
    {
        name: 'angelscript_resolveSymbolAtPosition',
        tags: ['angelscript', 'symbol', 'hover'],
        toolReferenceName: 'angelscript_resolveSymbolAtPosition',
        displayName: 'Angelscript Resolve Symbol At Position',
        modelDescription: 'Use when you have an absolute file path and 1-based cursor position and need the symbol, signature, documentation, or definition at that location. Do not use when the primary goal is collecting project references.',
        userDescription: 'Resolve the symbol at an absolute file path and 1-based position.',
        canBeReferencedInPrompt: true,
        icon: '$(symbol-method)',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: createAbsoluteFilePathSchema(),
                position: createPositionSchema(),
                includeDocumentation: {
                    type: 'boolean',
                    description: 'Include documentation when available. Defaults to true.',
                    default: true
                }
            },
            required: ['filePath', 'position']
        },
        readmeSummary: {
            en: 'Requires absolute `filePath` plus 1-based `position`. `includeDocumentation` defaults to `true`.',
            zh: '需要绝对路径 `filePath` 和 1-based 的 `position`. `includeDocumentation` 默认是 `true`.'
        },
        report: {
            boundaryZh: '在已有绝对路径和光标位置时用于识别当前位置 symbol, signature, doc 和 definition. 不用于项目级 references 搜索.',
            inputsZh: '`filePath` 必须是绝对路径; `position.line` 和 `position.character` 都是 1-based; `includeDocumentation` 默认 `true`.',
            textBodyZh: '`/** ... */` + 声明,或 `/** ... */` + definition preview',
            textMetaZh: '`// definition: <file>:<start>-<end>`, `// source unavailable`',
            previewRuleZh: '宏回溯行用 `-`, 定义命中行用 `:`'
        }
    },
    {
        name: 'angelscript_getTypeMembers',
        tags: ['angelscript', 'type', 'members'],
        toolReferenceName: 'angelscript_getTypeMembers',
        displayName: 'Angelscript Type Members',
        modelDescription: 'Use when you need members from one exact Angelscript type. Do not use when you need class hierarchy traversal. Requires exact `name`; provide `namespace` only to disambiguate collisions.',
        userDescription: 'List members for a given Angelscript type.',
        canBeReferencedInPrompt: true,
        icon: '$(symbol-class)',
        inputSchema: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: 'Type name to inspect.'
                },
                namespace: {
                    type: 'string',
                    description: 'Namespace used only to disambiguate the type name. Use an empty string for the root namespace.'
                },
                includeInherited: {
                    type: 'boolean',
                    description: 'Include inherited members. Defaults to false.',
                    default: false
                },
                includeDocs: {
                    type: 'boolean',
                    description: 'Include member description text. `type.description` is always returned. Defaults to false.',
                    default: false
                },
                kinds: {
                    type: 'string',
                    description: 'Filter members to `both`, `method`, or `property`. Defaults to `both`.',
                    enum: ['both', 'method', 'property'],
                    default: 'both'
                }
            },
            required: ['name']
        },
        readmeSummary: {
            en: 'Requires exact `name`; `namespace` only disambiguates collisions. `type.description` is always returned, while member docs need `includeDocs=true`.',
            zh: '需要精确 `name`; `namespace` 只用于消除重名歧义. `type.description` 始终返回, 成员文档需要 `includeDocs=true`.'
        },
        report: {
            boundaryZh: '在只需要单个 Angelscript type 的成员列表时使用. 不用于父子类层级遍历.',
            inputsZh: '`name` 必填; `namespace` 只做消歧; `includeInherited` 默认 `false`; `includeDocs` 只控制成员文档; `kinds` 过滤 `both\\|method\\|property`.',
            textBodyZh: '目标类型说明 + 成员声明列表',
            textMetaZh: '`// inherited from ...`, `// mixin from ...`',
            previewRuleZh: '无源码预览'
        }
    },
    {
        name: 'angelscript_getClassHierarchy',
        tags: ['angelscript', 'class', 'hierarchy'],
        toolReferenceName: 'angelscript_getClassHierarchy',
        displayName: 'Angelscript Class Hierarchy',
        modelDescription: 'Use when you need the parent chain or derived classes for one exact class. Do not use when you only need members from a single type. Requires exact class `name`.',
        userDescription: 'Get class hierarchy for a given Angelscript class.',
        canBeReferencedInPrompt: true,
        icon: '$(symbol-class)',
        inputSchema: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: 'Exact class name to inspect, for example `APawn`.'
                },
                maxSuperDepth: {
                    type: 'number',
                    description: 'Maximum number of supertypes to return. Non-negative integer. Defaults to 3.',
                    default: 3
                },
                maxSubDepth: {
                    type: 'number',
                    description: 'Maximum depth for the subtype tree. Non-negative integer. Defaults to 2.',
                    default: 2
                },
                maxSubBreadth: {
                    type: 'number',
                    description: 'Maximum direct children returned per class. Non-negative integer. Defaults to 10. Per-class truncation counts are reported in `truncated.derivedBreadthByClass`.',
                    default: 10
                }
            },
            required: ['name']
        },
        readmeSummary: {
            en: 'Requires exact class `name`. `maxSuperDepth`, `maxSubDepth`, and `maxSubBreadth` bound the returned tree and default to `3/2/10`.',
            zh: '需要精确 class `name`. `maxSuperDepth`, `maxSubDepth` 和 `maxSubBreadth` 用来裁剪返回层级, 默认值是 `3/2/10`.'
        },
        report: {
            boundaryZh: '在需要父链或子类扩展时使用. 不用于单个 type 的成员查询.',
            inputsZh: '`name` 必填; `maxSuperDepth`, `maxSubDepth`, `maxSubBreadth` 都是非负整数限制, 默认 `3/2/10`.',
            textBodyZh: '`// lineage: ...`, `// derived:` 树, 再接源码预览或声明桩',
            textMetaZh: '`// native`, `// truncated: ...`, `// source unavailable`',
            previewRuleZh: '脚本类预览按真实行号输出'
        }
    },
    {
        name: 'angelscript_findReferences',
        tags: ['angelscript', 'references', 'symbol'],
        toolReferenceName: 'angelscript_findReferences',
        displayName: 'Angelscript Find References',
        modelDescription: 'Use when you have an absolute file path and 1-based symbol position and need project references to that symbol. Do not use when you only need to identify the symbol at the current position.',
        userDescription: 'Find references for the symbol at an absolute file path and 1-based position.',
        canBeReferencedInPrompt: true,
        icon: '$(references)',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: createAbsoluteFilePathSchema(),
                position: createPositionSchema(),
                limit: {
                    type: 'number',
                    description: 'Maximum references to return. Integer 1-200. Defaults to 30.',
                    minimum: 1,
                    maximum: 200,
                    default: 30
                }
            },
            required: ['filePath', 'position']
        },
        readmeSummary: {
            en: 'Requires absolute `filePath` plus 1-based `position`. `limit` defaults to `30` and caps results at `200`.',
            zh: '需要绝对路径 `filePath` 和 1-based 的 `position`. `limit` 默认 `30`, 最大 `200`.'
        },
        report: {
            boundaryZh: '在已有 symbol 位置并需要项目级 references 时使用. 不用于当前位置 symbol resolve.',
            inputsZh: '`filePath` 必须是绝对路径; `position.line` 和 `position.character` 都是 1-based; `limit` 默认 `30`, 最大 `200`.',
            textBodyZh: '每个文件下的 `// range: ...` + preview',
            textMetaZh: '`// <filePath>`, `// truncated at limit ...`',
            previewRuleZh: '命中引用行用 `:`'
        }
    }
];

export function getLanguageModelToolsContribution() {
    return lmToolManifest.map((tool) => ({
        name: tool.name,
        tags: [...tool.tags],
        toolReferenceName: tool.toolReferenceName,
        displayName: tool.displayName,
        modelDescription: tool.modelDescription,
        userDescription: tool.userDescription,
        canBeReferencedInPrompt: tool.canBeReferencedInPrompt,
        icon: tool.icon,
        inputSchema: tool.inputSchema
    }));
}

export function getLmToolNames() {
    return lmToolManifest.map((tool) => tool.name);
}

export function buildGeneratedBlock(marker, content) {
    const normalized = content.trimEnd();
    return [
        `<!-- BEGIN GENERATED:${marker} -->`,
        normalized,
        `<!-- END GENERATED:${marker} -->`
    ].join('\n');
}

export function replaceGeneratedBlock(documentText, marker, content) {
    const blockPattern = new RegExp(
        `<!-- BEGIN GENERATED:${marker} -->[\\s\\S]*?<!-- END GENERATED:${marker} -->`,
        'u'
    );
    const replacement = buildGeneratedBlock(marker, content);
    if (!blockPattern.test(documentText))
        throw new Error(`Missing generated block markers for ${marker}.`);
    return documentText.replace(blockPattern, replacement);
}

export function renderReadmeLmToolsBlock(locale) {
    const isEnglish = locale === 'en';
    const listIntro = isEnglish ? 'Exposed tools:' : '提供以下工具:';
    const notesIntro = isEnglish ? 'Tool notes:' : '工具说明:';
    const noteKey = isEnglish ? 'en' : 'zh';
    const lines = [
        listIntro,
        ...lmToolManifest.map((tool) => `- \`${tool.name}\``),
        '',
        notesIntro,
        ...lmToolManifest.map((tool) => `- \`${tool.name}\`: ${tool.readmeSummary[noteKey]}`)
    ];
    return lines.join('\n');
}

export function renderFaceAiReportBlock() {
    const commonContractLines = [
        '适用工具:',
        ...lmToolManifest.map((tool) => `- \`${tool.name}\``),
        '',
        '统一公共契约:',
        '- 当前仓库只实现 VS Code `Language Model Tool`.',
        '- LM tool 始终返回可读文本.',
        '- 结构化 JSON 仅在 `UnrealAngelscript.languageModelTools.outputMode=text+structured` 时返回.',
        '- `UnrealAngelscript.languageModelTools.outputMode` 默认值为 `text-only`.',
        '- 结构化结果继续沿用内部 `{ ok, data/error }` envelope.',
        '',
        '统一文本风格:',
        '- 首行使用稳定标题, 例如 `Angelscript API search`.',
        '- 成功文本默认采用 code-first 风格, 主体优先是声明式文本或源码片段.',
        '- 文档统一归一化后渲染为 `/** ... */`.',
        '- owner, origin, range, scope, truncation 等元信息统一使用 `// ...` 注释.',
        '- 源码预览使用 `lineNumber + \':\'/\'-\' + 4 spaces + source text`.',
        '- 无结果时输出代码风格注释, 例如 `// No matches found.`.',
        '- 错误统一输出标题, `error: ...`, `code: ...`, 以及可选 `hint: ...` 和 `details: ...`.',
        '',
        '各工具公共契约摘要:',
        '| Tool | 选择边界 | 关键输入 |',
        '| --- | --- | --- |',
        ...lmToolManifest.map((tool) => `| \`${tool.name}\` | ${tool.report.boundaryZh} | ${tool.report.inputsZh} |`),
        '',
        '各工具文本形态:',
        '| Tool | 主要文本主体 | 注释元信息 | 预览规则 |',
        '| --- | --- | --- | --- |',
        ...lmToolManifest.map((tool) => `| \`${tool.name}\` | ${tool.report.textBodyZh} | ${tool.report.textMetaZh} | ${tool.report.previewRuleZh} |`),
        '',
        '`angelscript_searchApi` 关键规则:',
        '- API 面板和 LM tool 都以 `mode=smart` 作为默认行为; `mode=regex` 仍然要求 `query` 使用 `/pattern/flags`.',
        '- `smart` 查询支持 `Type.Member`, `Namespace::Func`, `GameplayCue;`, 尾部 `(` 或 `()`, 以及 `|` branch.',
        '- `scope` 会在排序前收窄已知 namespace 或 containing type; 同名 namespace 和 type scope 会自动合并.',
        '- 省略 `includeInheritedFromScope` 时, 只有 class scope 会自动展开 inherited method/property, 其他 scope 保持关闭.'
    ];
    return commonContractLines.join('\n');
}
