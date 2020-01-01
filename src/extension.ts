import * as vscode from 'vscode';
import { formatGitCommitMessage } from "./formatter";

export function activate(context: vscode.ExtensionContext) {
	vscode.languages.registerDocumentFormattingEditProvider('git-commit', {
        provideDocumentFormattingEdits: editEntireDocument(formatGitCommitMessage),
	});
}

/**
 * Function used to build an argument to provideDocumentFormattingEdits for an entire document as a whole
*/
function editEntireDocument(editCallback: (text: string) => string): (document: vscode.TextDocument) => vscode.TextEdit[] | undefined {
	return (document: vscode.TextDocument) => {
		// if we have a zero-line document, bail out
		if (document.lineCount === 0) { return; }

		// compute the range for the entire document
		const docStart = document.lineAt(0).range;
		const docEnd = document.lineAt(document.lineCount - 1).range;
		const documentRange = docStart.union(docEnd);

		// make the message
		const newDocument = editCallback(document.getText());
		
		// and return the edit
		return [new vscode.TextEdit(documentRange, newDocument)];
	};
}

/**
 * Called when this extension is disabled. No-op. 
 */
export function deactivate() {}
