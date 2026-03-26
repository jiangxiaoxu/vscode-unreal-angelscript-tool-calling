import * as vscode from 'vscode';
import { LanguageClient } from 'vscode-languageclient/node';
import {
    GetAPIRequest,
    GetAPIDetailsRequest,
    GetAPISearchLspMatch,
    GetAPISearchLspResult,
    GetAPISearchRequest,
    SearchSource
} from './apiRequests';

export function registerApiPanel(context : vscode.ExtensionContext, client : LanguageClient) : void
{
    let apiTree = new ASApiTreeProvider(client);
    let apiSearch = new ASApiSearchProvider(client);
    let apiDetails = new ASApiDetailsProvider(client);

    apiSearch.tree = apiTree;

    context.subscriptions.push(vscode.window.registerTreeDataProvider("angelscript-api-list", apiTree));
    context.subscriptions.push(vscode.window.registerWebviewViewProvider("angelscript-api-search", apiSearch));
    context.subscriptions.push(vscode.window.registerWebviewViewProvider("angelscript-api-details", apiDetails));
    context.subscriptions.push(vscode.commands.registerCommand("angelscript-api-list.view-details", function (data: any)
    {
        apiDetails.showDetails(data);
    }));
}

class ASApiSearchProvider implements vscode.WebviewViewProvider
{
    webview: vscode.Webview;
    client: LanguageClient;
    searchHtml: string;
    tree: ASApiTreeProvider;

    constructor(client: LanguageClient)
    {
        this.client = client;
        this.searchHtml = `
        <style>
        .api-search-toolbar {
            display: flex;
            gap: 12px;
            align-items: center;
            margin-bottom: 8px;
            font-size: 90%;
        }
        .api-search-tabs {
            display: inline-flex;
            gap: 16px;
            align-items: flex-end;
            border-bottom: 1px solid var(--vscode-editorWidget-border, #808080);
            padding-bottom: 2px;
        }
        .api-search-tab {
            background: transparent;
            border: none;
            color: var(--vscode-descriptionForeground, #7a7a7a);
            cursor: pointer;
            padding: 4px 0 6px 0;
            font-size: 105%;
            font-weight: 500;
            opacity: 0.65;
            border-bottom: 2px solid transparent;
        }
        .api-search-tab[aria-selected="true"] {
            opacity: 1;
            color: var(--vscode-foreground, #d4d4d4);
            border-bottom-color: var(--vscode-textLink-foreground, #3794ff);
        }
        </style>

        <div class="api-search-toolbar" role="tablist" aria-label="Search source">
            <div class="api-search-tabs">
                <button class="api-search-tab" type="button" data-source="native" role="tab" aria-selected="false">Native</button>
                <button class="api-search-tab" type="button" data-source="script" role="tab" aria-selected="false">Script</button>
                <button class="api-search-tab" type="button" data-source="both" role="tab" aria-selected="true">Both</button>
            </div>
        </div>
        <input
            id="search"
            type="text"
            style="width: 100%; display: block; padding: 5px; font-size: 130%; background: inherit; border: 1px solid gray; color: inherit;"
            placeholder="Search Angelscript API (smart)"
        />
        <div style="margin-top: 6px; opacity: 0.75; font-size: 90%;">
            Smart search: <code>::</code> namespace, <code>.</code> member, <code>(</code> callable
        </div>

        <script>
        let vscode = acquireVsCodeApi();
        let searchBox = document.getElementById("search");
        let sourceTabs = Array.from(document.querySelectorAll(".api-search-tab"));
        let currentSource = "both";
        let isValidSource = function(value) {
            return value === "native" || value === "script" || value === "both";
        };
        let setSelectedSource = function(value) {
            sourceTabs.forEach((tab) => {
                let tabSource = tab.getAttribute("data-source");
                tab.setAttribute("aria-selected", tabSource === value ? "true" : "false");
            });
        };
        let state = vscode.getState();
        if (state && typeof state.source === "string" && isValidSource(state.source))
        {
            currentSource = state.source;
            setSelectedSource(currentSource);
            vscode.postMessage({
                search: searchBox.value,
                source: currentSource
            });
        }
        let getSelectedSource = function() {
            let selected = sourceTabs.find((tab) => tab.getAttribute("aria-selected") === "true");
            return selected ? selected.getAttribute("data-source") : "both";
        };
        searchBox.addEventListener("input", function()
        {
            vscode.postMessage({
                search: searchBox.value,
                source: getSelectedSource()
            });
        });
        sourceTabs.forEach((tab) => {
            tab.addEventListener("click", function() {
                let nextSource = tab.getAttribute("data-source") || "both";
                if (nextSource === currentSource)
                    return;
                sourceTabs.forEach((other) => other.setAttribute("aria-selected", "false"));
                tab.setAttribute("aria-selected", "true");
                currentSource = nextSource;
                vscode.setState({ source: currentSource });
                vscode.postMessage({
                    search: searchBox.value,
                    source: currentSource
                });
            });
        });
        window.addEventListener("focus", function(event)
        {
            searchBox.focus();
        });
        </script>
    `;
    }

    resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext, token: vscode.CancellationToken): Thenable<void> | void
    {
        this.webview = webviewView.webview;
        webviewView.webview.options = {
            enableScripts: true,
        };
        webviewView.webview.html = this.searchHtml;
        this.tree.searchSource = "both";

        let searchProvider = this;
        webviewView.webview.onDidReceiveMessage(function (data: any)
        {
            searchProvider.onMessage(data);
        });
    }

    onMessage(data: any)
    {
        if (data && typeof data === "object" && typeof data.search === "string")
        {
            this.tree.search = data.search;
            if (data.source === "native" || data.source === "script" || data.source === "both")
                this.tree.searchSource = data.source;
            else
                this.tree.searchSource = "both";
        }
        else
        {
            this.tree.search = data as string;
            this.tree.searchSource = "both";
        }
        this.tree.refresh();
    }
}

class ASApiDetailsProvider implements vscode.WebviewViewProvider
{
    webview: vscode.Webview;
    client: LanguageClient;

    constructor(client: LanguageClient)
    {
        this.client = client;
    }

    resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext, token: vscode.CancellationToken): Thenable<void> | void
    {
        this.webview = webviewView.webview;
        webviewView.webview.html = "<em>Select API to see details...</em>";
    }

    showDetails(data: any)
    {
        let webview = this.webview;
        this.client.sendRequest(GetAPIDetailsRequest, data).then(
            async function (details: string)
            {
                let detailsHtml = await vscode.commands.executeCommand("markdown.api.render", details) as string;
                detailsHtml = `
                <style>
                body {
                    font-size: 100%;
                }
                pre {
                    font-size: 110%;
                    white-space: pre-wrap;
                    tab-size: 2;
                    background: none;
                }
                pre > code {
                    background: none;
                }
                </style>

                <div style="width: 100%; overflow: wrap;">
                ${detailsHtml}
                </div>
`;
                webview.html = detailsHtml;
            }
        );
    }
}

function getSearchMatchLabel(match: GetAPISearchLspMatch): string
{
    if (match.kind === 'method' || match.kind === 'function')
        return `${match.qualifiedName}()`;
    return match.qualifiedName;
}

function getSearchMatchIcon(match: GetAPISearchLspMatch): vscode.ThemeIcon
{
    if (match.kind === 'class')
        return new vscode.ThemeIcon('symbol-class', new vscode.ThemeColor('charts.cyan'));
    if (match.kind === 'struct')
        return new vscode.ThemeIcon('symbol-struct', new vscode.ThemeColor('charts.cyan'));
    if (match.kind === 'enum')
        return new vscode.ThemeIcon('symbol-enum', new vscode.ThemeColor('charts.cyan'));
    if (match.kind === 'method' || match.kind === 'function')
        return new vscode.ThemeIcon('symbol-function', new vscode.ThemeColor('terminal.ansiBrightYellow'));
    return new vscode.ThemeIcon('symbol-field', new vscode.ThemeColor('terminal.ansiBrightCyan'));
}

function getSearchMatchId(match: GetAPISearchLspMatch): string
{
    return `${match.kind}|${match.qualifiedName}|${match.signature}`;
}

class ASApiTreeProvider implements vscode.TreeDataProvider<ASApiItem>
{
    client: LanguageClient;
    search: string;
    searchSource: SearchSource = "both";

    private _onDidChangeTreeData: vscode.EventEmitter<ASApiItem | undefined | void> = new vscode.EventEmitter<ASApiItem | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<ASApiItem | undefined | void> = this._onDidChangeTreeData.event;

    constructor(client: LanguageClient)
    {
        this.client = client;
    }

    refresh()
    {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ASApiItem)
    {
        return element;
    }

