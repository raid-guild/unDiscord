import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { mergeThreadsInDirectory } from "../src/services/thread-merger.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

const createDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(tmpdir(), "undiscord-thread-merger-"));
  tempDirectories.push(directory);
  return directory;
};

const messageContainer = (id: string, text: string): string =>
  `<div id=chatlog__message-container-${id} class=chatlog__message-container data-message-id=${id}><div class=chatlog__message><div class=chatlog__content>${text}</div></div></div>`;

const exportHtml = (
  channelPath: string,
  messageGroups: string,
  chatlogOpen = "<div class=chatlog>"
): string =>
  `<html><head><style>.chatlog{display:block}</style></head><body><div class=preamble__entry>${channelPath}</div>${chatlogOpen}${messageGroups}</div></body></html>`;

const messageGroup = (...messages: string[]): string =>
  `<div class=chatlog__message-group>${messages.join("")}</div>`;

test("merges replies and removes only the duplicated starter message", async () => {
  const directory = await createDirectory();
  const mainFile = "Guild - channel [100].html";
  const threadFile = "Guild - channel - thread [200].html";

  await writeFile(
    path.join(directory, mainFile),
    exportHtml("Guild / channel", messageGroup(messageContainer("200", "starter")))
  );
  await writeFile(
    path.join(directory, threadFile),
    exportHtml(
      "Guild / channel / thread",
      messageGroup(
        messageContainer("200", "starter"),
        messageContainer("201", "first reply")
      ) + messageGroup(messageContainer("202", "second reply"))
    )
  );

  const outputPath = await mergeThreadsInDirectory(directory, "100");
  const merged = await readFile(outputPath, "utf8");

  assert.match(merged, /Thread: thread — 2 messages/);
  assert.equal(
    [...merged.matchAll(/data-message-id=200\b/g)].length,
    1,
    "the starter message should appear only once"
  );
  assert.match(merged, /data-message-id=201\b/);
  assert.match(merged, /data-message-id=202\b/);
});

test("preserves an unattached thread's starter and replies without changing raw exports", async () => {
  const directory = await createDirectory();
  const mainPath = path.join(directory, "Guild - channel [100].html");
  const threadPath = path.join(directory, "Guild - channel - orphan [200].html");
  const mainHtml = exportHtml(
    "Guild / channel",
    messageGroup(
      messageContainer("300", '<a href="/channels/100/200">Thread link</a>')
    )
  );
  const threadHtml = exportHtml(
    "Guild / channel / orphan",
    messageGroup(
      messageContainer("200", "starter"),
      messageContainer("201", "reply")
    )
  );

  await writeFile(mainPath, mainHtml);
  await writeFile(threadPath, threadHtml);

  const outputPath = await mergeThreadsInDirectory(directory, "100");
  const merged = await readFile(outputPath, "utf8");

  assert.match(merged, /Threads with unavailable parent messages/);
  assert.match(merged, /Thread: orphan — 2 messages — Parent message unavailable/);
  for (const id of ["200", "201", "300"]) {
    assert.equal(
      [...merged.matchAll(new RegExp(`data-message-id=${id}\\b`, "g"))].length,
      1
    );
  }
  assert.match(merged, /<\/section><\/div><\/body><\/html>$/);
  assert.equal(await readFile(mainPath, "utf8"), mainHtml);
  assert.equal(await readFile(threadPath, "utf8"), threadHtml);

  // Reprocessing the same directory must exclude the previously merged file.
  assert.equal(await mergeThreadsInDirectory(directory, "100"), outputPath);
  assert.equal(await readFile(outputPath, "utf8"), merged);
});

test("continues merging attached threads alongside multiple unattached threads", async () => {
  const directory = await createDirectory();

  await writeFile(
    path.join(directory, "Guild - channel [100].html"),
    exportHtml("Guild / channel", messageGroup(messageContainer("500", "parent")))
  );
  await writeFile(
    path.join(directory, "Guild - channel - a orphan [200].html"),
    exportHtml(
      "Guild / channel / a orphan",
      messageGroup(messageContainer("201", "reply with deleted starter"))
    )
  );
  await writeFile(
    path.join(directory, "Guild - channel - b orphan [400].html"),
    exportHtml(
      "Guild / channel / b orphan",
      messageGroup(
        messageContainer("400", "unattached starter"),
        messageContainer("401", "unattached reply")
      )
    )
  );
  await writeFile(
    path.join(directory, "Guild - channel - z attached [500].html"),
    exportHtml(
      "Guild / channel / z attached",
      messageGroup(
        messageContainer("500", "parent"),
        messageContainer("501", "attached reply")
      )
    )
  );

  const outputPath = await mergeThreadsInDirectory(directory, "100");
  const merged = await readFile(outputPath, "utf8");

  assert.match(merged, /Thread: a orphan — 1 message — Parent message unavailable/);
  assert.match(merged, /Thread: b orphan — 2 messages — Parent message unavailable/);
  assert.match(merged, /Thread: z attached — 1 message<\/summary>/);
  assert.equal(
    [...merged.matchAll(/<section class=chatlog__unattached-threads>/g)].length,
    1
  );
  for (const id of ["201", "400", "401", "500", "501"]) {
    assert.equal(
      [...merged.matchAll(new RegExp(`data-message-id=${id}\\b`, "g"))].length,
      1
    );
  }
  assert.ok(
    merged.indexOf("Thread: z attached") <
      merged.indexOf("<section class=chatlog__unattached-threads>")
  );
  assert.match(merged, /<\/section><\/div><\/body><\/html>$/);
});

