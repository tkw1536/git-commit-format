const REGEX_SPLIT = /^\s*(#|$)/g;
const REGEX_SPACES = /\s+/g;
const REGEX_NEWLINES = /\n\n\n*/g;
const REGEX_WRAP = /(?![^\n]{1,72}$)([^\n]{1,72})\s/g;

/**
 * Formats a plaintext git commit message
 * @param text Previous text of the git commit message
 */
export function formatGitCommitMessage(text: string): string {
    // grab all the lines that belong into one semantic line each
    let formatLines = [];
    let buffer = "";

    // split text into consecutive lines
    // where a comment or blank line interrupts
    text.split("\n").forEach(line => {
        if(REGEX_SPLIT.test(line)) {
            formatLines.push(buffer, line);
            buffer = "";
            return;
        }
        buffer += line + "\n";
    });
    if (buffer.length > 0) { formatLines.push(buffer); }

    let hadSubjectLine = false;
    return formatLines.map(line => {
        // If this is a comment line, use normal trimming
        if (REGEX_SPLIT.test(line)) {
            return line.trim();
        }

        
        // The first line we encounter is the subject line. 
        // It is simply a really long line
        if(!hadSubjectLine) {
            hadSubjectLine = true;
            return formatSubjectLine(line);
        }
        
        // other lines are concatinated and wrapped at 72 characters
        return wrapMessageParagraph(line);
    }).join('\n').replace(REGEX_NEWLINES, '\n\n'); // replace consecutive 
}

/**
 * Formats the subject line of a git-commit message
 * @param text Text of the subject line to format
 */
function formatSubjectLine(text: string): string {
    return text
        .replace(REGEX_SPACES, ' ')
        .trim();
}

/**
 * Formats a paragraph of a git commit message
 * @param text Text of the paragraph
 * @param length Length to wrap line at
 */
function wrapMessageParagraph(text: string): string {
    return text
        .replace(REGEX_SPACES, ' ').trim()
        .replace(REGEX_WRAP, '$1\n');
}