    getChildren(element?: ASApiItem): Thenable<ASApiItem[]>
    {
        let request;
        if (element)
            request = this.client.sendRequest(GetAPIRequest, element.id);
        else if (this.search)
            request = this.client.sendRequest(GetAPISearchRequest, {
                query: this.search,
                mode: 'smart',
                limit: 1000,
                source: this.searchSource
            });
        else
            request = this.client.sendRequest(GetAPIRequest, "");

        return request.then(
            function (values: any[] | GetAPISearchLspResult)
            {
                let items = new Array<ASApiItem>();
                const searchMatches = Array.isArray(values) ? null : values.matches;

                if (searchMatches)
                {
                    for (let match of searchMatches)
                    {
                        let item = new ASApiItem(getSearchMatchLabel(match), vscode.TreeItemCollapsibleState.None);
                        item.id = getSearchMatchId(match);
                        item.data = match.detailsData;
                        item.type = match.kind;
                        item.iconPath = getSearchMatchIcon(match);
                        if (match.detailsData)
                        {
                            item.command = {
                                "title": "View Details",
                                "command": "angelscript-api-list.view-details",
                                "arguments": [match.detailsData],
                            };
                        }
                        items.push(item);
                    }
                    return items;
                }

                for (let api of values as any[])
                {
                    if (api.type == "namespace")
                    {
                        let label: string = api.label;
                        if (label.indexOf("::") != -1)
                        {
                            let parts = label.split("::");
                            label = parts[parts.length - 2] + "::";
                        }
                        let item = new ASApiItem(label, vscode.TreeItemCollapsibleState.Collapsed);
                        item.type = api.type;
                        item.data = api.data;
                        item.id = `__ns_${api.id}`;
                        item.iconPath = new vscode.ThemeIcon("symbol-namespace", new vscode.ThemeColor("terminal.ansiBrightBlue"));
                        items.push(item);
                    }
                    else if (api.type == "type")
                    {
                        let item = new ASApiItem(api.label);
                        item.id = `__type_${api.id}`;
                        item.data = api.data;
                        item.type = api.type;
                        item.command = {
                            "title": "View Details",
                            "command": "angelscript-api-list.view-details",
                            "arguments": [api.data],
                        };
                        let typeColor = new vscode.ThemeColor("charts.cyan");
                        let typeIcon = "symbol-class";
                        if (Array.isArray(api.data) && api.data[0] == "type")
                        {
                            let typeKind = api.data[3] as string;
                            if (typeKind == "enum")
                                typeIcon = "symbol-enum";
                            else if (typeKind == "struct")
                                typeIcon = "symbol-struct";
                        }
                        item.iconPath = new vscode.ThemeIcon(typeIcon, typeColor);
                        items.push(item);
                    }
                    else if (api.type == "function")
                    {
                        let item = new ASApiItem(api.label);
                        item.id = `__fun_${api.id}`;
                        item.data = api.data;
                        item.type = api.type;
                        let isConstructor = typeof api.label === "string" && api.label.startsWith("<ctor>");
                        item.command = {
                            "title": "View Details",
                            "command": "angelscript-api-list.view-details",
                            "arguments": [api.data],
                        };
                        item.iconPath = new vscode.ThemeIcon(
                            isConstructor ? "symbol-constructor" : "symbol-function",
                            new vscode.ThemeColor(isConstructor ? "charts.orange" : "terminal.ansiBrightYellow")
                        );
                        items.push(item);
                    }
                    else if (api.type == "property")
                    {
                        let item = new ASApiItem(api.label);
                        item.id = `__prop_${api.id}`;
                        item.data = api.data;
                        item.type = api.type;
                        item.command = {
                            "title": "View Details",
                            "command": "angelscript-api-list.view-details",
                            "arguments": [api.data],
                        };
                        item.iconPath = new vscode.ThemeIcon("symbol-field", new vscode.ThemeColor("terminal.ansiBrightCyan"));
                        items.push(item);
                    }
                }

                return items;
            }
        );
    }

    resolveTreeItem(item: vscode.TreeItem, element: ASApiItem, token: vscode.CancellationToken): vscode.ProviderResult<vscode.TreeItem>
    {
        return this.client.sendRequest(GetAPIDetailsRequest, element.data).then(
            function (details: string)
            {
                element.tooltip = new vscode.MarkdownString(details);
                element.tooltip.supportHtml = true;
                return element;
            }
        );
    }
}

class ASApiItem extends vscode.TreeItem
{
    type: string;
    data: any;
}
