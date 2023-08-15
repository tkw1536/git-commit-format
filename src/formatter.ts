import * as vscode from 'vscode';

const REGEX_SPLIT = /^\s*(#|$)/;
const REGEX_CUT_LINE = /^# ------------------------ >8 ------------------------$/;
const REGEX_BLANK = /^\s*$/;
// Regex to validate if a line is a `key: value` line.
const REGEX_TRAILER = /^[A-Za-z0-9\-]+: .+$/;

/** Represents a single chunk of a git commit message */
interface GitCommitChunk {
    /** the range of lines in this chunk */
    range: vscode.Range;
    /** what kind of chunk this is */
    kind: GitChunkKind;
}
enum GitChunkKind {
    Subject = 0,
    Paragraph = 1,
    Comment = 2,
    Blank = 3,
    Diff = 4,
    Trailers = 5
}


export function formatGitCommitMessage(document: vscode.TextDocument, options: vscode.FormattingOptions, token: vscode.CancellationToken): vscode.ProviderResult<vscode.TextEdit[]> {
    return getDocumentChunks(document)
        .map(({range, kind}) => {
            const text = document.getText(range);
            if (kind === GitChunkKind.Subject) {
                return vscode.TextEdit.replace(range, formatSubjectChunk(text));
            } else if (kind === GitChunkKind.Paragraph) {
                return vscode.TextEdit.replace(range, formatParagraphChunk(text));
            } else if (kind === GitChunkKind.Trailers) {
                return vscode.TextEdit.replace(range, text);
            } else if (kind === GitChunkKind.Blank) {
                return vscode.TextEdit.replace(range, '');
            }
        })
    .filter(e => e !== undefined) as vscode.TextEdit[];
}

export function getGitCommitFoldingRanges(document: vscode.TextDocument, context: vscode.FoldingContext, token: vscode.CancellationToken): vscode.ProviderResult<vscode.FoldingRange[]> {
    return getDocumentChunks(document)
    .map(({range, kind}) => {
        if (kind === GitChunkKind.Subject || kind === GitChunkKind.Paragraph || kind === GitChunkKind.Trailers) {
            return new vscode.FoldingRange(range.start.line, range.end.line);
        } else if (kind === GitChunkKind.Comment) {
            return new vscode.FoldingRange(range.start.line, range.end.line, vscode.FoldingRangeKind.Comment);
        }
    })
    .filter(e => e !== undefined) as vscode.FoldingRange[];
}

export function getGitCommitSymbols(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.ProviderResult<vscode.DocumentSymbol[]> {
    const kindDescriptions = new Map([
        [GitChunkKind.Subject, "Subject Line"],
        [GitChunkKind.Paragraph, "Paragraph"],
        [GitChunkKind.Comment, "Comment"],
        [GitChunkKind.Diff, "Diff"],
        [GitChunkKind.Trailers, "Trailers"],
    ]);

    return getDocumentChunks(document)
        .map(({range, kind}) => {
            const description = kindDescriptions.get(kind);
            if (description != null) {
                return new vscode.DocumentSymbol(description, document.getText(range), vscode.SymbolKind.Object, range, range);
            }
        })
        .filter(e => e !== undefined) as vscode.DocumentSymbol[];
}

/** getDocumentChunks gets the commit message chunks inside a document  */
function getDocumentChunks(document: vscode.TextDocument): GitCommitChunk[] {
    // we create an array of chunks which we will slowly fill with content
    // we populate this with a fake initial line
    const chunks: Array<GitCommitChunk> = [{
        range: new vscode.Range(document.positionAt(0), document.positionAt(0)),
        kind: GitChunkKind.Blank,
    }];

    // keep track of the chunk kind and 'last' chunk kind
    let kind: GitChunkKind;
    let lastKind = GitChunkKind.Blank;

    // and if we had an initial and subject line
    let hadInitialLine = false;
    let hadSubjectLine = false;
    let hadCutLine = false;
    let areInDiff = false;

    let line: vscode.TextLine;
    for (let counter = 0; counter < document.lineCount; counter++) {
        // get the current line
        line = document.lineAt(counter);

        // check the kind of 'raw' chunk we have
        if (REGEX_BLANK.test(line.text)) {
            kind = GitChunkKind.Blank;
        } else if (REGEX_SPLIT.test(line.text)) {
            kind = GitChunkKind.Comment;
            if (REGEX_CUT_LINE.test(line.text)) {
                hadCutLine = true;
            }
        } else {
            kind = GitChunkKind.Paragraph;
        }

        // When we had a cut line and we are not in the comment section any longer, all
        // remaining text will be the diff
        if (hadCutLine && !REGEX_SPLIT.test(line.text)) {
            areInDiff = true;
        }
        if (areInDiff) {
            kind = GitChunkKind.Diff;
        }

        // the kind is idential to the last kind, so we can 'append' this line to the selection
        // it also means we had an initial line
        if(kind === lastKind) {
            hadInitialLine = true;
            chunks[chunks.length - 1].range = chunks[chunks.length - 1].range.with(undefined, line.range.end);
            continue;
        }

        // the initial line is still in the array, so keep it
        if(!hadInitialLine) {
            chunks.pop();
            hadInitialLine = true;
        }

        // store the kind we had as the last kind
        // if we didn't have a subject line yet, we can make it one
        lastKind = kind;
        if (kind === GitChunkKind.Paragraph && !hadSubjectLine) {
            kind = GitChunkKind.Subject;
            hadSubjectLine = true;
        }

        // and push it into the chunks
        chunks.push({
            range: line.range,
            kind,
        });
    }

    // The last paragraph might actually be a trailer paragraph.
    let lastParagraph = chunks[chunks.map(chunk => chunk.kind).lastIndexOf(GitChunkKind.Paragraph)]
    if (lastParagraph && isTrailersChunk(lastParagraph, document)) {
        lastParagraph.kind = GitChunkKind.Trailers
    }

    return chunks;
}

/**
 * Gets the subject line of a document
 * @param document Document to get subject line of
 */
export function getSubjectLineSelection(document: vscode.TextDocument): vscode.Selection {
    const subjectLine = getDocumentChunks(document).find(({kind}) => kind === GitChunkKind.Subject); // get the 'subject' chunk
    const {start, end} = subjectLine ? subjectLine.range : document.lineAt(0).range; // find it's start or end, fallback to the first line
    return new vscode.Selection(start, end); // and return
}

/**
 * Formats the subject chunk of a git-commit message
 * @param text Text of the subject line to format
 */
function formatSubjectChunk(text: string): string {
    return text
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Formats a paragraph chunk of a commit message
 * @param text Text of the paragraph
 * @param length Length to wrap line at
 */
function formatParagraphChunk(text: string): string {
    return text
        .replace(/\s+/g, ' ').trim()
        .replace(/(?![^\n]{1,72}$)([^\n]{1,72})\s/g, '$1\n');
}

/**
 * Check if all lines for the given chunk are trailers.
 *
 * A trailer is a line with `key: value`.
 *
 * @param chunk The chunk to test.
 * @param document The Document the chunk belongs to.
 * @returns true if all lines of the chunk are trailers else false.
 */
function isTrailersChunk(chunk: GitCommitChunk, document: vscode.TextDocument): boolean {
    for (let counter = chunk.range.start.line; counter <= chunk.range.end.line; counter++) {
        const text = document.lineAt(counter).text;
        if (!REGEX_TRAILER.test(text)) {
            return false
        }
    }
    return true
}
