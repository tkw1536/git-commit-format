import * as vscode from 'vscode';

const REGEX_SPLIT = /^\s*(#|$)/;
const REGEX_CUT_LINE = /^# ------------------------ >8 ------------------------$/;
const REGEX_BLANK = /^\s*$/;

const REGEX_TRAILER = /^[A-Za-z0-9\-]+\s?: .+$/; // Regex to validate if a line is a `key: value` line.
const REGEX_TRAILER_CONT = /^\s+$/; // Regex to validate if a line is a multiline trailer continuation

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
            if (typeof description !== 'string') {
                return;
            }
            return new vscode.DocumentSymbol(description, document.getText(range), vscode.SymbolKind.Object, range, range);
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
    let lastParagraph = chunks[chunks.map(chunk => chunk.kind).lastIndexOf(GitChunkKind.Paragraph)];
    if (lastParagraph && isTrailersChunk(lastParagraph, document)) {
        lastParagraph.kind = GitChunkKind.Trailers;
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

/* Known prefixes generated by git */
const GIT_GENERATED_PREFIXES = [
    "Signed-off-by: ",
    "(cherry picked from commit ",
];

/**
 * Checks if a given line a trailer chunk.
 * 
 * A line is considered a trailer if it is of the form `<token>: <value>`. The value may continue on the next line, if that starts with whitespace.
 * 
 * A chunk is a trailer chunk if (i) all lines are trailers or (ii) it starts with a git-known prefix and is at least 25% trailers.
 *
 * @param chunk The chunk to test.
 * @param document The Document the chunk belongs to.
 * @returns true if all lines of the chunk are trailers else false.
 */
function isTrailersChunk(chunk: GitCommitChunk, document: vscode.TextDocument): boolean {
    
    let first_line = true;
    let recognized_prefix = false;

    let trailers = 0; // number of trailers seen
    let non_trailers = 0; // number of non-trailer lines seen

    let possible_continuation = false; // could the next line be a continuation?
    for (let counter = chunk.range.start.line; counter <= chunk.range.end.line; counter++) {
        const text = document.lineAt(counter).text;

        // for the first line, check if we have a git-known prefix!
        if (first_line) {
            first_line = false;
            
            // check if we have any of the prefixes
            for (let i = 0; i < GIT_GENERATED_PREFIXES.length; i++) {
                if (text.startsWith(GIT_GENERATED_PREFIXES[i])) {
                    recognized_prefix = true;
                    break;
                }
            }

            // we saw the prefix!
            if (recognized_prefix) {
                trailers++;
                continue;
            }
        }
        
        
        // multi-line continuation
        if (possible_continuation && REGEX_TRAILER_CONT.test(text)) {
            continue;
        }

        // saw a trailer => next line could be a continuation
        if (REGEX_TRAILER.test(text)) {
            trailers++;
            possible_continuation = true;
            continue;
        }

        
        // saw a non-trailer
        // fast exit for case (i): saw a non-trailer line
        if (!recognized_prefix) {
            return false;
        }
        
        // the next line can't be a continuation
        non_trailers++;
        possible_continuation = false;
    }

    return (
        (non_trailers === 0 && trailers > 0) || // (i) all lines are non-trailers
        (recognized_prefix && 3*trailers >= non_trailers) // (ii) known prefix and at least 25% trailers
    );
}
