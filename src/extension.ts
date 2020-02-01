import * as vscode from 'vscode';
import { formatGitCommitMessage, getGitCommitFoldingRanges, getGitCommitSymbols, getSubjectLineSelection } from "./formatter";

export function activate(context: vscode.ExtensionContext) {
	// provide a formatting function
	context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider('git-commit', {
        provideDocumentFormattingEdits: formatGitCommitMessage,
	}));

	// provide a folding range
	context.subscriptions.push(vscode.languages.registerFoldingRangeProvider('git-commit', {
		provideFoldingRanges: getGitCommitFoldingRanges,
	}));

	// provide a symbol provider
	context.subscriptions.push(vscode.languages.registerDocumentSymbolProvider('git-commit', {
		provideDocumentSymbols: getGitCommitSymbols,
	}));

	// when opening a 'git commit' document we want to automatically select the subject line to edit
	context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(handleOpenGit));
	vscode.workspace.textDocuments.forEach(handleOpenGit); // iterate over already open ones
}

function handleOpenGit(document: vscode.TextDocument) {
	// we need to be in "git-commit" mode
	if (document.languageId !== "git-commit") { return; }
	
	// we need to have a current editor
	const editor = vscode.window.activeTextEditor;
	if (!editor) { return; }

	// set the 'subject' line selection
	editor.selection = getSubjectLineSelection(document);
}
