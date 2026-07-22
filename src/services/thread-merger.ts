import * as fs from "fs";
import * as path from "path";

/**
 * A parsed HTML export file (either the main channel export or a thread export).
 */
interface ParsedExport {
  filePath: string;
  fileName: string;
  html: string;
  /** The numeric ID at the end of the file name. */
  trailingId: string | null;
  /** All message IDs referenced via `data-message-id` in the document. */
  messageIds: Set<string>;
}

/** Extra styling injected into the merged document for the collapsible threads. */
const THREAD_STYLE = [
  ".chatlog__thread{margin:0.15rem 0 0.6rem 72px;border-left:2px solid #4f545c;border-radius:4px;background-color:rgba(79,84,92,0.12)}",
  ".chatlog__thread>summary{cursor:pointer;padding:0.45rem 0.7rem;color:#00aff4;font-size:0.85rem;font-weight:600;list-style:none;user-select:none}",
  ".chatlog__thread>summary::-webkit-details-marker{display:none}",
  ".chatlog__thread>summary::before{content:\"\\25B6\";display:inline-block;margin-right:0.4rem;font-size:0.7rem;transition:transform 0.15s ease}",
  ".chatlog__thread[open]>summary::before{transform:rotate(90deg)}",
  ".chatlog__thread-content{padding:0.25rem 0.6rem 0.5rem}",
].join("");

/**
 * Finds the index directly after the `</div>` that closes the `<div>` starting
 * at `openTagStart`, by counting nested div depth.
 * @param html The HTML string to scan
 * @param openTagStart The index of the opening `<div` for the element
 * @returns The index just past the matching `</div>`, or -1 if unbalanced
 */
const findMatchingDivEnd = (html: string, openTagStart: number): number => {
  const tagRegex = /<div\b|<\/div>/g;
  tagRegex.lastIndex = openTagStart;

  let depth = 0;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(html)) !== null) {
    if (match[0] === "</div>") {
      depth -= 1;
      if (depth === 0) {
        return tagRegex.lastIndex;
      }
    } else {
      depth += 1;
    }
  }

  return -1;
};

/**
 * Extracts the inner HTML of the `<div class="chatlog">` container.
 * @param html The full document HTML
 * @returns The message groups markup between the chatlog open and close tags
 */
const extractChatlogInner = (html: string): string => {
  const openMatch = html.match(/<div class=(?:"chatlog"|chatlog)>/);
  if (!openMatch || openMatch.index === undefined) {
    return "";
  }

  const contentStart = openMatch.index + openMatch[0].length;
  const chatlogEnd = findMatchingDivEnd(html, openMatch.index);
  if (chatlogEnd === -1) {
    return "";
  }

  // chatlogEnd points past the closing </div>; strip that tag off.
  return html.slice(contentStart, chatlogEnd - "</div>".length);
};

/**
 * Splits a chatlog body into its top-level message group elements.
 * @param chatlogInner The inner HTML of the chatlog container
 * @returns An array of message group elements with their contained message IDs
 */
const extractMessageGroups = (
  chatlogInner: string
): { html: string; ids: string[] }[] => {
  const groupRegex = /<div class=(?:"chatlog__message-group"|chatlog__message-group)>/g;
  const groups: { html: string; ids: string[] }[] = [];

  let match: RegExpExecArray | null;
  while ((match = groupRegex.exec(chatlogInner)) !== null) {
    const end = findMatchingDivEnd(chatlogInner, match.index);
    if (end === -1) {
      break;
    }

    const groupHtml = chatlogInner.slice(match.index, end);
    const ids = [...groupHtml.matchAll(/data-message-id=(\d+)/g)].map(
      (m) => m[1]
    );
    groups.push({ html: groupHtml, ids });

    // Skip past this group so nested divs aren't matched as new groups.
    groupRegex.lastIndex = end;
  }

  return groups;
};

/**
 * Reads and parses an HTML export file.
 * @param filePath The absolute path to the HTML file
 * @returns The parsed export metadata and content
 */
const parseExport = (filePath: string): ParsedExport => {
  const html = fs.readFileSync(filePath, "utf8");
  const fileName = path.basename(filePath);

  // DiscordChatExporter names files "... [<id>].html"; the sample fixtures use
  // "....<id>.html". Support both trailing-ID formats.
  const trailingIdMatch = fileName.match(/[.\[](\d+)\]?\.html$/i);
  const messageIds = new Set(
    [...html.matchAll(/data-message-id=(\d+)/g)].map((m) => m[1])
  );

  return {
    filePath,
    fileName,
    html,
    trailingId: trailingIdMatch ? trailingIdMatch[1] : null,
    messageIds,
  };
};

/**
 * Derives a human-readable thread name from an export document.
 * @param html The thread document HTML
 * @param fallback A fallback name (e.g. the file name) if none can be parsed
 * @returns The thread title
 */
const getThreadName = (html: string, fallback: string): string => {
  const entries = [
    ...html.matchAll(/<div class=preamble__entry>([^<]*)<\/div>/g),
  ].map((m) => m[1].trim());

  const lastEntry = entries[entries.length - 1];
  if (lastEntry) {
    // Thread exports label the last entry as "channel / thread name".
    const parts = lastEntry.split(" / ");
    return parts[parts.length - 1].trim() || fallback;
  }

  return fallback;
};

