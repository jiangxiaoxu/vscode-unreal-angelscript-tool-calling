import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
    FACE_AI_REPORT_MARKER,
    README_EN_MARKER,
    README_ZH_MARKER,
    getLanguageModelToolsContribution,
    renderFaceAiReportBlock,
    renderReadmeLmToolsBlock,
    replaceGeneratedBlock
} from './lmToolManifest.mjs';

function readText(filePath) {
    return readFileSync(filePath, 'utf8');
}

function writeTextIfChanged(filePath, nextContent) {
    const currentContent = readText(filePath);
    if (currentContent === nextContent)
        return false;
    writeFileSync(filePath, nextContent, 'utf8');
    return true;
}

function syncPackageJson(repoRoot) {
    const packageJsonPath = path.join(repoRoot, 'package.json');
    const packageJson = JSON.parse(readText(packageJsonPath));
    packageJson.contributes.languageModelTools = getLanguageModelToolsContribution();
    const nextContent = `${JSON.stringify(packageJson, null, 4)}\n`;
    return writeTextIfChanged(packageJsonPath, nextContent);
}

function syncReadme(repoRoot) {
    const readmePath = path.join(repoRoot, 'README.md');
    let readmeText = readText(readmePath);
    readmeText = replaceGeneratedBlock(readmeText, README_EN_MARKER, renderReadmeLmToolsBlock('en'));
    readmeText = replaceGeneratedBlock(readmeText, README_ZH_MARKER, renderReadmeLmToolsBlock('zh'));
    return writeTextIfChanged(readmePath, readmeText);
}

function syncFaceAiReport(repoRoot) {
    const reportPath = path.join(repoRoot, 'face-ai-report.md');
    const reportText = replaceGeneratedBlock(
        readText(reportPath),
        FACE_AI_REPORT_MARKER,
        renderFaceAiReportBlock()
    );
    return writeTextIfChanged(reportPath, reportText);
}

function main() {
    const repoRoot = process.cwd();
    const changedFiles = [];

    if (syncPackageJson(repoRoot))
        changedFiles.push('package.json');
    if (syncReadme(repoRoot))
        changedFiles.push('README.md');
    if (syncFaceAiReport(repoRoot))
        changedFiles.push('face-ai-report.md');

    if (changedFiles.length === 0) {
        console.log('LM tool contract artifacts are already in sync.');
        return;
    }

    console.log(`Updated ${changedFiles.length} file(s):`);
    for (const changedFile of changedFiles)
        console.log(`- ${changedFile}`);
}

main();