test("rejects unsupported parent container markup instead of treating it as missing", async () => {
  const directory = await createDirectory();

  await writeFile(
    path.join(directory, "Guild - channel [100].html"),
    exportHtml(
      "Guild / channel",
      messageGroup(
        messageContainer("200", "parent")
          .replace("<div id=", '<div id="')
          .replace("-200 class=", '-200" class=')
      )
    )
  );
  await writeFile(
    path.join(directory, "Guild - channel - thread [200].html"),
    exportHtml(
      "Guild / channel / thread",
      messageGroup(messageContainer("201", "reply"))
    )
  );

  await assert.rejects(
    mergeThreadsInDirectory(directory, "100"),
    /Could not locate parent message container 200/
  );
});

test("rejects an unparseable main chatlog when preserving unattached threads", async () => {
  const directory = await createDirectory();

  await writeFile(
    path.join(directory, "Guild - channel [100].html"),
    exportHtml("Guild / channel", "", "<div data-template-version=2 class=chatlog>")
  );
  await writeFile(
    path.join(directory, "Guild - channel - orphan [200].html"),
    exportHtml(
      "Guild / channel / orphan",
      messageGroup(messageContainer("201", "reply"))
    )
  );

  await assert.rejects(
    mergeThreadsInDirectory(directory, "100"),
    /Could not locate main chatlog to preserve unattached threads/
  );
});

test("rejects non-empty thread exports when the chatlog markup cannot be parsed", async () => {
  const directory = await createDirectory();

  await writeFile(
    path.join(directory, "Guild - channel [100].html"),
    exportHtml("Guild / channel", messageGroup(messageContainer("200", "starter")))
  );
  await writeFile(
    path.join(directory, "Guild - channel - thread [200].html"),
    exportHtml(
      "Guild / channel / thread",
      messageGroup(
        messageContainer("200", "starter"),
        messageContainer("201", "reply")
      ),
      "<div data-template-version=2 class=chatlog>"
    )
  );

  await assert.rejects(
    mergeThreadsInDirectory(directory, "100"),
    /Could not extract chatlog content from thread export/
  );
});

test("rejects partial message-group parsing instead of dropping replies", async () => {
  const directory = await createDirectory();

  await writeFile(
    path.join(directory, "Guild - channel [100].html"),
    exportHtml("Guild / channel", messageGroup(messageContainer("200", "starter")))
  );
  await writeFile(
    path.join(directory, "Guild - channel - thread [200].html"),
    exportHtml(
      "Guild / channel / thread",
      messageGroup(messageContainer("200", "starter")) +
        `<div data-template-version=2 class=chatlog__message-group>${messageContainer(
          "201",
          "reply"
        )}</div>`
    )
  );

  await assert.rejects(
    mergeThreadsInDirectory(directory, "100"),
    /Could not extract all messages .* missing message IDs: 201/
  );
});

test("identifies the main export when thread exports omit their starter messages", async () => {
  const directory = await createDirectory();
  const mainFile = "Guild - channel [100].html";

  await writeFile(
    path.join(directory, mainFile),
    exportHtml("Guild / channel", messageGroup(messageContainer("200", "starter")))
  );
  await writeFile(
    path.join(directory, "Guild - channel - thread [200].html"),
    exportHtml(
      "Guild / channel / thread",
      messageGroup(messageContainer("201", "reply"))
    )
  );

  const outputPath = await mergeThreadsInDirectory(directory, "100");
  const merged = await readFile(outputPath, "utf8");

  assert.match(merged, /Thread: thread — 1 message/);
  assert.match(merged, /data-message-id=200\b/);
  assert.match(merged, /data-message-id=201\b/);
});