/**
 * Builds the collapsible `<details>` block for a thread.
 * @param threadName The thread's display name
 * @param replyCount The number of messages inside the thread (excluding the starter)
 * @param bodyHtml The thread reply message groups
 * @returns The `<details>` markup to insert into the main document
 */
const buildThreadDetails = (
  threadName: string,
  replyCount: number,
  bodyHtml: string
): string => {
  const label = `${threadName} \u2014 ${replyCount} ${
    replyCount === 1 ? "message" : "messages"
  }`;

  return (
    `<details class=chatlog__thread>` +
    `<summary>\uD83E\uDDF5 Thread: ${label}</summary>` +
    `<div class=chatlog__thread-content>${bodyHtml}</div>` +
    `</details>`
  );
};

/**
 * Inserts a thread's `<details>` block directly beneath its starter message.
 * @param mainHtml The (possibly already modified) main document HTML
 * @param parentId The message ID the thread should be nested under
 * @param detailsHtml The thread `<details>` markup
 * @returns The updated HTML, or null if the parent message was not found
 */
const insertThreadUnderMessage = (
  mainHtml: string,
  parentId: string,
  detailsHtml: string
): string | null => {
  const containerRegex = new RegExp(
    `<div id=chatlog__message-container-${parentId}\\b`
  );
  const containerMatch = mainHtml.match(containerRegex);
  if (!containerMatch || containerMatch.index === undefined) {
    return null;
  }

  const insertAt = findMatchingDivEnd(mainHtml, containerMatch.index);
  if (insertAt === -1) {
    return null;
  }

  return mainHtml.slice(0, insertAt) + detailsHtml + mainHtml.slice(insertAt);
};

/**
 * Scans a directory of DiscordChatExporter HTML files and produces a single
 * merged HTML file where each thread export is embedded as a collapsible
 * section beneath the message it was started from.
 *
 * The main channel export is identified as the file whose trailing ID (the
 * channel ID) does not appear as a message within its own content. Every other
 * HTML file is treated as a thread export, and its trailing ID is the ID of the
 * starter message in the main export that the thread belongs to.
 *
 * @param directory The directory to scan for the main and thread HTML exports
 * @returns The absolute path to the newly created merged HTML file
 */
export const mergeThreadsInDirectory = async (
  directory: string
): Promise<string> => {
  const htmlFiles = fs
    .readdirSync(directory)
    .filter((name) => name.toLowerCase().endsWith(".html"))
    .filter((name) => !name.toLowerCase().endsWith(".merged.html"))
    .map((name) => path.join(directory, name));

  if (htmlFiles.length === 0) {
    throw new Error(`No HTML files found in directory: ${directory}`);
  }

  const exports = htmlFiles.map(parseExport);

  // The main export's trailing ID is a channel ID, so it is not one of its own
  // messages. A thread export always contains its starter message (its ID).
  const mainCandidates = exports.filter(
    (exp) => !exp.trailingId || !exp.messageIds.has(exp.trailingId)
  );

  if (mainCandidates.length !== 1) {
    throw new Error(
      `Expected exactly one main channel export, found ${mainCandidates.length}. ` +
        `Candidates: ${mainCandidates.map((c) => c.fileName).join(", ") || "none"}`
    );
  }

  const mainExport = mainCandidates[0];
  const threadExports = exports.filter((exp) => exp !== mainExport);

  let mergedHtml = mainExport.html;

  for (const thread of threadExports) {
    const parentId = thread.trailingId;
    if (!parentId) {
      console.warn(`Skipping thread with no ID in name: ${thread.fileName}`);
      continue;
    }

    const chatlogInner = extractChatlogInner(thread.html);
    const groups = extractMessageGroups(chatlogInner);

    // Drop the starter message group; it already exists in the main export.
    const replyGroups = groups.filter(
      (group) => !(group.ids.length === 1 && group.ids[0] === parentId)
    );

    const bodyHtml = replyGroups.map((group) => group.html).join("\n");
    const replyCount = replyGroups.reduce(
      (total, group) => total + group.ids.length,
      0
    );

    const threadName = getThreadName(thread.html, thread.fileName);
    const detailsHtml = buildThreadDetails(threadName, replyCount, bodyHtml);

    const updated = insertThreadUnderMessage(mergedHtml, parentId, detailsHtml);
    if (updated === null) {
      console.warn(
        `Parent message ${parentId} for thread "${thread.fileName}" was not found in the main export; skipping.`
      );
      continue;
    }

    mergedHtml = updated;
  }

  // Inject the thread styling into the existing stylesheet.
  mergedHtml = mergedHtml.replace("</style>", `${THREAD_STYLE}</style>`);

  const mainBaseName = mainExport.fileName.replace(/\.html$/i, "");
  const outputPath = path.join(directory, `${mainBaseName}.merged.html`);
  fs.writeFileSync(outputPath, mergedHtml, "utf8");

  return outputPath;
};
